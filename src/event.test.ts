import { test } from "node:test";
import assert from "node:assert/strict";
import { eventStatus, eventLive } from "./event";

const now = new Date("2026-07-10T12:00:00Z");

test("eventStatus: off when inactive regardless of window", () => {
  assert.equal(eventStatus({ active: false }, now), "off");
  assert.equal(eventStatus({ active: false, startsAt: "2026-07-01", endsAt: "2026-07-31" }, now), "off");
});

test("eventStatus: upcoming / live / ended by window", () => {
  assert.equal(eventStatus({ active: true, startsAt: "2026-07-20" }, now), "upcoming");
  assert.equal(eventStatus({ active: true, endsAt: "2026-07-05" }, now), "ended");
  assert.equal(eventStatus({ active: true, startsAt: "2026-07-01", endsAt: "2026-07-31" }, now), "live");
  assert.equal(eventStatus({ active: true }, now), "live"); // no window = always live
});

test("eventLive is true only for live", () => {
  assert.equal(eventLive({ active: true, startsAt: "2026-07-01", endsAt: "2026-07-31" }, now), true);
  assert.equal(eventLive({ active: true, endsAt: "2026-07-05" }, now), false);
  assert.equal(eventLive({ active: false }, now), false);
});
