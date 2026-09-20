import { prisma } from "./db";

export type RateLimitBucket = { count: number; reset: number };

export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<RateLimitBucket>;
}

// Atomic upsert: concurrent requests and separate web processes all increment
// the same fixed-window bucket in PostgreSQL.
export const sharedRateLimitStore: RateLimitStore = {
  async hit(key, windowMs) {
    const rows = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt", "updatedAt")
      VALUES (${key}, 1, NOW() + (${windowMs} * INTERVAL '1 millisecond'), NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimitBucket"."resetAt" <= NOW() THEN 1
          ELSE "RateLimitBucket"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "RateLimitBucket"."resetAt" <= NOW()
            THEN NOW() + (${windowMs} * INTERVAL '1 millisecond')
          ELSE "RateLimitBucket"."resetAt"
        END,
        "updatedAt" = NOW()
      RETURNING "count", "resetAt"
    `;
    const row = rows[0];
    if (!row) throw new Error("Rate-limit counter did not return a row.");
    return { count: row.count, reset: row.resetAt.getTime() };
  },
};

// Kept as a fail-safe if PostgreSQL is temporarily unavailable, and injected by
// unit tests. A fresh store has its own map; sharing one across middleware
// instances models a shared backend.
export function memoryRateLimitStore(): RateLimitStore {
  const buckets = new Map<string, RateLimitBucket>();
  return {
    async hit(key, windowMs) {
      const now = Date.now();
      let bucket = buckets.get(key);
      if (!bucket || bucket.reset <= now) {
        bucket = { count: 0, reset: now + windowMs };
        buckets.set(key, bucket);
      }
      bucket.count++;
      return { ...bucket };
    },
  };
}

export async function pruneRateLimitBuckets(now = new Date()): Promise<number> {
  const result = await prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lt: now } } });
  return result.count;
}
