import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidEmail,
  parseCampaignRouting,
  parseCampaignRoutingLines,
  campaignRoutingToLines,
  resolveRecipients,
  buildLeadEmail,
} from "./routing";

test("isValidEmail", () => {
  assert.equal(isValidEmail("a@b.com"), true);
  assert.equal(isValidEmail("  a@b.co  "), true);
  assert.equal(isValidEmail("nope"), false);
  assert.equal(isValidEmail("a@b"), false);
  assert.equal(isValidEmail(null), false);
});

test("parseCampaignRouting validates + lowercases keys", () => {
  assert.deepEqual(parseCampaignRouting({ Summer: "s@x.com", bad: "nope" }), { summer: "s@x.com" });
  assert.deepEqual(parseCampaignRouting("not-an-object"), {});
  assert.deepEqual(parseCampaignRouting(["a"]), {});
});

test("parseCampaignRoutingLines round-trips", () => {
  const map = parseCampaignRoutingLines("Summer | s@x.com\nlot-A | lot@x.com\njunkline");
  assert.deepEqual(map, { summer: "s@x.com", "lot-a": "lot@x.com" });
  assert.equal(campaignRoutingToLines(map), "summer | s@x.com\nlot-a | lot@x.com");
});

test("resolveRecipients unions owner/dept/rooftop, de-dupes, validates", () => {
  assert.deepEqual(
    resolveRecipients({ ownerEmail: "owner@x.com", departmentEmail: "dept@x.com", rooftopEmail: "roof@x.com" }),
    ["owner@x.com", "dept@x.com", "roof@x.com"]
  );
  // de-dupe case-insensitively, keep first form; drop invalid
  assert.deepEqual(
    resolveRecipients({ ownerEmail: "Owner@x.com", departmentEmail: "owner@x.com", rooftopEmail: "bad" }),
    ["Owner@x.com"]
  );
});

test("resolveRecipients adds campaign-matched address", () => {
  const r = resolveRecipients({
    ownerEmail: "owner@x.com",
    campaign: "Summer",
    campaignRouting: { summer: "camp@x.com" },
  });
  assert.deepEqual(r, ["owner@x.com", "camp@x.com"]);
});

test("resolveRecipients falls back when nothing resolves", () => {
  assert.deepEqual(resolveRecipients({ ownerEmail: null, fallbackEmail: "fb@x.com" }), ["fb@x.com"]);
  assert.deepEqual(resolveRecipients({}), []);
});

test("buildLeadEmail subject + body carry lead + attribution", () => {
  const { subject, text } = buildLeadEmail(
    {
      name: "Pat",
      email: "pat@x.com",
      vehicleInterest: "2025 Bronco",
      tradeIn: true,
      consent: true,
      campaign: "summer",
      utmSource: "facebook",
      device: "mobile",
    },
    { card: { firstName: "Jane", lastName: "Rivera" } }
  );
  assert.equal(subject, "New lead: Pat — 2025 Bronco");
  assert.match(text, /via card \(Jane Rivera\)/);
  assert.match(text, /Vehicle interest: 2025 Bronco/);
  assert.match(text, /Trade-in: yes/);
  assert.match(text, /summer · facebook · mobile/);
});
