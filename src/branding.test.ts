import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHost, safeColor, loginBranding } from "./branding";

test("normalizeHost lowercases and strips port + trailing dot", () => {
  assert.equal(normalizeHost("Cards.MullinaxFord.com:443"), "cards.mullinaxford.com");
  assert.equal(normalizeHost("cards.mullinaxford.com."), "cards.mullinaxford.com");
  assert.equal(normalizeHost(""), "");
  assert.equal(normalizeHost(null), "");
});

test("safeColor only accepts hex, else falls back", () => {
  assert.equal(safeColor("#1F5BEA"), "#1F5BEA");
  assert.equal(safeColor("#abc"), "#abc");
  assert.equal(safeColor("red; } body{display:none"), "#1F5BEA"); // CSS-injection attempt rejected
  assert.equal(safeColor(null, "#123"), "#123");
});

test("loginBranding: rooftop overrides brand logo + color, falls back otherwise", () => {
  const brand = { name: "Mullinax Ford", logoUrl: "https://x/brand.png", primaryColor: "#003478", textColor: "#111", bgColor: "#fff" };
  const withLoc = loginBranding(brand, { logoUrl: "https://x/rooftop.png", primaryColor: "#0A7" });
  assert.equal(withLoc!.name, "Mullinax Ford");
  assert.equal(withLoc!.logoUrl, "https://x/rooftop.png"); // rooftop logo wins
  assert.equal(withLoc!.primary, "#0A7"); // rooftop color wins
  const brandOnly = loginBranding(brand);
  assert.equal(brandOnly!.logoUrl, "https://x/brand.png");
  assert.equal(brandOnly!.primary, "#003478");
});

test("loginBranding returns null with no brand, and defaults a missing color", () => {
  assert.equal(loginBranding(null), null);
  const b = loginBranding({ name: "X" });
  assert.equal(b!.logoUrl, null);
  assert.equal(b!.primary, "#1F5BEA"); // default OpenCard blue
});
