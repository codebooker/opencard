// Tenant transaction context. Kept free of any runtime Prisma import (only
// `import type`, which the compiler erases) so it can be unit-tested without a
// generated Prisma client.
import type { Prisma, PrismaClient } from "@prisma/client";

// The minimal surface runWithOrg needs from a Prisma client.
export type Transactional = { $transaction: PrismaClient["$transaction"] };

/**
 * Run `fn` inside a transaction whose `app.current_org_id` is set to `orgId`.
 * Postgres RLS policies key on that setting, so the work sees only this tenant's
 * rows. The setting is transaction-local (set_config(..., true)), so it never
 * leaks to other pooled connections. All queries inside `fn` must use the
 * provided transaction client `tx`.
 */
export async function runWithOrgOn<T>(
  client: Transactional,
  orgId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  if (!orgId) throw new Error("runWithOrg requires a non-empty orgId");
  return (client.$transaction as any)(async (tx: Prisma.TransactionClient) => {
    // Parameterized so orgId can never break out into SQL.
    await tx.$executeRawUnsafe("SELECT set_config($1, $2, true)", "app.current_org_id", orgId);
    return fn(tx);
  });
}
