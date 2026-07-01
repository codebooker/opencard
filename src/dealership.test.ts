import { test } from "node:test";
import assert from "node:assert/strict";
import {
  httpUrl,
  telHref,
  rooftopCtas,
  parseOemBrands,
  ctasFromJson,
  parseCtaLines,
  ctaLinesFromJson,
  mergeCtas,
  type Cta,
} from "./dealership";

test("httpUrl accepts absolute and bare domains, rejects junk", () => {
  assert.equal(httpUrl("https://acmeford.com"), "https://acmeford.com");
  assert.equal(httpUrl("http://acmeford.com/x"), "http://acmeford.com/x");
  assert.equal(httpUrl("acmeford.com"), "https://acmeford.com");
  assert.equal(httpUrl("acmeford.com/sales"), "https://acmeford.com/sales");
  assert.equal(httpUrl("  acmeford.com  "), "https://acmeford.com");
  assert.equal(httpUrl("tbd"), null);
  assert.equal(httpUrl(""), null);
  assert.equal(httpUrl(null), null);
});

test("telHref keeps + and digits, rejects too-short", () => {
  assert.equal(telHref("(555) 123-4567"), "tel:5551234567");
  assert.equal(telHref("+1 555 123 4567"), "tel:+15551234567");
  assert.equal(telHref("123"), null);
  assert.equal(telHref(""), null);
  assert.equal(telHref(null), null);
});

test("rooftopCtas builds ordered, valid CTAs", () => {
  const ctas = rooftopCtas({
    salesUrl: "acmeford.com/inventory",
    serviceUrl: "https://acmeford.com/service",
    phone: "(555) 123-4567",
    website: "acmeford.com",
  });
  assert.deepEqual(
    ctas.map((c) => c.kind),
    ["sales", "service", "call", "site"]
  );
  assert.equal(ctas[0].href, "https://acmeford.com/inventory");
  assert.equal(ctas[2].href, "tel:5551234567");
  assert.ok(ctas.every((c) => c.track.startsWith("cta:")));
});

test("rooftopCtas drops missing/invalid entries", () => {
  const ctas = rooftopCtas({ salesUrl: "tbd", serviceUrl: null, phone: "555-000-1234", website: "" });
  assert.deepEqual(ctas.map((c) => c.kind), ["call"]);
});

test("rooftopCtas empty profile -> no CTAs", () => {
  assert.deepEqual(rooftopCtas({}), []);
});

test("ctasFromJson validates urls + labels, drops junk, caps", () => {
  const ctas = ctasFromJson([
    { label: "Book service", url: "acmeford.com/svc" },
    { label: "", url: "acmeford.com" }, // no label
    { label: "Bad", url: "nope" }, // invalid url
    { label: "Text us", url: "https://acmeford.com/text" },
  ]);
  assert.deepEqual(ctas.map((c) => c.label), ["Book service", "Text us"]);
  assert.equal(ctas[0].href, "https://acmeford.com/svc");
  assert.ok(ctas.every((c) => c.kind === "custom"));
  assert.deepEqual(ctasFromJson("not-an-array"), []);
});

test("parseCtaLines parses 'Label | url' lines", () => {
  assert.deepEqual(parseCtaLines("Sales | acmeford.com/inv\nService | acmeford.com/svc"), [
    { label: "Sales", url: "acmeford.com/inv" },
    { label: "Service", url: "acmeford.com/svc" },
  ]);
  assert.deepEqual(parseCtaLines("no pipe here"), []);
  assert.deepEqual(parseCtaLines("  |  "), []);
  assert.deepEqual(parseCtaLines(null), []);
});

test("ctaLinesFromJson round-trips with parseCtaLines", () => {
  const stored = [{ label: "Sales", url: "acmeford.com/inv" }];
  const text = ctaLinesFromJson(stored);
  assert.equal(text, "Sales | acmeford.com/inv");
  assert.deepEqual(parseCtaLines(text), stored);
});

test("mergeCtas puts department first, de-dupes by href, caps", () => {
  const dept: Cta[] = [{ label: "Book service", href: "https://a.com/svc", track: "cta:custom", kind: "custom" }];
  const rooftop = rooftopCtas({ phone: "555-123-4567", website: "a.com", serviceUrl: "a.com/svc" });
  const merged = mergeCtas(dept, rooftop);
  // department service CTA first; rooftop's duplicate service href dropped
  assert.equal(merged[0].href, "https://a.com/svc");
  assert.equal(merged.filter((c) => c.href === "https://a.com/svc").length, 1);
  assert.ok(merged.some((c) => c.kind === "call"));
});

test("parseOemBrands handles arrays, strings, dedupe, cap", () => {
  assert.deepEqual(parseOemBrands(["Ford", "Lincoln"]), ["Ford", "Lincoln"]);
  assert.deepEqual(parseOemBrands("Ford, Lincoln, Ford"), ["Ford", "Lincoln"]);
  assert.deepEqual(parseOemBrands("Ford\nToyota\n  \nKia"), ["Ford", "Toyota", "Kia"]);
  assert.deepEqual(parseOemBrands(" ford , FORD "), ["ford"]); // case-insensitive dedupe keeps first
  assert.equal(parseOemBrands(Array.from({ length: 30 }, (_, i) => "B" + i)).length, 12);
  assert.deepEqual(parseOemBrands(null), []);
  assert.deepEqual(parseOemBrands(42), []);
});
