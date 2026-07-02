import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeFieldMap,
  mapLeadToRecord,
  defaultRecord,
  buildCrmPayload,
  nextSyncStatus,
  isRetryable,
  httpOk,
  parseFieldMapLines,
  fieldMapToLines,
} from "./crmsync";

test("parseFieldMapLines parses target=source lines, drops junk/unknown", () => {
  assert.deepEqual(
    parseFieldMapLines("firstname = name\nemail=email\n  vehicle = vehicleInterest \nbad line\nx = notAField"),
    { firstname: "name", email: "email", vehicle: "vehicleInterest" }
  );
  assert.deepEqual(parseFieldMapLines(""), {});
});

test("fieldMapToLines round-trips a sanitized map", () => {
  assert.equal(fieldMapToLines({ firstname: "name", email: "email" }), "firstname = name\nemail = email");
});

const lead = {
  id: "lead_1",
  name: "Jane Buyer",
  email: "jane@example.com",
  phone: "555-1212",
  vehicleInterest: "F-150",
  tradeIn: true,
  campaign: "summer",
  utmSource: "google",
  status: "new",
  createdAt: "2026-07-02T12:00:00.000Z",
};

test("sanitizeFieldMap drops unknown source fields + empty targets", () => {
  assert.deepEqual(
    sanitizeFieldMap({ firstname: "name", email: "email", bogus: "notAField", "": "phone" }),
    { firstname: "name", email: "email" }
  );
  assert.deepEqual(sanitizeFieldMap("nope"), {});
});

test("mapLeadToRecord uses the field map (target -> source value)", () => {
  const rec = mapLeadToRecord(lead, { firstname: "name", email: "email", vehicle: "vehicleInterest" });
  assert.deepEqual(rec, { firstname: "Jane Buyer", email: "jane@example.com", vehicle: "F-150" });
});

test("mapLeadToRecord falls back to the default normalized record when map is empty", () => {
  const rec = mapLeadToRecord(lead, {});
  assert.equal(rec.email, "jane@example.com");
  assert.equal(rec.vehicleInterest, "F-150");
  assert.equal(rec.tradeIn, true);
  assert.equal(rec.serviceNeed, null); // missing optional -> null
});

test("defaultRecord includes every catalog field, nulls for missing", () => {
  const rec = defaultRecord({ name: "Solo" });
  assert.equal(rec.name, "Solo");
  assert.equal(rec.email, null);
  assert.ok("utmCampaign" in rec);
});

test("buildCrmPayload has a normalized shape", () => {
  const p: any = buildCrmPayload(lead, { orgName: "Acme", rooftop: "Springfield", sourceType: "card", sourceName: "Jane R" }, { first: "name" });
  assert.equal(p.event, "lead.captured");
  assert.equal(p.leadId, "lead_1");
  assert.equal(p.org, "Acme");
  assert.equal(p.rooftop, "Springfield");
  assert.deepEqual(p.source, { type: "card", name: "Jane R" });
  assert.deepEqual(p.record, { first: "Jane Buyer" });
  assert.equal(p.capturedAt, "2026-07-02T12:00:00.000Z");
});

test("nextSyncStatus: success -> sent; failures escalate to dead at maxAttempts", () => {
  assert.deepEqual(nextSyncStatus(0, true, 5), { status: "sent", attempts: 1 });
  assert.deepEqual(nextSyncStatus(0, false, 3), { status: "failed", attempts: 1 });
  assert.deepEqual(nextSyncStatus(1, false, 3), { status: "failed", attempts: 2 });
  assert.deepEqual(nextSyncStatus(2, false, 3), { status: "dead", attempts: 3 }); // hit cap -> dead
});

test("isRetryable + httpOk", () => {
  assert.equal(isRetryable("failed"), true);
  assert.equal(isRetryable("dead"), false);
  assert.equal(isRetryable("sent"), false);
  assert.equal(httpOk(200), true);
  assert.equal(httpOk(204), true);
  assert.equal(httpOk(500), false);
  assert.equal(httpOk(null), false);
});
