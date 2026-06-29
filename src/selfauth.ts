import crypto from "crypto";
import { config } from "./config";

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

export function authorizeUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: config.azure.clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    response_mode: "query",
    scope: "openid email profile",
    state,
  });
  return `https://login.microsoftonline.com/${config.azure.tenantId}/oauth2/v2.0/authorize?${p.toString()}`;
}

// Exchange the auth code at Entra's token endpoint (server-to-server, TLS) and
// read the email from the returned id_token. Because the token comes directly
// from the token endpoint over TLS, signature re-verification is not required
// (OIDC Core §3.1.3.7).
export async function exchangeCode(code: string): Promise<string | null> {
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
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1], "base64").toString("utf8"));
    const email = claims.email || claims.preferred_username || claims.upn || "";
    return email ? String(email).toLowerCase() : null;
  } catch {
    return null;
  }
}
