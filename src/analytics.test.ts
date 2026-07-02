import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRange, conversionPct, sortLeaderboard } from "./analytics";

const now = new Date("2026-07-02T00:00:00.000Z");

test("resolveRange: default 30, valid keys, all = no start date", () => {
  assert.equal(resolveRange(undefined, now).key, "30");
  assert.equal(resolveRange("bogus", now).key, "30");
  assert.equal(resolveRange("all", now).since, null);
  const r7 = resolveRange("7", now);
  assert.equal(r7.key, "7");
  assert.equal(r7.since!.toISOString(), "2026-06-25T00:00:00.000Z");
  assert.match(r7.label, /7 days/);
});

test("conversionPct: guards zero views, one-decimal rounding", () => {
  assert.equal(conversionPct(0, 0), 0);
  assert.equal(conversionPct(5, 0), 0);
  assert.equal(conversionPct(1, 3), 33.3);
  assert.equal(conversionPct(1, 8), 12.5);
  assert.equal(conversionPct(2, 2), 100);
});

test("sortLeaderboard: by leads, then views, then name; annotates conv", () => {
  const rows = [
    { id: "a", name: "Alpha", views: 100, leads: 2 },
    { id: "b", name: "Bravo", views: 50, leads: 5 },
    { id: "c", name: "Charlie", views: 200, leads: 5 },
    { id: "d", name: "Delta", views: 10, leads: 0 },
  ];
  const out = sortLeaderboard(rows);
  assert.deepEqual(out.map((r) => r.id), ["c", "b", "a", "d"]); // leads desc, views tiebreak (c>b)
  assert.equal(out[0].conv, conversionPct(5, 200));
  assert.equal(out[3].conv, 0);
});
