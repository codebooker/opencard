import { CacheProvider, CacheItem } from "@node-saml/node-saml";
import { prisma } from "./db";

// DB-backed node-saml CacheProvider for SP-initiated SAML (SEC-07).
//
// node-saml calls saveAsync(requestId, timestamp) when we redirect a user to
// their IdP, then at the ACS calls getAsync(inResponseTo) — which MUST return
// non-null for validation to pass — and removeAsync to consume it. Backing this
// with the database (not the library's default in-memory map) means:
//   • request IDs are shared across both web instances, and
//   • an id is single-use, so a captured SAML response can't be replayed.
// Entries older than TTL_MS are treated as absent (and pruned), bounding the
// window in which a valid response can be presented.

const TTL_MS = 15 * 60 * 1000; // generous for a slow IdP round-trip

export class DbSamlCacheProvider implements CacheProvider {
  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    try {
      const row = await prisma.samlRequestId.create({ data: { id: key, value } });
      return { value, createdAt: row.createdAt.getTime() };
    } catch {
      // Unique-constraint conflict (duplicate id) — node-saml treats null as
      // "already present" and won't overwrite.
      return null;
    }
  }

  async getAsync(key: string): Promise<string | null> {
    const row = await prisma.samlRequestId.findUnique({ where: { id: key } });
    if (!row) return null;
    if (Date.now() - row.createdAt.getTime() > TTL_MS) {
      // Expired — consume it so a stale id can't be used, and report absent.
      await prisma.samlRequestId.delete({ where: { id: key } }).catch(() => {});
      return null;
    }
    return row.value;
  }

  async removeAsync(key: string | null): Promise<string | null> {
    if (!key) return null;
    await prisma.samlRequestId.delete({ where: { id: key } }).catch(() => {});
    return key;
  }
}

// Delete expired request IDs. Called from the hourly scheduler; also safe to run
// ad hoc. Returns the number removed.
export async function pruneSamlRequestIds(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - TTL_MS);
  const res = await prisma.samlRequestId.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return res.count;
}
