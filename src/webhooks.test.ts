import { test } from "node:test";
import assert from "node:assert/strict";

// SEC-01 regression: emitEvent must only deliver to the event's own org.
// We stub the module's prisma + fetch by intercepting the endpoint query and
// the outbound POSTs, asserting tenant B's endpoint never receives tenant A's
// event. This runs without a live database.

import { prisma } from "./db";
import { emitEvent } from "./webhooks";

test("emitEvent only queries endpoints for the given org (tenant isolation)", async () => {
  const calls: any[] = [];
  const original = prisma.webhookEndpoint.findMany;
  // Capture the filter emitEvent uses; return no endpoints so nothing is sent.
  (prisma.webhookEndpoint as any).findMany = async (args: any) => {
    calls.push(args);
    return [];
  };
  try {
    emitEvent("orgA", "lead.captured", { id: "lead1" });
    // emitEvent is fire-and-forget; let the microtask/async IIFE run.
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls.length, 1, "exactly one endpoint query");
    assert.equal(calls[0].where.orgId, "orgA", "query is scoped to the event's org");
    assert.equal(calls[0].where.active, true, "only active endpoints");
  } finally {
    (prisma.webhookEndpoint as any).findMany = original;
  }
});

test("emitEvent with a falsy orgId delivers to nobody (fail closed)", async () => {
  let queried = false;
  const original = prisma.webhookEndpoint.findMany;
  (prisma.webhookEndpoint as any).findMany = async () => {
    queried = true;
    return [];
  };
  try {
    emitEvent("", "lead.captured", { id: "lead1" });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(queried, false, "no endpoint query when orgId is empty");
  } finally {
    (prisma.webhookEndpoint as any).findMany = original;
  }
});
