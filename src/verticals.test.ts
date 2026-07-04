import { test } from "node:test";
import assert from "node:assert/strict";
import { VERTICAL_PACKS, packFor } from "./verticals";
import { LEAD_FIELDS, leadFieldChoicesFor, defaultLeadFieldsFor } from "./leadform";
import { VERTICALS, isVertical, terminologyForVertical, verticalLabel } from "./terminology";
import { rooftopCtas } from "./dealership";

const catalogKeys = new Set(LEAD_FIELDS.map(([k]) => k));

test("every pack is internally consistent", () => {
  for (const p of VERTICAL_PACKS) {
    assert.ok(p.key && p.label, `${p.key}: key/label`);
    // terminology complete
    for (const f of ["brandSingular", "locationSingular", "locationPlural", "cardSingular", "leadSingular"] as const) {
      assert.ok((p.terminology as any)[f], `${p.key}: terminology.${f}`);
    }
    // lead fields must exist in the real catalog (they're Lead columns)
    for (const k of p.extraLeadFieldKeys) assert.ok(catalogKeys.has(k), `${p.key}: unknown lead field ${k}`);
    for (const k of p.defaultLeadFields) assert.ok(catalogKeys.has(k), `${p.key}: unknown default field ${k}`);
    // defaults must be choosable by this pack's admins
    const choices = new Set(leadFieldChoicesFor(p.key).map(([k]) => k));
    for (const k of p.defaultLeadFields) assert.ok(choices.has(k), `${p.key}: default ${k} not in choices`);
    // CTA labels all present
    for (const f of ["sales", "service", "call", "site"] as const) assert.ok(p.ctaLabels[f], `${p.key}: ctaLabels.${f}`);
  }
});

test("registry drives the Business type dropdown and vertical checks", () => {
  assert.deepEqual(VERTICALS.map(([k]) => k), VERTICAL_PACKS.map((p) => p.key));
  assert.ok(isVertical("dealership"));
  assert.ok(!isVertical("florist"));
  assert.equal(verticalLabel("dealership"), "Car dealership");
  assert.equal(terminologyForVertical("dealership").locationSingular, "Rooftop");
  assert.equal(terminologyForVertical("nonsense").locationSingular, "Location"); // safe fallback
});

test("one pack's fields never leak into another pack's choices", () => {
  const general = leadFieldChoicesFor("general").map(([k]) => k);
  assert.ok(!general.includes("vehicleInterest"));
  assert.ok(!general.includes("tradeIn"));
  const dealer = leadFieldChoicesFor("dealership").map(([k]) => k);
  assert.ok(dealer.includes("vehicleInterest"));
  assert.deepEqual(defaultLeadFieldsFor("general"), ["email", "phone", "note", "consent"]);
});

test("CTA labels follow the pack; dealership wording stays the default", () => {
  const profile = { salesUrl: "a.com/x", serviceUrl: null, phone: "555-123-4567", website: null };
  const dealer = rooftopCtas(profile, packFor("dealership").ctaLabels);
  assert.equal(dealer[0].label, "View inventory");
  assert.equal(dealer[1].label, "Call the dealership");
  const general = rooftopCtas(profile, packFor("general").ctaLabels);
  assert.equal(general[1].label, "Call us");
  // no labels arg = legacy dealership wording (unchanged call sites)
  assert.equal(rooftopCtas(profile)[0].label, "View inventory");
});
