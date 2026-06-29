import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  baseUrl: (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, ""),
  adminToken: process.env.ADMIN_TOKEN || "changeme-admin-token",
  scimToken: process.env.SCIM_TOKEN || "changeme-scim-token",
  sessionSecret: process.env.SESSION_SECRET || "dev-session-secret-change-me",
  // Azure AD / Entra OIDC for employee self-service sign-in at /me.
  azure: {
    tenantId: process.env.AZURE_TENANT_ID || "",
    clientId: process.env.AZURE_CLIENT_ID || "",
    clientSecret: process.env.AZURE_CLIENT_SECRET || "",
  },
  // Local testing only: lets employees "sign in" by typing an email (no IdP). Off in prod.
  devLogin: process.env.SELF_SERVICE_DEV_LOGIN === "1",
};
