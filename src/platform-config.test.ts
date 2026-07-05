import { test } from "node:test";
import assert from "node:assert/strict";
import { clampTrialDays, PLATFORM_DEFAULTS } from "./platform-config";

test("clampTrialDays keeps 1..365 and rounds", () => {
  assert.equal(clampTrialDays(30), 30);
  assert.equal(clampTrialDays(0), 1);
  assert.equal(clampTrialDays(-5), 1);
  assert.equal(clampTrialDays(9999), 365);
  assert.equal(clampTrialDays(14.6), 15);
  assert.equal(clampTrialDays(NaN), PLATFORM_DEFAULTS.signupTrialDays);
});

test("platform defaults are individual + 30 days", () => {
  assert.equal(PLATFORM_DEFAULTS.signupPlan, "individual");
  assert.equal(PLATFORM_DEFAULTS.signupTrialDays, 30);
});
