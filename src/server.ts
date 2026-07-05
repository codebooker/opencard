import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { config } from "./config";
import { cardsRouter } from "./routes/cards";
import { assetsRouter } from "./routes/assets";
import { campaignRouter } from "./routes/campaigns";
import { runDueDigests } from "./reports";
import { pruneExpiredLeads } from "./retention-prune";
import { adminRouter } from "./routes/admin";
import { scimRouter } from "./routes/scim";
import { selfRouter } from "./routes/selfservice";
import { signupRouter } from "./routes/signup";
import { apiRouter } from "./routes/api";
import { previewRouter } from "./routes/preview";
import { marketingPage } from "./views/marketing";
import { termsPage, privacyPage } from "./views/legal";
import { handleStripeWebhook } from "./stripe";
import { qrPng } from "./qr";
import { isDomainApproved, domainKindForHost, requestHost } from "./tenant-resolver";
import { uploadDir } from "./upload";
import {
  securityHeaders,
  requestLogger,
  rateLimit,
  csrfGuard,
  notFound,
  errorHandler,
} from "./middleware/hardening";

const app = express();
// Trust exactly the configured number of proxy hops (default 1: Caddy). With a
// hop count, req.ip is the address the trusted proxy saw — not the spoofable
// leftmost X-Forwarded-For value that `trust proxy: true` would yield.
app.set("trust proxy", config.trustProxyHops);
app.disable("x-powered-by");

app.use(requestLogger);
app.use(securityHeaders);

// Stripe webhook must see the raw request body to verify the signature, so it is
// registered before the JSON body parser (and before CSRF, which it is exempt from).
app.post("/stripe/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

// SCIM sends application/scim+json; admin forms send urlencoded; beacons send text/plain.
app.use(express.json({ type: ["application/json", "application/scim+json"], limit: "1mb" }));
app.use(express.text({ type: ["text/plain"], limit: "256kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(csrfGuard);

// ---- rate limiters ----
const loginLimiter = rateLimit({ name: "login", windowMs: 15 * 60_000, max: 10, methods: ["POST"] });
const scimLimiter = rateLimit({ name: "scim", windowMs: 60_000, max: 120 });
const apiLimiter = rateLimit({ name: "api", windowMs: 60_000, max: 240 });
const leadLimiter = rateLimit({
  name: "lead",
  windowMs: 60_000,
  max: 15,
  methods: ["POST"],
  match: (req) => req.path.endsWith("/connect"),
});
app.use("/admin/login", loginLimiter);
app.use("/me/devlogin", loginLimiter);
// Reset/invite/verify endpoints are unauthenticated and send email — throttle hard.
app.use("/admin/forgot", rateLimit({ name: "forgot", windowMs: 15 * 60_000, max: 5, methods: ["POST"] }));
app.use("/admin/reset", loginLimiter);
app.use("/admin/invite", loginLimiter);
// Signup creates resources; keep it tightly throttled.
app.use("/signup", rateLimit({ name: "signup", windowMs: 60 * 60_000, max: 10, methods: ["POST"] }));

// Static assets (styles.css). Works in dev (src/public) and prod (dist/public).
app.use(express.static(path.join(__dirname, "public")));

// Uploaded logos/photos (persistent volume in Docker).
app.use(
  "/uploads",
  express.static(uploadDir, {
    maxAge: "7d",
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:");
    },
  })
);

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Generic QR image for an arbitrary https URL. Used by email signatures to render
// a campaign QR (auto-generated from the campaign banner link). Public + cached.
app.get("/qr.png", rateLimit({ name: "qr", windowMs: 60_000, max: 120 }), async (req, res) => {
  const data = String(req.query.data || "");
  if (!/^https?:\/\/\S{1,600}$/i.test(data)) return res.status(400).send("bad data");
  const c = String(req.query.color || "");
  const color = /^#?[0-9a-fA-F]{6}$/.test(c) ? (c.startsWith("#") ? c : "#" + c) : "#111827";
  try {
    const buf = await qrPng(data, color);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(buf);
  } catch {
    res.status(400).send("bad data");
  }
});

// Caddy on-demand TLS allowlist check: Caddy asks here before issuing a cert for
// a hostname, so we only auto-issue for client domains registered + approved in
// our DB. 200 = allowed, 403 = not.
app.get("/tls/authorize", async (req, res) => {
  const ok = await isDomainApproved(String(req.query.domain || ""));
  res.status(ok ? 200 : 403).end();
});

// The root of a registered client custom domain lands on that client's portal
// (employee vs admin); both surfaces stay reachable by path. Unregistered
// hosts (the platform's own domain) get the public marketing site.
app.get("/", async (req, res) => {
  const kind = await domainKindForHost(requestHost(req));
  if (kind) return res.redirect(kind === "user" ? "/me" : "/admin");
  res.type("html").send(marketingPage());
});

// Public legal pages (linked from the marketing footer and signup).
app.get("/terms", (_req, res) => res.type("html").send(termsPage()));
app.get("/privacy", (_req, res) => res.type("html").send(privacyPage()));

app.use("/scim/v2", scimLimiter, scimRouter);
app.use("/api/v1", apiLimiter, apiRouter);
app.use("/preview", previewRouter);
app.use("/signup", signupRouter);
app.use("/admin", adminRouter);
app.use("/me", selfRouter);
app.use("/c", leadLimiter, cardsRouter);
app.use("/a", leadLimiter, assetsRouter);
app.use("/k", leadLimiter, campaignRouter);

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`OpenCard listening on ${config.baseUrl} (port ${config.port})`);
});

// Manager-digest scheduler: hourly tick sends weekly digests to orgs that are due.
if (process.env.NODE_ENV !== "test") {
  setInterval(() => {
    runDueDigests().catch((e) => console.log(JSON.stringify({ msg: "digest-tick-error", error: String(e?.message || e).slice(0, 200) })));
    pruneExpiredLeads().catch((e) => console.log(JSON.stringify({ msg: "retention-tick-error", error: String(e?.message || e).slice(0, 200) })));
  }, 60 * 60 * 1000);
}
