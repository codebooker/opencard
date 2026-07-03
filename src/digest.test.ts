import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv, csvCell } from "./csv";
import { parseDigestEmails, digestDue, buildDigest } from "./digest";

test("csvCell quotes commas/quotes/newlines only", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('he said "hi"'), '"he said ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell(42), "42");
  assert.equal(csvCell(null), "");
});

test("csvCell neutralizes formula-leading characters", () => {
  assert.equal(csvCell("=HYPERLINK(\"http://evil\")"), `"'=HYPERLINK(""http://evil"")"`);
  assert.equal(csvCell("+15551234567"), "'+15551234567");
  assert.equal(csvCell("-cmd"), "'-cmd");
  assert.equal(csvCell("@import"), "'@import");
  assert.equal(csvCell(-5), "-5"); // real numbers pass through
});

test("toCsv joins rows with CRLF", () => {
  const out = toCsv([
    ["Rooftop", "Views", "Leads"],
    ["Acme, Inc", 10, 3],
  ]);
  assert.equal(out, 'Rooftop,Views,Leads\r\n"Acme, Inc",10,3');
});

test("parseDigestEmails keeps valid addresses across separators", () => {
  assert.deepEqual(parseDigestEmails("a@x.com, b@y.com; notanemail c@z.co"), ["a@x.com", "b@y.com", "c@z.co"]);
  assert.deepEqual(parseDigestEmails(""), []);
});

test("digestDue: off never, weekly when never sent or 7+ days", () => {
  const now = new Date("2026-07-10T00:00:00Z");
  assert.equal(digestDue("off", null, now), false);
  assert.equal(digestDue("weekly", null, now), true);
  assert.equal(digestDue("weekly", "2026-07-09T00:00:00Z", now), false); // 1 day ago
  assert.equal(digestDue("weekly", "2026-07-02T00:00:00Z", now), true); // 8 days ago
});

test("buildDigest has subject + key metrics + top lists", () => {
  const d = buildDigest("Mullinax Ford", "Last 7 days", {
    views: 40,
    vcards: 5,
    clicks: 12,
    assetScans: 8,
    leads: 9,
    conversion: 22.5,
    topRooftops: [{ name: "Central FL", leads: 6 }],
    topSources: [{ key: "Employee card", count: 8 }],
  });
  assert.match(d.subject, /Mullinax Ford .*digest .*Last 7 days/);
  assert.match(d.text, /Leads captured:\s+9/);
  assert.match(d.text, /View → lead rate: 22.5%/);
  assert.match(d.text, /Central FL — 6/);
  assert.match(d.text, /Employee card: 8/);
});
