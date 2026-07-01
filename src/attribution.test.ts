import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUtm, deviceFromUa, normalizePreferredContact, cleanReferrer } from "./attribution";

test("parseUtm extracts utm params + campaign (?campaign, ?c, fallback)", () => {
  assert.deepEqual(
    parseUtm({ utm_source: "facebook", utm_medium: "cpc", utm_campaign: "summer", campaign: "spring" }),
    { campaign: "spring", utmSource: "facebook", utmMedium: "cpc", utmCampaign: "summer" }
  );
  // short ?c= wins over utm_campaign when no ?campaign=
  assert.equal(parseUtm({ c: "lotA", utm_campaign: "summer" }).campaign, "lotA");
  // falls back to utm_campaign
  assert.equal(parseUtm({ utm_campaign: "summer" }).campaign, "summer");
  // array query values -> first
  assert.equal(parseUtm({ utm_source: ["fb", "x"] }).utmSource, "fb");
  // empty
  assert.deepEqual(parseUtm({}), { campaign: null, utmSource: null, utmMedium: null, utmCampaign: null });
});

test("deviceFromUa classifies", () => {
  assert.equal(deviceFromUa("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148"), "mobile");
  assert.equal(deviceFromUa("Mozilla/5.0 (iPad; CPU OS 17_0) Safari"), "tablet");
  assert.equal(deviceFromUa("Mozilla/5.0 (Linux; Android 13; SM-G991B) Mobile Safari"), "mobile");
  assert.equal(deviceFromUa("Mozilla/5.0 (Linux; Android 13; Tablet) Safari"), "tablet"); // android no 'mobile'
  assert.equal(deviceFromUa("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari"), "desktop");
  assert.equal(deviceFromUa("Googlebot/2.1 (+http://www.google.com/bot.html)"), "bot");
  assert.equal(deviceFromUa(""), "unknown");
  assert.equal(deviceFromUa(null), "unknown");
});

test("normalizePreferredContact validates against the set", () => {
  assert.equal(normalizePreferredContact("Email"), "email");
  assert.equal(normalizePreferredContact("phone"), "phone");
  assert.equal(normalizePreferredContact("text"), "text");
  assert.equal(normalizePreferredContact("any"), "any");
  assert.equal(normalizePreferredContact("carrier pigeon"), null);
  assert.equal(normalizePreferredContact(""), null);
  assert.equal(normalizePreferredContact(null), null);
});

test("cleanReferrer keeps real URLs, caps, rejects junk", () => {
  assert.equal(cleanReferrer("https://facebook.com/ad/123"), "https://facebook.com/ad/123");
  assert.equal(cleanReferrer("android-app://x"), null);
  assert.equal(cleanReferrer("not a url"), null);
  assert.equal(cleanReferrer(""), null);
  assert.equal((cleanReferrer("https://x.com/" + "a".repeat(500)) || "").length, 300);
});
