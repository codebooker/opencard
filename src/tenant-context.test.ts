import { test } from "node:test";
import assert from "node:assert/strict";
import { runWithOrgOn } from "./tenant-context";

// A fake transactional client that records the SQL run inside the transaction
// and hands the callback a fake tx client.
function fakeClient() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const tx = {
    $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
      calls.push({ sql, params });
      return 0;
    },
  };
  const client = {
    $transaction: async (cb: (tx: any) => Promise<any>) => cb(tx),
  };
  return { client, tx, calls };
}

test("runWithOrgOn sets app.current_org_id to the given org inside the transaction", async () => {
  const { client, calls } = fakeClient();
  await runWithOrgOn(client as any, "org_abc", async () => "ok");
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /set_config\(\$1, \$2, true\)/);
  assert.deepEqual(calls[0].params, ["app.current_org_id", "org_abc"]);
});

test("runWithOrgOn runs the callback inside the transaction and returns its result", async () => {
  const { client, tx } = fakeClient();
  const order: string[] = [];
  const result = await runWithOrgOn(client as any, "org_1", async (received) => {
    order.push("fn");
    assert.equal(received, tx); // callback gets the transaction client
    return 42;
  });
  assert.equal(result, 42);
  assert.deepEqual(order, ["fn"]);
});

test("runWithOrgOn sets the org BEFORE running the callback", async () => {
  const events: string[] = [];
  const tx = {
    $executeRawUnsafe: async () => {
      events.push("set_config");
      return 0;
    },
  };
  const client = { $transaction: async (cb: (tx: any) => Promise<any>) => cb(tx) };
  await runWithOrgOn(client as any, "org_1", async () => {
    events.push("query");
  });
  assert.deepEqual(events, ["set_config", "query"]);
});

test("runWithOrgOn rejects an empty orgId (fail closed)", async () => {
  const { client, calls } = fakeClient();
  await assert.rejects(() => runWithOrgOn(client as any, "", async () => "x"), /non-empty orgId/);
  assert.equal(calls.length, 0);
});
