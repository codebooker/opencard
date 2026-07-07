import { test } from "node:test";
import assert from "node:assert/strict";

// SEC-07: DbSamlCacheProvider round-trip using an in-memory stub for prisma so
// the test needs no live database. We verify the node-saml contract:
//  - saveAsync stores an id and returns a CacheItem; duplicate save -> null
//  - getAsync returns the value while fresh, null when expired
//  - removeAsync consumes the id so a replay getAsync returns null

import { DbSamlCacheProvider, pruneSamlRequestIds } from "./saml-cache";
import { prisma } from "./db";

type Row = { id: string; value: string; createdAt: Date };

function installStub(rows: Map<string, Row>) {
  const orig = (prisma as any).samlRequestId;
  (prisma as any).samlRequestId = {
    async create({ data }: any) {
      if (rows.has(data.id)) throw new Error("unique");
      const row = { id: data.id, value: data.value, createdAt: new Date() };
      rows.set(data.id, row);
      return row;
    },
    async findUnique({ where }: any) {
      return rows.get(where.id) ?? null;
    },
    async delete({ where }: any) {
      if (!rows.has(where.id)) throw new Error("not found");
      rows.delete(where.id);
      return {};
    },
    async deleteMany({ where }: any) {
      const cut = where.createdAt.lt as Date;
      let n = 0;
      for (const [k, v] of rows) if (v.createdAt < cut) { rows.delete(k); n++; }
      return { count: n };
    },
  };
  return () => ((prisma as any).samlRequestId = orig);
}

test("save/get/consume round-trip and replay rejection", async () => {
  const rows = new Map<string, Row>();
  const restore = installStub(rows);
  try {
    const c = new DbSamlCacheProvider();
    const saved = await c.saveAsync("_req1", "1234567890");
    assert.ok(saved && saved.value === "1234567890");
    // duplicate id -> null (node-saml treats as "already present")
    assert.equal(await c.saveAsync("_req1", "x"), null);
    // valid response: getAsync returns the value
    assert.equal(await c.getAsync("_req1"), "1234567890");
    // consume it
    assert.equal(await c.removeAsync("_req1"), "_req1");
    // replay: id is gone -> null (node-saml then rejects "InResponseTo is not valid")
    assert.equal(await c.getAsync("_req1"), null);
    // unknown id -> null
    assert.equal(await c.getAsync("_never"), null);
    assert.equal(await c.removeAsync(null), null);
  } finally {
    restore();
  }
});

test("expired request ids are treated as absent and pruned", async () => {
  const rows = new Map<string, Row>();
  const restore = installStub(rows);
  try {
    const c = new DbSamlCacheProvider();
    await c.saveAsync("_old", "t");
    // Age the row past the 15-minute TTL.
    rows.get("_old")!.createdAt = new Date(Date.now() - 16 * 60 * 1000);
    assert.equal(await c.getAsync("_old"), null, "expired id reads as absent");
    assert.equal(rows.has("_old"), false, "expired id consumed on read");
    // prune of already-empty set returns 0
    assert.equal(await pruneSamlRequestIds(), 0);
    // prune removes aged rows
    await c.saveAsync("_a", "t");
    rows.get("_a")!.createdAt = new Date(Date.now() - 20 * 60 * 1000);
    assert.equal(await pruneSamlRequestIds(), 1);
  } finally {
    restore();
  }
});
