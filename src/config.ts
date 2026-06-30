import dotenv from "dotenv";
dotenv.config();

const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";
const baseUrl = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

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

export const config = {
  nodeEnv: NODE_ENV,
  isProduction,
  port: parseInt(process.env.PORT || "3000", 10),
  baseUrl,
  secureCookies: baseUrl.startsWith("https://"),
  adminToken: secret("ADMIN_TOKEN", "dev-admin-token-9f3a04a640e84d2c9df0"),
  scimToken: secret("SCIM_TOKEN", "dev-scim-token-c02c9c55a8434e04a53f"),
  sessionSecret: secret("SESSION_SECRET", "dev-session-secret-4a857b6c30aa445fb04a"),
  // Azure AD / Entra OIDC for employee self-service sign-in at /me.
  azure: {
    tenantId: process.env.AZURE_TENANT_ID || "",
    clientId: process.env.AZURE_CLIENT_ID || "",
    clientSecret: process.env.AZURE_CLIENT_SECRET || "",
  },
  // Local testing only: lets employees "sign in" by typing an email (no IdP). Off in prod.
  devLogin: process.env.SELF_SERVICE_DEV_LOGIN === "1",
  // Public self-service signup (creates a new org + owner). On in dev by default,
  // off in production unless SIGNUPS_ENABLED=1, so a deployed instance doesn't
  // accept random org creation before you're ready to open the doors.
  signupsEnabled: process.env.SIGNUPS_ENABLED === "1" || !isProduction,
};
