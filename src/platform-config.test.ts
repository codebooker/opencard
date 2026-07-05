import { test } from "node:test";
import assert from "node:assert/strict";
import { clampTrialDays, signupCodeOk, PLATFORM_DEFAULTS } from "./platform-config";

test("signupCodeOk: empty configured code means the gate is off", () => {
  assert.equal(signupCodeOk("", "anything"), true);
  assert.equal(signupCodeOk("  ", undefined), true);
});

test("signupCodeOk: case-insensitive, whitespace-forgiving match", () => {
  assert.equal(signupCodeOk("Early-Bird 2026", "early-bird 2026"), true);
  assert.equal(signupCodeOk("Early-Bird 2026", "  EARLY-BIRD 2026  "), true);
  assert.equal(signupCodeOk("Early-Bird 2026", "wrong"), false);
  assert.equal(signupCodeOk("Early-Bird 2026", ""), false);
  assert.equal(signupCodeOk("Early-Bird 2026", null), false);
});

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
