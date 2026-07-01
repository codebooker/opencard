import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planFor,
  hasFeature,
  limitFor,
  withinLimit,
  requiredPlanFor,
  isPlanKey,
  PLAN_ORDER,
  PLANS,
} from "./plans";

test("unknown plan strings fall back to the default (starter)", () => {
  assert.equal(planFor("bogus").key, "starter");
  assert.equal(planFor("").key, "starter");
  assert.equal(isPlanKey("dealer_group"), true);
  assert.equal(isPlanKey("nope"), false);
});

test("feature gating matches the tier design", () => {
  assert.equal(hasFeature("starter", "sso"), false);
  assert.equal(hasFeature("starter", "leadCapture"), true);
  assert.equal(hasFeature("team", "api"), true);
  assert.equal(hasFeature("team", "scim"), false);
  assert.equal(hasFeature("dealer_group", "scim"), true);
  assert.equal(hasFeature("dealer_group", "auditLogs"), false);
  assert.equal(hasFeature("enterprise", "auditLogs"), true);
});

test("withinLimit enforces counts and treats -1 as unlimited", () => {
  // starter allows 1 location
  assert.equal(withinLimit("starter", "locations", 0), true);
  assert.equal(withinLimit("starter", "locations", 1), false);
  // enterprise is unlimited
  assert.equal(limitFor("enterprise", "cards"), -1);
  assert.equal(withinLimit("enterprise", "cards", 1_000_000), true);
});

test("starter cannot issue API keys", () => {
  assert.equal(limitFor("starter", "apiKeys"), 0);
  assert.equal(withinLimit("starter", "apiKeys", 0), false);
});

test("requiredPlanFor returns the lowest unlocking tier", () => {
  assert.equal(requiredPlanFor("api")?.key, "team");
  assert.equal(requiredPlanFor("scim")?.key, "dealer_group");
  assert.equal(requiredPlanFor("auditLogs")?.key, "enterprise");
  assert.equal(requiredPlanFor("leadCapture")?.key, "starter");
});

test("plans are ordered and each has a label + price", () => {
  assert.deepEqual(PLAN_ORDER, ["starter", "team", "dealer_group", "enterprise"]);
  for (const key of PLAN_ORDER) {
    assert.ok(PLANS[key].label.length > 0, key);
    assert.ok(PLANS[key].price.length > 0, key);
  }
});
