import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./db";
import { requireApi } from "./apiauth";

function fakeRes() {
  return {
    statusCode: 200,
    body: null as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
  };
}

async function withApiStubs(org: any, run: () => Promise<void>) {
  const keyFind = prisma.apiKey.findUnique;
  const keyUpdate = prisma.apiKey.update;
  const orgFind = prisma.org.findUnique;
  (prisma.apiKey as any).findUnique = async () => ({ id: "key1", orgId: "org1", revoked: false, scopes: [] });
  (prisma.apiKey as any).update = async () => ({});
  (prisma.org as any).findUnique = async () => org;
  try { await run(); } finally {
    (prisma.apiKey as any).findUnique = keyFind;
    (prisma.apiKey as any).update = keyUpdate;
    (prisma.org as any).findUnique = orgFind;
  }
}

const request = (method = "GET") => ({ headers: { authorization: "Bearer oc_live_test" }, method, baseUrl: "/api/v1", path: "/cards" } as any);

test("a valid API key can write without a plan or subscription", async () => {
  await withApiStubs({ id: "org1" }, async () => {
    const req = request("POST");
    const res = fakeRes();
    let passed = false;
    await requireApi(req, res as any, () => { passed = true; });
    assert.equal(passed, true);
    assert.equal((req as any).apiOrgId, "org1");
    assert.equal(res.statusCode, 200);
  });
});

test("an API key for a missing workspace is rejected", async () => {
  await withApiStubs(null, async () => {
    const res = fakeRes();
    let passed = false;
    await requireApi(request("POST"), res as any, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, "invalid_api_key");
  });
});
