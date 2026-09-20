import dotenv from "dotenv";
import { devLoginEnabled, integerSetting, originSetting } from "./config-core";
dotenv.config();

const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";
// The public URL for this self-hosted installation.
const baseUrl = originSetting(process.env.APP_URL || process.env.BASE_URL || "http://localhost:3000", "APP_URL/BASE_URL");
// The public card-sharing origin. Defaults to the app origin when not split.
const cardUrl = originSetting(process.env.CARD_URL || baseUrl, "CARD_URL");

const badSecrets = new Set([
  "changeme-admin-token",
  "changeme-scim-token",
  "changeme-session-secret",
  "dev-session-secret-change-me",
  "opencard",
  "",
]);

function secret(name: string, devDefault: string): string {
  const raw = process.env[name];
  const value = raw === undefined ? (isProduction ? "" : devDefault) : raw;
  if (badSecrets.has(value) || value.length < 24) {
    throw new Error(
      `${name} must be set to a strong random value. Refusing to start with a missing, weak, or placeholder secret.`
    );
  }
  return value;
}

// Compatibility-only shared credentials may be omitted entirely. When one is
// supplied, it must still meet the same strength requirements as core secrets.
function optionalSecret(name: string, devDefault: string): string {
  if (!process.env[name]) return isProduction ? "" : devDefault;
  return secret(name, devDefault);
}

export const config = {
  nodeEnv: NODE_ENV,
  isProduction,
  port: integerSetting(process.env.PORT, 3000, "PORT", 1, 65535),
  // Number of reverse-proxy hops in front of the app (Express `trust proxy`).
  // The standard deploy runs behind one proxy (Caddy) = 1. Set 0 when the app
  // is directly exposed, N when there are N proxies. Never `true`/-all: that
  // would let clients spoof their IP (and bypass rate limits) via X-Forwarded-For.
  trustProxyHops: integerSetting(process.env.TRUST_PROXY_HOPS, 1, "TRUST_PROXY_HOPS", 0, 10),
  // Webhook inspector rows can contain lead/contact payloads. Keep them only
  // long enough for troubleshooting and replay, then remove them automatically.
  webhookDeliveryRetentionDays: integerSetting(
    process.env.WEBHOOK_DELIVERY_RETENTION_DAYS,
    30,
    "WEBHOOK_DELIVERY_RETENTION_DAYS",
    1,
    365
  ),
  baseUrl,
  cardUrl,
  sourceUrl: process.env.SOURCE_URL || "https://github.com/codebooker/opencard",
  secureCookies: baseUrl.startsWith("https://"),
  // Legacy global SCIM token. New deployments issue per-workspace tokens in
  // Admin → Integrations, so this compatibility credential is optional.
  scimToken: optionalSecret("SCIM_TOKEN", "dev-scim-token-c02c9c55a8434e04a53f"),
  sessionSecret: secret("SESSION_SECRET", "dev-session-secret-4a857b6c30aa445fb04a"),
  // Azure AD / Entra OIDC for employee self-service sign-in at /me.
  azure: {
    tenantId: process.env.AZURE_TENANT_ID || "",
    clientId: process.env.AZURE_CLIENT_ID || "",
    clientSecret: process.env.AZURE_CLIENT_SECRET || "",
  },
  // Email-only sign-in is for disposable demos only; both switches are required.
  devLogin: devLoginEnabled(process.env),
  // Third-party accessibility widgets are opt-in for self-hosters.
  userwayAccount: (() => {
    const v = process.env.USERWAY_ACCOUNT ?? "off";
    return v && v !== "off" ? v : "";
  })(),
  // Outbound email for lead notifications. Optional — when SMTP_HOST is unset,
  // notifications are logged instead of sent (the routing still runs).
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: integerSetting(process.env.SMTP_PORT, 587, "SMTP_PORT", 1, 65535),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || `OpenCard <no-reply@${new URL(baseUrl).hostname}>`,
  },
  // Wallet passes (Phase 10). Optional — inert until credentials are provided.
  wallet: {
    // Apple Wallet: Pass Type ID + Team ID + cert/key/WWDR file paths (a signed
    // .pkpass is only produced once these exist).
    applePassTypeId: process.env.WALLET_APPLE_PASS_TYPE_ID || "",
    appleTeamId: process.env.WALLET_APPLE_TEAM_ID || "",
    appleCertPath: process.env.WALLET_APPLE_CERT_PATH || "",
    appleKeyPath: process.env.WALLET_APPLE_KEY_PATH || "",
    appleWwdrPath: process.env.WALLET_APPLE_WWDR_PATH || "",
    // Google Wallet: issuer id + service-account email + private key (PEM).
    googleIssuerId: process.env.WALLET_GOOGLE_ISSUER_ID || "",
    googleServiceEmail: process.env.WALLET_GOOGLE_SERVICE_EMAIL || "",
    googleServiceKey: (process.env.WALLET_GOOGLE_SERVICE_KEY || "").replace(/\\n/g, "\n"),
  },
};

export const mailEnabled = !!config.smtp.host;
// Keep Apple Wallet hidden until .pkpass packaging/signing is implemented. Merely
// supplying certificate paths must not advertise a CTA whose endpoint returns 501.
export const appleWalletEnabled = false;
export const googleWalletEnabled =
  !!config.wallet.googleIssuerId && !!config.wallet.googleServiceEmail && !!config.wallet.googleServiceKey;
