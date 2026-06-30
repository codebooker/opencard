import { test } from "node:test";
import assert from "node:assert/strict";
import { clean, parseLabeled, parseSocials, parseAddress } from "./parse";

test("clean trims and nulls empty", () => {
  assert.equal(clean("  hi "), "hi");
  assert.equal(clean(""), null);
  assert.equal(clean("   "), null);
  assert.equal(clean(undefined), null);
});

test("parseLabeled parses 'Label | value' lines and skips empties", () => {
  const out = parseLabeled("Work | +1 555 123 4567\n\nMobile | +1 555 987 6543\n");
  assert.deepEqual(out, [
    { label: "Work", value: "+1 555 123 4567" },
    { label: "Mobile", value: "+1 555 987 6543" },
  ]);
});

test("parseLabeled keeps a bare value with empty label", () => {
  assert.deepEqual(parseLabeled("justavalue"), [{ label: "", value: "justavalue" }]);
});

test("parseSocials lowercases type and keeps url", () => {
  assert.deepEqual(parseSocials("LinkedIn | https://linkedin.com/in/jane"), [
    { type: "linkedin", value: "https://linkedin.com/in/jane" },
  ]);
});

test("parseAddress builds a clean map or null", () => {
  assert.deepEqual(parseAddress({ addr_city: "Toronto", addr_country: "Canada", addr_line1: "" }), {
    city: "Toronto",
    country: "Canada",
  });
  assert.equal(parseAddress({ addr_city: "", addr_country: "  " }), null);
});
