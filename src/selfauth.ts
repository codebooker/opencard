import crypto from "crypto";
import { config } from "./config";

type OpenIdMetadata = {
  issuer: string;
  jwks_uri: string;
};

type JwkWithMetadata = JsonWebKey & {
  kid?: string;
  kty?: string;
};

type Jwks = {
  keys: JwkWithMetadata[];
};

let metadataCache: OpenIdMetadata | null = null;
let jwksCache: Jwks | null = null;

function signPayload(value: string): string {
  const payload = Buffer.from(value).toString("base64url");
  const sig = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyPayload(token?: string): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expect = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return Buffer.from(payload, "base64url").toString("utf8");
}

// Small signed value used by the password/MFA flow. Employee SSO sessions use
// the tenant-bound identity below so a cookie issued for one workspace cannot
// be reused to select another workspace merely by changing hosts.
export function signEmail(email: string, now = Date.now()): string {
  return signPayload(
    JSON.stringify({ v: 1, type: "email", email: email.toLowerCase(), expiresAt: now + 5 * 60 * 1000 })
  );
}

export function verifyEmail(token?: string, now = Date.now()): string | null {
  const value = verifyPayload(token);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed?.v === 1 &&
      parsed?.type === "email" &&
      typeof parsed?.email === "string" &&
      /^[^@\s{}"']+@[^@\s{}"']+$/.test(parsed.email) &&
      typeof parsed?.expiresAt === "number" &&
      parsed.expiresAt >= now
      ? parsed.email.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

export type EmployeeIdentity = { email: string; orgId: string };

export function signEmployeeIdentity(email: string, orgId: string, now = Date.now()): string {
  return signPayload(
    JSON.stringify({
      v: 1,
      type: "employee",
      email: email.toLowerCase(),
      orgId,
      expiresAt: now + 12 * 60 * 60 * 1000,
    })
  );
}

export function verifyEmployeeIdentity(token?: string, now = Date.now()): EmployeeIdentity | null {
  const value = verifyPayload(token);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (
      parsed?.v !== 1 ||
      parsed?.type !== "employee" ||
      typeof parsed?.email !== "string" ||
      !parsed.email.includes("@") ||
      typeof parsed?.orgId !== "string" ||
      !parsed.orgId ||
      typeof parsed?.expiresAt !== "number" ||
      parsed.expiresAt < now
    ) {
      return null;
    }
    return { email: parsed.email.toLowerCase(), orgId: parsed.orgId };
  } catch {
    return null;
  }
}

// The OIDC authorization round-trip always returns to APP_URL. This short-lived
// signed context remembers which branded workspace initiated the flow without
// trusting a query string at the callback.
export function signOidcContext(orgId: string, now = Date.now()): string {
  return signPayload(JSON.stringify({ v: 1, type: "oidc", orgId, expiresAt: now + 10 * 60 * 1000 }));
}

export function verifyOidcContext(token?: string, now = Date.now()): string | null {
  const value = verifyPayload(token);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (
      parsed?.v !== 1 ||
      parsed?.type !== "oidc" ||
      typeof parsed?.orgId !== "string" ||
      !parsed.orgId ||
      typeof parsed?.expiresAt !== "number" ||
      parsed.expiresAt < now
    ) {
      return null;
    }
    return parsed.orgId;
  } catch {
    return null;
  }
}

export const oidcEnabled = (): boolean =>
  !!(config.azure.tenantId && config.azure.clientId && config.azure.clientSecret);

const redirectUri = () => `${config.baseUrl}/me/auth/callback`;

export function authorizeUrl(state: string, nonce: string): string {
  const p = new URLSearchParams({
    client_id: config.azure.clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    response_mode: "query",
    scope: "openid email profile",
    state,
    nonce,
  });
  return `https://login.microsoftonline.com/${config.azure.tenantId}/oauth2/v2.0/authorize?${p.toString()}`;
}

async function openIdMetadata(): Promise<OpenIdMetadata> {
  if (metadataCache) return metadataCache;
  const resp = await fetch(
    `https://login.microsoftonline.com/${config.azure.tenantId}/v2.0/.well-known/openid-configuration`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!resp.ok) throw new Error("Unable to load OpenID provider metadata.");
  metadataCache = (await resp.json()) as OpenIdMetadata;
  return metadataCache;
}

async function jwks(forceRefresh = false): Promise<Jwks> {
  if (jwksCache && !forceRefresh) return jwksCache;
  const meta = await openIdMetadata();
  const resp = await fetch(meta.jwks_uri, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error("Unable to load OpenID signing keys.");
  jwksCache = (await resp.json()) as Jwks;
  return jwksCache;
}

function decodeBase64UrlJson(part: string): any {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

async function verifyIdToken(idToken: string, expectedNonce: string): Promise<any | null> {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeBase64UrlJson(encodedHeader);
  const claims = decodeBase64UrlJson(encodedPayload);
  if (header.alg !== "RS256" || !header.kid) return null;

  let keys = await jwks();
  let jwk = keys.keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  // Entra rotates signing keys. Refresh once on an unknown kid so a warm app
  // process does not reject every login until its next restart.
  if (!jwk) {
    keys = await jwks(true);
    jwk = keys.keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  }
  if (!jwk) return null;

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  const publicKey = crypto.createPublicKey({ key: jwk as any, format: "jwk" });
  if (!verifier.verify(publicKey, Buffer.from(encodedSignature, "base64url"))) return null;

  const meta = await openIdMetadata();
  const now = Math.floor(Date.now() / 1000);
  const skew = 300;
  if (claims.iss !== meta.issuer) return null;
  if (claims.aud !== config.azure.clientId) return null;
  if (typeof claims.exp !== "number" || claims.exp < now - skew) return null;
  if (typeof claims.nbf === "number" && claims.nbf > now + skew) return null;
  if (claims.nonce !== expectedNonce) return null;
  return claims;
}

// Exchange the auth code at Entra's token endpoint, then validate the returned
// ID token before trusting any user identity claims.
export async function exchangeCode(code: string, expectedNonce: string): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: config.azure.clientId,
    client_secret: config.azure.clientSecret,
    code,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
    scope: "openid email profile",
  });
  const resp = await fetch(
    `https://login.microsoftonline.com/${config.azure.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(8000),
    }
  );
  if (!resp.ok) return null;
  const json: any = await resp.json();
  const idToken: string | undefined = json.id_token;
  if (!idToken) return null;
  try {
    const claims = await verifyIdToken(idToken, expectedNonce);
    if (!claims) return null;
    const email = claims.email || claims.preferred_username || claims.upn || "";
    return email ? String(email).toLowerCase() : null;
  } catch {
    return null;
  }
}
