import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAssetDestination, assetTypeLabel } from "./assets";

const BASE = "https://tapshare.cards";
const rooftop = { salesUrl: "acmeford.com/inventory", serviceUrl: "acmeford.com/service", website: "acmeford.com" };

test("landing -> render landing", () => {
  assert.deepEqual(resolveAssetDestination({ destinationType: "landing" }, rooftop, { cardBaseUrl: BASE }), {
    kind: "landing",
  });
});

test("url -> redirect (normalized) or notfound", () => {
  assert.deepEqual(
    resolveAssetDestination({ destinationType: "url", destinationUrl: "acmeford.com/summer" }, rooftop, { cardBaseUrl: BASE }),
    { kind: "redirect", url: "https://acmeford.com/summer" }
  );
  assert.deepEqual(
    resolveAssetDestination({ destinationType: "url", destinationUrl: "tbd" }, rooftop, { cardBaseUrl: BASE }),
    { kind: "notfound" }
  );
});

test("card -> redirect to /c/<slug>, notfound without slug", () => {
  assert.deepEqual(
    resolveAssetDestination({ destinationType: "card", destinationCardSlug: "manager-mike" }, rooftop, { cardBaseUrl: BASE + "/" }),
    { kind: "redirect", url: "https://tapshare.cards/c/manager-mike" }
  );
  assert.deepEqual(
    resolveAssetDestination({ destinationType: "card", destinationCardSlug: "" }, rooftop, { cardBaseUrl: BASE }),
    { kind: "notfound" }
  );
});

test("sales/service use rooftop URLs, notfound if unset", () => {
  assert.deepEqual(resolveAssetDestination({ destinationType: "sales" }, rooftop, { cardBaseUrl: BASE }), {
    kind: "redirect",
    url: "https://acmeford.com/inventory",
  });
  assert.deepEqual(resolveAssetDestination({ destinationType: "service" }, rooftop, { cardBaseUrl: BASE }), {
    kind: "redirect",
    url: "https://acmeford.com/service",
  });
  assert.deepEqual(
    resolveAssetDestination({ destinationType: "sales" }, { salesUrl: null }, { cardBaseUrl: BASE }),
    { kind: "notfound" }
  );
});

test("unknown destination type -> notfound", () => {
  assert.deepEqual(resolveAssetDestination({ destinationType: "bogus" }, rooftop, { cardBaseUrl: BASE }), {
    kind: "notfound",
  });
});

test("assetTypeLabel maps known + falls back", () => {
  assert.equal(assetTypeLabel("vehicle"), "Vehicle window QR");
  assert.equal(assetTypeLabel("campaign"), "Campaign QR");
  assert.equal(assetTypeLabel("mystery"), "mystery");
});
