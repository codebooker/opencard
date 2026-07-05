import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIdCardPdf } from "./idcard";

const person = {
  firstName: "Maria",
  lastName: "Lopez",
  title: "Sales Consultant",
  photoUrl: null, // vector initials fallback — no disk/network in tests
  logoUrl: null,
  slug: "maria-lopez",
  primaryColor: "#1F5BEA",
  orgName: "Acme Motors",
};

test("landscape ID card is a valid PDF at exact CR80 size (243x153pt)", async () => {
  const pdf = await buildIdCardPdf(person, "landscape");
  const s = pdf.toString("latin1");
  assert.ok(s.startsWith("%PDF-"), "PDF header");
  assert.match(s, /MediaBox \[0 0 243 153\]/);
  assert.ok(pdf.length > 1500, "has real content");
});

test("portrait ID card swaps the dimensions", async () => {
  const pdf = await buildIdCardPdf(person, "portrait");
  assert.match(pdf.toString("latin1"), /MediaBox \[0 0 153 243\]/);
});

test("bad primary color falls back instead of corrupting the PDF", async () => {
  const pdf = await buildIdCardPdf({ ...person, primaryColor: "javascript:alert(1)" }, "landscape");
  assert.ok(pdf.toString("latin1").startsWith("%PDF-"));
});
