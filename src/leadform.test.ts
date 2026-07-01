import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveLeadFields,
  resolveConsentText,
  assembleLead,
  DEFAULT_LEAD_FIELDS,
  DEFAULT_CONSENT_TEXT,
} from "./leadform";

test("resolveLeadFields: template wins, then brand, then defaults", () => {
  assert.deepEqual(resolveLeadFields(["email", "note"], ["phone"], DEFAULT_LEAD_FIELDS), ["email", "note"]);
  assert.deepEqual(resolveLeadFields(null, ["phone", "vehicleInterest"], DEFAULT_LEAD_FIELDS), [
    "phone",
    "vehicleInterest",
  ]);
  assert.deepEqual(resolveLeadFields(null, null, DEFAULT_LEAD_FIELDS), DEFAULT_LEAD_FIELDS);
});

test("resolveLeadFields: explicit empty template array = show none (not inherit)", () => {
  assert.deepEqual(resolveLeadFields([], ["email"], DEFAULT_LEAD_FIELDS), []);
});

test("resolveConsentText: template -> brand -> default, skipping blanks", () => {
  assert.equal(resolveConsentText("Custom T", "Brand B"), "Custom T");
  assert.equal(resolveConsentText("   ", "Brand B"), "Brand B");
  assert.equal(resolveConsentText(null, null), DEFAULT_CONSENT_TEXT);
});

test("assembleLead maps fields, checkboxes, and attribution", () => {
  const lead = assembleLead(
    {
      name: "Pat Prospect",
      email: "pat@example.com",
      phone: "555-1234",
      preferredContact: "Phone",
      vehicleInterest: "2025 Bronco",
      tradeIn: "1",
      appointmentRequest: "1",
      consent: "1",
      campaign: "summer",
      utm_source: "facebook",
      utm_medium: "cpc",
      referrer: "https://facebook.com/ad/1",
    },
    "Mozilla/5.0 (iPhone) Mobile"
  );
  assert.equal(lead.name, "Pat Prospect");
  assert.equal(lead.preferredContact, "phone");
  assert.equal(lead.tradeIn, true);
  assert.equal(lead.appointmentRequest, true);
  assert.equal(lead.consent, true);
  assert.equal(lead.campaign, "summer");
  assert.equal(lead.utmSource, "facebook");
  assert.equal(lead.device, "mobile");
  assert.equal(lead.referrer, "https://facebook.com/ad/1");
});

test("assembleLead: unchecked boxes false, missing optionals null", () => {
  const lead = assembleLead({ name: "Solo" }, "");
  assert.equal(lead.tradeIn, false);
  assert.equal(lead.consent, false);
  assert.equal(lead.email, null);
  assert.equal(lead.device, "unknown");
});
