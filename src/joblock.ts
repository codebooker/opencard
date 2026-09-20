import { prisma } from "./db";

// Single-runner guard for scheduled jobs (CQ-09). Production runs two web
// instances, each with its own in-process hourly timer — without a guard,
// manager digests would send twice and prune jobs would double-run.
//
// We use a TRANSACTION-scoped Postgres advisory lock. Unlike a session-level
// lock, pg_try_advisory_xact_lock is safe with Prisma's connection pool: the
// transaction pins one connection for its duration and the lock is released
// automatically on commit/rollback (no risk of unlocking on a different pooled
// connection and leaking the lock). pg_try_* never blocks — the instance that
// can't get the lock simply skips this tick.

// Arbitrary stable 64-bit key for the hourly maintenance tick. Other jobs
// needing their own guard should pick a different constant.
export const HOURLY_TICK_LOCK = 7_762_043;
export const CLIENT_RESTORE_LOCK = 7_762_044;

// Run `fn` inside a transaction that holds advisory lock `key`; only the one
// instance that acquires it runs. Returns true if it ran, false if skipped.
// Never throws. The lock is held for the whole job, so ticks can't overlap.
export async function withAdvisoryLock(key: number, fn: () => Promise<void>): Promise<boolean> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
          "SELECT pg_try_advisory_xact_lock($1) AS locked",
          key
        );
        if (!rows?.[0]?.locked) return false;
        // fn() runs its own queries on the pool; this transaction only holds the
        // lock for the job's duration, so a generous timeout is needed.
        await fn();
        return true;
      },
      { timeout: 10 * 60 * 1000, maxWait: 5_000 }
    );
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ msg: "joblock-error", key, error: String(e?.message || e).slice(0, 200) }));
    return false;
  }
}

// Destructive/manual operations need different semantics from a scheduled tick:
// report contention to the caller and propagate the operation's own error. The
// transaction exists only to hold the cross-process advisory lock while `fn`
// performs its work through its normal database clients.
export async function withExclusiveAdvisoryLock<T>(
  key: number,
  fn: () => Promise<T>,
  busyMessage = "Another operation is already running — try again shortly."
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
        "SELECT pg_try_advisory_xact_lock($1) AS locked",
        key
      );
      if (!rows?.[0]?.locked) throw new Error(busyMessage);
      return fn();
    },
    { timeout: 60 * 60 * 1000, maxWait: 5_000 }
  );
}
