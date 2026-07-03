import { test } from "node:test";
import assert from "node:assert/strict";
import { auditLabel, formatAuditActor, AUDIT_ACTIONS } from "./audit";

test("auditLabel maps known actions, passes through unknown", () => {
  assert.equal(auditLabel("login.success"), "Signed in");
  assert.equal(auditLabel("crm.delete"), "Removed CRM integration");
  assert.equal(auditLabel("something.custom"), "something.custom");
});

test("formatAuditActor: email wins, else token/system marker", () => {
  assert.equal(formatAuditActor("jane@x.com", "org_owner"), "jane@x.com");
  assert.equal(formatAuditActor(null, "platform_owner"), "platform_owner (token)");
  assert.equal(formatAuditActor(null, null), "System / token");
});

test("every catalog action has a non-empty label", () => {
  for (const [k, v] of Object.entries(AUDIT_ACTIONS)) assert.ok(v && v.length > 0, k);
});
