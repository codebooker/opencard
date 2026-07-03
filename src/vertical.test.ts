import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeTerminology, terminologyForVertical, isVertical, verticalLabel } from "./terminology";
import { leadFieldChoicesFor, defaultLeadFieldsFor } from "./leadform";

test("terminology carries the vertical and custom labels can't override it", () => {
  assert.equal(terminologyForVertical("dealership").vertical, "dealership");
  assert.equal(terminologyForVertical(null).vertical, "general");
  const t = mergeTerminology("dealership", { locationSingular: "Store", vertical: "general" });
  assert.equal(t.locationSingular, "Store");
  assert.equal(t.vertical, "dealership"); // forced back to the org's vertical
});

test("isVertical whitelists known values", () => {
  assert.equal(isVertical("dealership"), true);
  assert.equal(isVertical("general"), true);
  assert.equal(isVertical("bank"), false);
  assert.equal(verticalLabel("dealership"), "Car dealership");
  assert.equal(verticalLabel("nope"), "General business");
});

test("lead-field choices and defaults are vertical-aware", () => {
  const generalKeys = leadFieldChoicesFor("general").map(([k]) => k);
  assert.ok(!generalKeys.includes("vehicleInterest"));
  assert.ok(!generalKeys.includes("tradeIn"));
  assert.ok(!generalKeys.includes("serviceNeed"));
  const dealerKeys = leadFieldChoicesFor("dealership").map(([k]) => k);
  assert.ok(dealerKeys.includes("vehicleInterest"));
  assert.deepEqual(defaultLeadFieldsFor("general"), ["email", "phone", "note", "consent"]);
  assert.ok(defaultLeadFieldsFor("dealership").includes("vehicleInterest"));
});
