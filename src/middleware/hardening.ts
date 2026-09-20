import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { notFoundPage } from "../views/notfound";
import {
  memoryRateLimitStore,
  RateLimitStore,
  sharedRateLimitStore,
} from "../rate-limit-store";

// Client IP for rate-limit keys and logs. Relies on Express's `trust proxy`
// (set to the proxy hop count in server.ts) rather than reading X-Forwarded-For
// directly: the leftmost XFF value is client-controlled, so trusting it lets an
// attacker rotate the header and bypass per-IP rate limits.
export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "";
}

function log(entry: Record<string, unknown>): void {
  // Structured single-line JSON logs (easy to ship to a log aggregator).
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ t: new Date().toISOString(), ...entry }));
}

// ---------- Security headers ----------
// Inline scripts/handlers and same-origin preview iframes require 'unsafe-inline'
// and frame-src/frame-ancestors 'self'. External card photos/logos may be https.
// blob: in img-src is required by the photo cropper's local preview (it renders
// the just-picked file via URL.createObjectURL before anything is uploaded);
// blob: URLs can only reference objects created by this same page, so this
// grants nothing to third parties.
// When the UserWay accessibility widget is enabled, its CDN + API must be
// allowlisted (script/style from the CDN, XHR to its API, iframe for its menu).
const USERWAY = config.userwayAccount
  ? {
      script: " https://cdn.userway.org",
      style: " https://cdn.userway.org",
      connect: " https://cdn.userway.org https://api.userway.org",
      frame: " https://cdn.userway.org",
      font: " https://cdn.userway.org",
    }
  : { script: "", style: "", connect: "", frame: "", font: "" };

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${USERWAY.script}`,
  `style-src 'self' 'unsafe-inline'${USERWAY.style}`,
  "img-src 'self' data: blob: https:",
  `font-src 'self' data:${USERWAY.font}`,
  `connect-src 'self'${USERWAY.connect}`,
  `frame-src 'self'${USERWAY.frame}`,
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (config.secureCookies) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

// ---------- Request logging ----------
const NOISY = (p: string) => p === "/healthz" || p === "/readyz" || p === "/styles.css" || p.startsWith("/uploads");

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on("finish", () => {
    const path = req.originalUrl.split("?")[0];
    if (NOISY(path) && res.statusCode < 400) return;
    log({
      lvl: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      method: req.method,
      path,
      status: res.statusCode,
      ms: Date.now() - start,
      ip: clientIp(req),
    });
  });
  next();
}

// ---------- Rate limiting (shared PostgreSQL store, per IP) ----------
export function rateLimit(opts: {
  name: string;
  windowMs: number;
  max: number;
  methods?: string[];
  match?: (req: Request) => boolean;
  store?: RateLimitStore;
}) {
  const store = opts.store ?? sharedRateLimitStore;
  const fallback = memoryRateLimitStore();
  let lastStoreWarning = 0;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (opts.methods && !opts.methods.includes(req.method)) return next();
    if (opts.match && !opts.match(req)) return next();
    const ip = clientIp(req);
    const key = `${opts.name}:${ip}`;
    const now = Date.now();
    let bucket;
    try {
      bucket = await store.hit(key, opts.windowMs);
    } catch (error: any) {
      // Most rate-limited routes need the database anyway. Still retain local
      // protection during a transient store failure instead of failing open.
      bucket = await fallback.hit(key, opts.windowMs);
      if (now - lastStoreWarning > 60_000) {
        lastStoreWarning = now;
        log({ lvl: "error", event: "rate_limit_store_error", error: String(error?.message || error).slice(0, 200) });
      }
    }
    if (bucket.count > opts.max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.reset - now) / 1000))));
      log({ lvl: "warn", event: "rate_limited", limiter: opts.name, ip, path: req.originalUrl.split("?")[0] });
      return res.status(429).send("Too many requests — please slow down and try again shortly.");
    }
    next();
  };
}

// ---------- CSRF (origin/referer check for cookie-authenticated surfaces) ----------
// Defense-in-depth on top of SameSite=Lax session cookies. Only the cookie-authed
// /admin and /me POST surfaces need it; bearer-auth (/api, /scim) and the inbound
// SAML assertion (/me/saml/acs) are exempt.
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const EXEMPT = new Set(["/me/saml/acs"]);

function hostOf(value?: string): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  const path = req.originalUrl.split("?")[0];
  const guarded = path.startsWith("/admin") || path.startsWith("/me");
  if (!guarded || EXEMPT.has(path)) return next();

  const expected = hostOf(config.baseUrl);
  // Host-only session cookies make the request's own host a valid same-origin
  // target as well. This supports registered branded domains without accepting
  // an Origin from a different site.
  const requestHost = String(req.headers.host || "").trim().toLowerCase();
  const origin = hostOf(req.headers.origin as string | undefined);
  const referer = hostOf(req.headers.referer as string | undefined);
  const claimed = origin ?? referer;

  if (claimed === null) {
    // Cookie-authenticated mutations must prove their source. SameSite=Lax is
    // not sufficient by itself because sibling tenant subdomains are same-site.
    log({ lvl: "warn", event: "csrf_blocked", path, origin, referer, ip: clientIp(req), reason: "missing_source" });
    return res.status(403).send("Blocked: request source could not be verified (CSRF protection).");
  }
  if (claimed === expected || (!!requestHost && claimed.toLowerCase() === requestHost)) return next();

  log({ lvl: "warn", event: "csrf_blocked", path, origin, referer, ip: clientIp(req) });
  return res.status(403).send("Blocked: cross-origin request rejected (CSRF protection).");
}

// ---------- 404 + error handling ----------
export function notFound(req: Request, res: Response): void {
  // API/SCIM callers get plain text; humans get the branded page.
  if (req.path.startsWith("/api/") || req.path.startsWith("/scim/") || !req.accepts("html")) {
    res.status(404).send("Not found");
    return;
  }
  res.status(404).type("html").send(notFoundPage());
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  log({
    lvl: "error",
    event: "unhandled_error",
    path: req.originalUrl.split("?")[0],
    method: req.method,
    msg: String(err?.message || err),
    stack: config.isProduction ? undefined : err?.stack,
  });
  if (res.headersSent) return next(err);
  const status = typeof err?.status === "number" ? err.status : 500;
  res.status(status).send(config.isProduction ? "Something went wrong." : String(err?.message || "Server error"));
}
