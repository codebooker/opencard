import { test } from "node:test";
import assert from "node:assert/strict";
import { redirectTargetUrl, offboardCardUpdate, replacementCardData } from "./turnover";

const BASE = "https://tapshare.cards";

test("redirectTargetUrl: none / empty -> null", () => {
  assert.equal(redirectTargetUrl("none", { cardBaseUrl: BASE }), null);
  assert.equal(redirectTargetUrl("", { cardBaseUrl: BASE }), null);
});

test("redirectTargetUrl: rooftop uses website, normalized", () => {
  assert.equal(redirectTargetUrl("rooftop", { cardBaseUrl: BASE, rooftopWebsite: "acmeford.com" }), "https://acmeford.com");
  assert.equal(redirectTargetUrl("rooftop", { cardBaseUrl: BASE, rooftopWebsite: null }), null);
  assert.equal(redirectTargetUrl("rooftop", { cardBaseUrl: BASE, rooftopWebsite: "tbd" }), null);
});

test("redirectTargetUrl: card:<slug> builds public URL", () => {
  assert.equal(redirectTargetUrl("card:manager-mike", { cardBaseUrl: BASE }), "https://tapshare.cards/c/manager-mike");
  assert.equal(redirectTargetUrl("card:manager-mike", { cardBaseUrl: BASE + "/" }), "https://tapshare.cards/c/manager-mike");
  assert.equal(redirectTargetUrl("card:", { cardBaseUrl: BASE }), null);
});

test("offboardCardUpdate disables + revokes self-service + sets redirect", () => {
  assert.deepEqual(offboardCardUpdate(null), { active: false, ownerEmail: null, redirectUrl: null });
  assert.deepEqual(offboardCardUpdate("https://x/c/mgr"), {
    active: false,
    ownerEmail: null,
    redirectUrl: "https://x/c/mgr",
  });
});

test("replacementCardData clones role/design/placement, drops identity", () => {
  const source = {
    id: "c1",
    slug: "jane-sales",
    locationId: "loc1",
    templateId: "tpl1",
    departmentId: "dep1",
    department: "Sales",
    title: "Sales Consultant",
    company: "Acme Ford",
    layout: "wave",
    primaryColor: "#123456",
    logoUrl: "https://x/logo.png",
    showQr: false,
    selfEditFields: ["photo", "bio"],
    // identity that must NOT be cloned:
    firstName: "Jane",
    lastName: "Rivera",
    photoUrl: "https://x/jane.jpg",
    bio: "hi",
    phones: [{ label: "Work", value: "555" }],
    emails: [{ label: "Work", value: "jane@x.com" }],
    socials: [{ type: "linkedin", value: "x" }],
    pronouns: "she/her",
    ownerEmail: "jane@acme.com",
  };
  const clone = replacementCardData(source);
  // kept
  assert.equal(clone.templateId, "tpl1");
  assert.equal(clone.departmentId, "dep1");
  assert.equal(clone.title, "Sales Consultant");
  assert.equal(clone.layout, "wave");
  assert.deepEqual(clone.selfEditFields, ["photo", "bio"]);
  // dropped identity
  const keys = Object.keys(clone);
  for (const forbidden of ["firstName", "lastName", "photoUrl", "bio", "phones", "emails", "socials", "pronouns", "ownerEmail", "slug", "id"]) {
    assert.ok(!keys.includes(forbidden), `must not clone ${forbidden}`);
  }
});
