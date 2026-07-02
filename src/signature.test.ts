import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSignatureModel, renderSignatureHtml, renderSignatureText } from "./signature";

const card = {
  slug: "jane-sales",
  firstName: "Jane",
  lastName: "Rivera",
  title: "Sales Consultant",
  company: null,
  ownerEmail: "jane@acme.com",
  primaryColor: "#D8232A",
  phones: [{ label: "Work", value: "555-123-4567" }],
  emails: [{ label: "Work", value: "jane.rivera@acme.com" }],
  address: null,
  logoUrl: null,
  location: {
    phone: "555-000-0000",
    logoUrl: "https://x/loc-logo.png",
    address: { line1: "1 Auto Way", city: "Springfield", region: "IL", postal: "62701" },
    brand: { name: "Acme Ford", logoUrl: "https://x/brand.png", primaryColor: "#111" },
  },
  template: { disclaimer: "Prices exclude tax." },
};

test("buildSignatureModel derives fields with correct precedence", () => {
  const m = buildSignatureModel(card, { cardBaseUrl: "https://tapshare.cards/", ctas: [{ label: "Inventory", href: "https://x/inv" }] });
  assert.equal(m.fullName, "Jane Rivera");
  assert.equal(m.title, "Sales Consultant");
  assert.equal(m.company, "Acme Ford"); // falls back to brand name
  assert.equal(m.email, "jane.rivera@acme.com"); // first email over ownerEmail
  assert.equal(m.phone, "555-123-4567"); // first card phone over rooftop
  assert.equal(m.address, "1 Auto Way, Springfield, IL, 62701");
  assert.equal(m.logoUrl, "https://x/loc-logo.png"); // location logo over brand
  assert.equal(m.cardUrl, "https://tapshare.cards/c/jane-sales"); // trailing slash trimmed
  assert.equal(m.qrUrl, "https://tapshare.cards/c/jane-sales/qr.png");
  assert.equal(m.disclaimer, "Prices exclude tax.");
  assert.equal(m.primary, "#D8232A");
});

test("renderSignatureHtml is table-based + has key elements, escapes", () => {
  const m = buildSignatureModel(card, { cardBaseUrl: "https://tapshare.cards", ctas: [{ label: "Inventory", href: "https://x/inv" }] });
  const html = renderSignatureHtml(m);
  assert.match(html, /<table/);
  assert.match(html, /Jane Rivera/);
  assert.match(html, /mailto:jane\.rivera@acme\.com/);
  assert.match(html, /tel:5551234567/); // phone normalized in href
  assert.match(html, /https:\/\/tapshare\.cards\/c\/jane-sales/);
  assert.match(html, /Inventory/);
  assert.match(html, /Prices exclude tax\./);
  assert.match(html, /#D8232A/); // brand color applied
});

test("banner renders only within the signature when provided", () => {
  const m = buildSignatureModel(card, { cardBaseUrl: "https://tapshare.cards", banner: { text: "Summer Sales Event", href: "https://x/summer" } });
  const html = renderSignatureHtml(m);
  assert.match(html, /Summer Sales Event/);
  assert.match(html, /https:\/\/x\/summer/);
  const noBanner = renderSignatureHtml(buildSignatureModel(card, { cardBaseUrl: "https://tapshare.cards" }));
  assert.doesNotMatch(noBanner, /Summer Sales Event/);
});

test("renderSignatureText is a plain-text fallback with the essentials", () => {
  const m = buildSignatureModel(card, { cardBaseUrl: "https://tapshare.cards", ctas: [{ label: "Inventory", href: "https://x/inv" }] });
  const text = renderSignatureText(m);
  assert.match(text, /^Jane Rivera/);
  assert.match(text, /Sales Consultant, Acme Ford/);
  assert.match(text, /555-123-4567/);
  assert.match(text, /Inventory: https:\/\/x\/inv/);
  assert.match(text, /Prices exclude tax\./);
  assert.doesNotMatch(text, /</); // no HTML tags
});
