import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVCard } from "./vcard";

const sample: any = {
  prefix: "Mr.",
  firstName: "John",
  lastName: "Smith",
  title: "President",
  company: "Acme, Inc.",
  bio: "Vision, growth; expansion.",
  phones: [{ label: "Work", value: "+1 555 123 4567" }],
  emails: [{ label: "Work", value: "john@acme.com" }],
  websites: [{ label: "Company", value: "https://acme.com" }],
  socials: [{ type: "linkedin", value: "https://linkedin.com/in/john" }],
  address: { line1: "100 King St", city: "Toronto", region: "ON", postal: "M5H 1A1", country: "Canada" },
  photoUrl: null,
};

test("buildVCard produces a well-formed vCard 3.0", () => {
  const v = buildVCard(sample);
  for (const must of ["BEGIN:VCARD", "VERSION:3.0", "FN:Mr. John Smith", "TITLE:President", "END:VCARD"]) {
    assert.ok(v.includes(must), `missing ${must}`);
  }
  assert.ok(/TEL;TYPE=WORK[^\n]*\+1 555 123 4567/.test(v));
  assert.ok(v.includes("EMAIL;TYPE=WORK:john@acme.com"));
});

test("buildVCard escapes commas and semicolons in free text", () => {
  const v = buildVCard(sample);
  assert.ok(v.includes("Acme\\, Inc."));
  assert.ok(v.includes("growth\\; expansion"));
});
