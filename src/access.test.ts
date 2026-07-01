import { test } from "node:test";
import assert from "node:assert/strict";
import { accessState } from "./access";

const now = new Date("2026-06-30T00:00:00Z");
const inDays = (n: number) => new Date(now.getTime() + n * 86400000);

test("free mode is always active regardless of dates/status", () => {
  const s = accessState({ billingMode: "free", subscriptionStatus: "canceled", trialEndsAt: inDays(-100), now });
  assert.equal(s.active, true);
  assert.equal(s.reason, "free");
});

test("an active subscription is active even with a past trial date", () => {
  const s = accessState({ billingMode: "standard", subscriptionStatus: "active", trialEndsAt: inDays(-5), now });
  assert.equal(s.active, true);
  assert.equal(s.reason, "subscribed");
});

test("demo mode is active within the window and reports days left", () => {
  const s = accessState({ billingMode: "demo", subscriptionStatus: "trialing", trialEndsAt: inDays(30), now });
  assert.equal(s.active, true);
  assert.equal(s.reason, "demo");
  assert.equal(s.daysLeft, 30);
});

test("demo mode locks after the window ends", () => {
  const s = accessState({ billingMode: "demo", subscriptionStatus: "trialing", trialEndsAt: inDays(-1), now });
  assert.equal(s.active, false);
  assert.equal(s.reason, "demo_expired");
});

test("an expired demo can be rescued by subscribing", () => {
  const s = accessState({ billingMode: "demo", subscriptionStatus: "active", trialEndsAt: inDays(-1), now });
  assert.equal(s.active, true);
  assert.equal(s.reason, "subscribed");
});

test("standard trial is active inside the window, locked after", () => {
  assert.equal(accessState({ billingMode: "standard", subscriptionStatus: "trialing", trialEndsAt: inDays(3), now }).active, true);
  const expired = accessState({ billingMode: "standard", subscriptionStatus: "trialing", trialEndsAt: inDays(-1), now });
  assert.equal(expired.active, false);
  assert.equal(expired.reason, "trial_expired");
});

test("past_due and canceled standard accounts are locked", () => {
  assert.equal(accessState({ billingMode: "standard", subscriptionStatus: "past_due", trialEndsAt: null, now }).reason, "past_due");
  assert.equal(accessState({ billingMode: "standard", subscriptionStatus: "canceled", trialEndsAt: null, now }).active, false);
});
