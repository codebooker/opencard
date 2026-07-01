import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asStringArray,
  effectiveSelfFields,
  isHidden,
  resolveShowQr,
  renderSignature,
} from "./roletemplate";

const DEFAULTS = ["photo", "bio", "phones", "emails", "socials"];

test("asStringArray coerces defensively", () => {
  assert.deepEqual(asStringArray(["a", "b"]), ["a", "b"]);
  assert.deepEqual(asStringArray(["a", 1, null, "b"]), ["a", "b"]);
  assert.deepEqual(asStringArray("nope"), []);
  assert.deepEqual(asStringArray(null), []);
});

test("effectiveSelfFields: card override wins over brand, then locked removed", () => {
  // brand policy, minus locked
  assert.deepEqual(
    effectiveSelfFields(null, ["photo", "bio", "phones"], ["phones"], DEFAULTS),
    ["photo", "bio"]
  );
  // card override used as base
  assert.deepEqual(
    effectiveSelfFields(["photo", "title"], ["bio"], [], DEFAULTS),
    ["photo", "title"]
  );
  // defaults when neither set
  assert.deepEqual(effectiveSelfFields(null, null, [], DEFAULTS), DEFAULTS);
});

test("effectiveSelfFields: locked beats a card-level grant (governance)", () => {
  assert.deepEqual(
    effectiveSelfFields(["photo", "phones", "emails"], null, ["phones", "emails"], DEFAULTS),
    ["photo"]
  );
});

test("isHidden reflects the hidden list", () => {
  assert.equal(isHidden("bio", ["bio", "socials"]), true);
  assert.equal(isHidden("title", ["bio"]), false);
});

test("resolveShowQr walks card -> template -> brand -> true", () => {
  assert.equal(resolveShowQr(false, true, true), false); // card wins
  assert.equal(resolveShowQr(null, false, true), false); // template wins
  assert.equal(resolveShowQr(null, null, false), false); // brand wins
  assert.equal(resolveShowQr(null, null, null), true); // default
  assert.equal(resolveShowQr(undefined, undefined, undefined), true);
});

test("renderSignature substitutes tokens, blanks unknown/missing", () => {
  const tpl = "{{fullName}}\n{{title}} | {{company}}\n{{phone}} · {{missing}}";
  const out = renderSignature(tpl, {
    fullName: "Jane Rivera",
    title: "Service Advisor",
    company: "Acme Ford",
    phone: "555-123-4567",
  });
  assert.equal(out, "Jane Rivera\nService Advisor | Acme Ford\n555-123-4567 · ");
  assert.equal(renderSignature(null, {}), "");
  assert.equal(renderSignature("{{ firstName }}", { firstName: "Jane" }), "Jane"); // tolerant of spaces
});
