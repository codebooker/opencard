import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planFor,
  hasFeature,
  limitFor,
  withinLimit,
  requiredPlanFor,
  isPlanKey,
  normalizePlanKey,
  PLAN_ORDER,
  PLANS,
} from "./plans";

test("unknown plan strings fall back to the default (individual)", () => {
  assert.equal(planFor("bogus").key, "individual");
  assert.equal(planFor("").key, "individual");
  assert.equal(isPlanKey("multi_location_brand"), true);
  assert.equal(isPlanKey("nope"), false);
});

test("legacy plan keys map to the current lineup", () => {
  assert.equal(normalizePlanKey("starter"), "individual");
  assert.equal(normalizePlanKey("dealer_group"), "multi_location_brand");
  assert.equal(normalizePlanKey("team"), "team");
  assert.equal(normalizePlanKey("bogus"), null);
  assert.equal(planFor("dealer_group").key, "multi_location_brand");
  assert.equal(planFor("starter").key, "individual");
});

test("feature gating matches the tier design", () => {
  assert.equal(hasFeature("individual", "sso"), false);
  assert.equal(hasFeature("individual", "leadCapture"), true);
  assert.equal(hasFeature("team", "api"), true);
  assert.equal(hasFeature("team", "scim"), false);
  assert.equal(hasFeature("multi_location_brand", "scim"), true);
  assert.equal(hasFeature("multi_location_brand", "auditLogs"), false);
  assert.equal(hasFeature("enterprise", "auditLogs"), true);
});

test("withinLimit enforces counts and treats -1 as unlimited", () => {
  // individual allows 1 location and exactly 1 card
  assert.equal(withinLimit("individual", "locations", 0), true);
  assert.equal(withinLimit("individual", "locations", 1), false);
  assert.equal(withinLimit("individual", "cards", 0), true);
  assert.equal(withinLimit("individual", "cards", 1), false);
  // enterprise is unlimited
  assert.equal(limitFor("enterprise", "cards"), -1);
  assert.equal(withinLimit("enterprise", "cards", 1_000_000), true);
});

test("individual cannot issue API keys", () => {
  assert.equal(limitFor("individual", "apiKeys"), 0);
  assert.equal(withinLimit("individual", "apiKeys", 0), false);
});

test("requiredPlanFor returns the lowest unlocking tier", () => {
  assert.equal(requiredPlanFor("api")?.key, "team");
  assert.equal(requiredPlanFor("scim")?.key, "multi_location_brand");
  assert.equal(requiredPlanFor("auditLogs")?.key, "enterprise");
  assert.equal(requiredPlanFor("leadCapture")?.key, "individual");
});

test("plans are ordered and each has a label + price", () => {
  assert.deepEqual(PLAN_ORDER, ["individual", "team", "multi_location_brand", "enterprise"]);
  for (const key of PLAN_ORDER) {
    assert.ok(PLANS[key].label.length > 0, key);
    assert.ok(PLANS[key].price.length > 0, key);
  }
});

import { effectiveCardLimit, withinSeatLimit } from "./plans";

test("effectiveCardLimit: seat allowance overrides the plan", () => {
  // individual plan cards limit is 1
  assert.equal(effectiveCardLimit(null, "individual"), 1); // fall back to plan
  assert.equal(effectiveCardLimit(100, "individual"), 100); // explicit cap
  assert.equal(effectiveCardLimit(-1, "individual"), -1); // unlimited
});

test("withinSeatLimit: caps, unlimited, and plan fallback", () => {
  assert.equal(withinSeatLimit(3, "enterprise", 2), true); // under seat cap 3
  assert.equal(withinSeatLimit(3, "enterprise", 3), false); // at cap
  assert.equal(withinSeatLimit(-1, "individual", 9999), true); // unlimited seats
  assert.equal(withinSeatLimit(null, "individual", 1), false); // plan cap (1) reached
  assert.equal(withinSeatLimit(null, "individual", 0), true); // under plan cap
});

import { parseSeatLimit } from "./plans";

test("parseSeatLimit parses blank/unlimited/number", () => {
  assert.equal(parseSeatLimit(""), null);
  assert.equal(parseSeatLimit("default"), null);
  assert.equal(parseSeatLimit("unlimited"), -1);
  assert.equal(parseSeatLimit("-1"), -1);
  assert.equal(parseSeatLimit("50"), 50);
  assert.equal(parseSeatLimit("0"), 0);
  assert.equal(parseSeatLimit("abc"), null);
});
