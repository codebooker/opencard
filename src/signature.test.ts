import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSignatureModel,
  renderSignatureHtml,
  renderSignatureText,
  activeCampaignBanner,
  resolveDisclaimer,
  asLockList,
  isSignatureLocked,
  normalizeTheme,
  SIGNATURE_THEMES,
} from "./signature";

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

test("activeCampaignBanner respects the start/end window", () => {
  const brand = {
    signatureBannerText: "Summer Sales Event",
    signatureBannerHref: "https://x/summer",
    signatureBannerStart: "2026-06-01T00:00:00Z",
    signatureBannerEnd: "2026-08-31T23:59:59Z",
  };
  assert.deepEqual(activeCampaignBanner(brand, new Date("2026-07-01T12:00:00Z")), {
    text: "Summer Sales Event",
    href: "https://x/summer",
  });
  assert.equal(activeCampaignBanner(brand, new Date("2026-05-15T12:00:00Z")), null); // before start
  assert.equal(activeCampaignBanner(brand, new Date("2026-09-15T12:00:00Z")), null); // after end
  assert.equal(activeCampaignBanner({ signatureBannerText: "" }, new Date()), null); // no text
  // open-ended (no bounds) is always active when text is present
  assert.ok(activeCampaignBanner({ signatureBannerText: "Always" }, new Date()));
});

test("resolveDisclaimer: rooftop overrides template, trims, falls back", () => {
  assert.equal(resolveDisclaimer("Rooftop terms", "Template terms"), "Rooftop terms");
  assert.equal(resolveDisclaimer("  ", "Template terms"), "Template terms"); // blank rooftop -> template
  assert.equal(resolveDisclaimer(null, "Template terms"), "Template terms");
  assert.equal(resolveDisclaimer(null, null), null);
});

test("lock helpers validate against known elements", () => {
  assert.deepEqual(asLockList(["banner", "disclaimer", "bogus", 7]), ["banner", "disclaimer"]);
  assert.deepEqual(asLockList("nope"), []);
  assert.equal(isSignatureLocked(["banner"], "banner"), true);
  assert.equal(isSignatureLocked(["banner"], "ctas"), false);
});

test("normalizeTheme clamps unknowns to classic", () => {
  assert.equal(normalizeTheme("modern"), "modern");
  assert.equal(normalizeTheme("bogus"), "classic");
  assert.equal(normalizeTheme(undefined), "classic");
});

test("every theme renders a table with the person's name + card link", () => {
  for (const [theme] of SIGNATURE_THEMES) {
    const m = buildSignatureModel(card, { cardBaseUrl: "https://tapshare.cards", theme, banner: { text: "Promo", href: null } });
    const html = renderSignatureHtml(m);
    assert.match(html, /<table/, theme);
    assert.match(html, /Jane Rivera/, theme);
    assert.match(html, /c\/jane-sales/, theme);
    assert.match(html, /Promo/, theme); // banner appears in all themes
  }
});

test("card-derived theme is honored via location.signatureTheme", () => {
  const themed = { ...card, location: { ...card.location, signatureTheme: "modern" } };
  const m = buildSignatureModel(themed, { cardBaseUrl: "https://tapshare.cards" });
  assert.equal(m.theme, "modern");
});

test("location disclaimer overrides template disclaimer in the model", () => {
  const themed = { ...card, location: { ...card.location, signatureDisclaimer: "Rooftop-only terms" } };
  const m = buildSignatureModel(themed, { cardBaseUrl: "https://tapshare.cards" });
  assert.equal(m.disclaimer, "Rooftop-only terms");
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
