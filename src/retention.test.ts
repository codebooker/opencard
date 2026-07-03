import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRetentionDays, retentionCutoff, retentionLabel } from "./retention";

test("parseRetentionDays: positive int, else null; capped", () => {
  assert.equal(parseRetentionDays("30"), 30);
  assert.equal(parseRetentionDays(90), 90);
  assert.equal(parseRetentionDays("0"), null);
  assert.equal(parseRetentionDays("-5"), null);
  assert.equal(parseRetentionDays(""), null);
  assert.equal(parseRetentionDays("abc"), null);
  assert.equal(parseRetentionDays("99999"), 3650); // capped
});

test("retentionCutoff: null when disabled, else now - days", () => {
  const now = new Date("2026-07-10T00:00:00Z");
  assert.equal(retentionCutoff(null, now), null);
  assert.equal(retentionCutoff(0, now), null);
  assert.equal(retentionCutoff(7, now)!.toISOString(), "2026-07-03T00:00:00.000Z");
});

test("retentionLabel reads naturally", () => {
  assert.match(retentionLabel(30), /deleted after 30 days/);
  assert.match(retentionLabel(1), /after 1 day\./);
  assert.match(retentionLabel(null), /kept indefinitely/);
});
