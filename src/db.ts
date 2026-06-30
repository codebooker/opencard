import { PrismaClient, Prisma } from "@prisma/client";
import { runWithOrgOn } from "./tenant-context";

// ---- privileged (owner) client ----
// Connects as the database owner/superuser. Used for migrations, seed, the role
// bootstrap, and the narrow set of operations that must run before a tenant is
// resolved (auth lookups, public card-by-slug, SCIM token validation). The owner
// is a superuser and therefore BYPASSES Row-Level Security.
export const prisma = new PrismaClient();

// Name of the least-privilege runtime role created by db-bootstrap.
export const APP_DB_ROLE = "opencard_app";

// Build the connection string for the least-privilege app role by swapping the
// credentials in DATABASE_URL for `opencard_app` + APP_DB_PASSWORD. Returns null
// when no app password is configured, in which case we fall back to the owner
// client (RLS is then inert — only application-level scoping applies).
function tenantUrl(): string | null {
  const pw = process.env.APP_DB_PASSWORD;
  const base = process.env.DATABASE_URL;
  if (!pw || !base) return null;
  // Replace the leading `//user:pass@` of the URL authority.
  const swapped = base.replace(/\/\/[^/@]+@/, `//${APP_DB_ROLE}:${encodeURIComponent(pw)}@`);
  return swapped === base ? null : swapped;
}

const TENANT_URL = tenantUrl();

// ---- least-privilege tenant client ----
// Connects as `opencard_app` (NOSUPERUSER NOBYPASSRLS) so Postgres RLS is
// enforced. Falls back to the owner client when no app role is configured, so
// the app still boots in local/dev setups without the dedicated role.
export const tenantDb: PrismaClient = TENANT_URL
  ? new PrismaClient({ datasources: { db: { url: TENANT_URL } } })
  : prisma;

// True when queries actually run under the RLS-enforced role.
export const rlsEnforced = TENANT_URL !== null;

/**
 * Run `fn` against the RLS-enforced tenant client with `app.current_org_id` set
 * to `orgId` for the duration of the transaction. See runWithOrgOn for details.
 */
export function runWithOrg<T>(
  orgId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return runWithOrgOn(tenantDb, orgId, fn);
}

// Re-export the pure types/helpers so existing `from "../db"` imports keep working.
export * from "./types";
