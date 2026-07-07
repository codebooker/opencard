import { test } from "node:test";
import assert from "node:assert/strict";

// CQ-09: withAdvisoryLock must let exactly one concurrent caller run for a
// given key (the second sees the lock held and skips). We stub prisma so the
// test needs no live database — modeling pg_try_advisory_xact_lock as a simple
// held-keys set, released when the transaction callback returns.

import { withAdvisoryLock } from "./joblock";
import { prisma } from "./db";

function installTxStub() {
  const held = new Set<number>();
  const orig = (prisma as any).$transaction;
  (prisma as any).$transaction = async (cb: any) => {
    // Each transaction gets its own tx client whose advisory-lock query checks
    // the shared held-set; the key is released when the callback resolves.
    let myKey: number | null = null;
    const tx = {
      async $queryRawUnsafe(_sql: string, key: number) {
        if (held.has(key)) return [{ locked: false }];
        held.add(key);
        myKey = key;
        return [{ locked: true }];
      },
    };
    try {
      return await cb(tx);
    } finally {
      if (myKey !== null) held.delete(myKey);
    }
  };
  return () => ((prisma as any).$transaction = orig);
}

test("two concurrent holders of the same key: exactly one runs", async () => {
  const restore = installTxStub();
  try {
    let running = 0,
      maxConcurrent = 0,
      ran = 0;
    const job = async () => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      ran++;
      await new Promise((r) => setTimeout(r, 20));
      running--;
    };
    const [a, b] = await Promise.all([withAdvisoryLock(42, job), withAdvisoryLock(42, job)]);
    assert.equal(ran, 1, "job body ran exactly once");
    assert.equal(maxConcurrent, 1, "never two at once");
    assert.equal([a, b].filter(Boolean).length, 1, "exactly one call reports it ran");
  } finally {
    restore();
  }
});

test("different keys don't block each other", async () => {
  const restore = installTxStub();
  try {
    let ran = 0;
    const job = async () => {
      ran++;
    };
    const [a, b] = await Promise.all([withAdvisoryLock(1, job), withAdvisoryLock(2, job)]);
    assert.equal(ran, 2);
    assert.equal(a, true);
    assert.equal(b, true);
  } finally {
    restore();
  }
});

test("the lock is released after running, so a later call runs again", async () => {
  const restore = installTxStub();
  try {
    let ran = 0;
    const job = async () => {
      ran++;
    };
    assert.equal(await withAdvisoryLock(7, job), true);
    assert.equal(await withAdvisoryLock(7, job), true); // sequential, lock free again
    assert.equal(ran, 2);
  } finally {
    restore();
  }
});
