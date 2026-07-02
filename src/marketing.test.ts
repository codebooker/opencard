import { test } from "node:test";
import assert from "node:assert/strict";
import { analyticsSnippet, isGaId, isGtmId, normalizeCampaignCode, campaignRedirectUrl } from "./marketing";

test("ID validation accepts real GA4/GTM ids, rejects junk", () => {
  assert.equal(isGaId("G-ABC123XYZ"), true);
  assert.equal(isGaId("UA-123"), false);
  assert.equal(isGaId("G-<script>"), false);
  assert.equal(isGtmId("GTM-ABC1234"), true);
  assert.equal(isGtmId("nope"), false);
});

test("analyticsSnippet: only valid ids injected; empty when none", () => {
  const both = analyticsSnippet("G-ABC123", "GTM-XYZ789");
  assert.match(both, /gtag\/js\?id=G-ABC123/);
  assert.match(both, /gtm\.js\?id='\+i/); // GTM loader present
  assert.match(both, /GTM-XYZ789/);
  assert.equal(analyticsSnippet(null, null), "");
  assert.equal(analyticsSnippet("bad", "also-bad"), "");
  // invalid GA but valid GTM -> only GTM
  const g = analyticsSnippet("bad", "GTM-OK1234");
  assert.doesNotMatch(g, /gtag\/js/);
  assert.match(g, /GTM-OK1234/);
});

test("normalizeCampaignCode slugs the code", () => {
  assert.equal(normalizeCampaignCode("Summer Sale 2026!"), "summer-sale-2026");
  assert.equal(normalizeCampaignCode("  --Spring--  "), "spring");
  assert.equal(normalizeCampaignCode(""), "");
});

test("campaignRedirectUrl appends utm without clobbering existing params", () => {
  const u = campaignRedirectUrl("https://dealer.com/specials?ref=x", {
    source: "qr",
    medium: "print",
    campaign: "summer",
  });
  const p = new URL(u);
  assert.equal(p.searchParams.get("ref"), "x");
  assert.equal(p.searchParams.get("utm_source"), "qr");
  assert.equal(p.searchParams.get("utm_medium"), "print");
  assert.equal(p.searchParams.get("utm_campaign"), "summer");
});

test("campaignRedirectUrl keeps a pre-set utm param and falls back to code", () => {
  const u = campaignRedirectUrl("https://dealer.com/x?utm_source=fixed", { source: "qr", codeFallback: "spring" });
  const p = new URL(u);
  assert.equal(p.searchParams.get("utm_source"), "fixed"); // not clobbered
  assert.equal(p.searchParams.get("utm_campaign"), "spring"); // fallback used
});

test("campaignRedirectUrl returns non-absolute urls unchanged", () => {
  assert.equal(campaignRedirectUrl("/relative/path", { source: "qr" }), "/relative/path");
});
