import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseQrDesign,
  serializeQrDesign,
  qrSvg,
  resolveQrDesign,
  DEFAULT_QR_DESIGN,
  isHexColor,
} from "./qr-style";

test("parseQrDesign: accepts valid JSON and rejects junk", () => {
  assert.equal(parseQrDesign(null), null);
  assert.equal(parseQrDesign(""), null);
  assert.equal(parseQrDesign("not json"), null);
  const d = parseQrDesign(JSON.stringify({ style: "dots", fill: "#1F5BEA", fill2: "#25D1B3", bg: "#ffffff" }))!;
  assert.equal(d.style, "dots");
  assert.equal(d.fill, "#1F5BEA");
  assert.equal(d.fill2, "#25D1B3");
});

test("parseQrDesign: sanitizes bad values to safe defaults", () => {
  const d = parseQrDesign({ style: "spiky", fill: "javascript:alert(1)", bg: "red", logoUrl: "http://evil/x.png" })!;
  assert.equal(d.style, "square");
  assert.equal(d.fill, DEFAULT_QR_DESIGN.fill);
  assert.equal(d.bg, DEFAULT_QR_DESIGN.bg);
  assert.equal(d.logoUrl, null);
});

test("parseQrDesign: transparent background and upload logo pass through", () => {
  const d = parseQrDesign({ style: "rounded", fill: "#111827", bg: "transparent", logoUrl: "/uploads/logo.png" })!;
  assert.equal(d.bg, "transparent");
  assert.equal(d.logoUrl, "/uploads/logo.png");
});

test("serializeQrDesign: default design stores as null", () => {
  assert.equal(serializeQrDesign({ ...DEFAULT_QR_DESIGN }), null);
  const s = serializeQrDesign({ ...DEFAULT_QR_DESIGN, fill: "#1F5BEA" })!;
  assert.equal(JSON.parse(s).fill, "#1F5BEA");
});

test("qrSvg: renders a well-formed SVG with background and modules", () => {
  const svg = qrSvg("https://opencard.id/c/test");
  assert.ok(svg.startsWith("<svg "));
  assert.ok(svg.endsWith("</svg>"));
  assert.ok(svg.includes('fill="#ffffff"')); // bg
  assert.ok(svg.includes('fill="#111827"')); // modules
  assert.ok(!svg.includes("<image")); // no logo by default
});

test("qrSvg: gradient produces defs and a per-design gradient id", () => {
  const svg = qrSvg("https://opencard.id/c/test", { style: "dots", fill: "#1F5BEA", fill2: "#25D1B3", bg: "#ffffff" });
  assert.ok(svg.includes("<linearGradient"));
  assert.ok(svg.includes('fill="url(#qg1F5BEA25D1B3)"'));
  assert.ok(svg.includes("<circle")); // dots style
  // A different palette must not collide with this one on the same page.
  const other = qrSvg("https://opencard.id/c/test", { style: "dots", fill: "#7c1fea", fill2: "#ea1f8b", bg: "#ffffff" });
  assert.ok(other.includes('fill="url(#qg7c1feaea1f8b)"'));
});

test("qrSvg: logo adds an image tile and keeps finders", () => {
  const svg = qrSvg("https://opencard.id/c/test", {
    style: "rounded",
    fill: "#111827",
    fill2: null,
    bg: "#ffffff",
    logoUrl: "/uploads/logo.png",
  });
  assert.ok(svg.includes("<image"));
  assert.ok(svg.includes("/uploads/logo.png"));
});

test("qrSvg: escapes/refuses hostile logo urls", () => {
  const svg = qrSvg("https://opencard.id/c/test", {
    style: "square",
    fill: "#111827",
    fill2: null,
    bg: "#ffffff",
    logoUrl: '"/><script>alert(1)</script>',
  });
  assert.ok(!svg.includes("<script"));
});

test("resolveQrDesign: own > brand > primary-tinted default", () => {
  const own = JSON.stringify({ style: "dots", fill: "#222222", bg: "#ffffff" });
  const brand = JSON.stringify({ style: "rounded", fill: "#333333", bg: "#ffffff" });
  assert.equal(resolveQrDesign(own, brand).style, "dots");
  assert.equal(resolveQrDesign(null, brand).style, "rounded");
  assert.equal(resolveQrDesign(null, null, "#1f6f43").fill, "#1f6f43");
  assert.equal(resolveQrDesign(null, null, null).fill, DEFAULT_QR_DESIGN.fill);
});

test("isHexColor", () => {
  assert.equal(isHexColor("#1F5BEA"), true);
  assert.equal(isHexColor("1F5BEA"), false);
  assert.equal(isHexColor("#12345"), false);
});
