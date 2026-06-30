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

// Signed (HMAC) cookie holding the signed-in employee's email. No DB session needed.
export function signEmail(email: string): string {
  const payload = Buffer.from(email.toLowerCase()).toString("base64url");
  const sig = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyEmail(token?: string): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expect = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return Buffer.from(payload, "base64url").toString("utf8");
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

async function jwks(): Promise<Jwks> {
  if (jwksCache) return jwksCache;
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

  const keys = await jwks();
  const jwk = keys.keys.find((k) => k.kid === header.kid && k.kty === "RSA");
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
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }
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
