import dotenv from "dotenv";
dotenv.config();

const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";
// The app/admin origin (e.g. https://opencard.id). APP_URL is preferred; BASE_URL
// is kept for back-compat / single-domain dev.
const baseUrl = (process.env.APP_URL || process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
// The public card-sharing origin (e.g. https://tapshare.cards). Defaults to the
// app origin when not split.
const cardUrl = (process.env.CARD_URL || baseUrl).replace(/\/$/, "");

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
  cardUrl,
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
  // Stripe billing. All optional — when STRIPE_SECRET_KEY is unset, checkout and
  // the webhook are inert and plans are managed manually by the platform owner.
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || "",
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
    // One recurring Price id per paid plan (from the Stripe dashboard).
    prices: {
      team: process.env.STRIPE_PRICE_TEAM || "",
      dealer_group: process.env.STRIPE_PRICE_DEALER_GROUP || "",
      enterprise: process.env.STRIPE_PRICE_ENTERPRISE || "",
    } as Record<string, string>,
  },
};

export const stripeEnabled = !!config.stripe.secretKey;
