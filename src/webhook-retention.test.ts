import assert from "node:assert/strict";
import test from "node:test";
import { webhookDeliveryCutoff } from "./webhook-retention";

test("webhookDeliveryCutoff subtracts the configured retention window", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  assert.equal(webhookDeliveryCutoff(30, now).toISOString(), "2026-06-20T12:00:00.000Z");
  assert.equal(webhookDeliveryCutoff(1, now).toISOString(), "2026-07-19T12:00:00.000Z");
});
