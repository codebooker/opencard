// Pure wallet-pass builders — no db/crypto here. Produce the Apple pass.json and
// the Google Wallet object + save-JWT claims from card data. Signing (Apple
// pkpass, Google RS256 JWT) lives in wallet-sign.ts, gated on credentials.

import { asLabeled } from "./types";

function contactFields(card: any) {
  const phones = asLabeled(card.phones);
  const emails = asLabeled(card.emails);
  const loc = card.location || {};
  const brand = loc.brand || {};
  return {
    fullName: [card.firstName, card.lastName].filter(Boolean).join(" ") || "Contact",
    title: card.title || "",
    company: card.company || brand.name || "",
    phone: phones[0]?.value || loc.phone || "",
    email: emails[0]?.value || card.ownerEmail || "",
    primary: card.primaryColor || loc.primaryColor || brand.primaryColor || "#1f6f43",
  };
}

// Apple Wallet pass.json (storeCard). `ids` come from the Apple developer account.
export function buildApplePass(
  card: any,
  ids: { passTypeId: string; teamId: string },
  cardUrl: string
): Record<string, any> {
  const c = contactFields(card);
  const rows = (label: string, value: string) => (value ? [{ key: label.toLowerCase(), label, value }] : []);
  return {
    formatVersion: 1,
    passTypeIdentifier: ids.passTypeId,
    teamIdentifier: ids.teamId,
    organizationName: c.company || "OpenCard",
    description: `${c.fullName}${c.company ? " — " + c.company : ""}`,
    serialNumber: String(card.slug),
    logoText: c.company,
    foregroundColor: "rgb(255,255,255)",
    backgroundColor: hexToRgb(c.primary),
    labelColor: "rgb(255,255,255)",
    barcodes: [{ format: "PKBarcodeFormatQR", message: cardUrl, messageEncoding: "iso-8859-1" }],
    storeCard: {
      primaryFields: [{ key: "name", label: "", value: c.fullName }],
      secondaryFields: [...rows("Title", c.title), ...rows("Company", c.company)],
      auxiliaryFields: [...rows("Phone", c.phone), ...rows("Email", c.email)],
      backFields: [{ key: "card", label: "Digital card", value: cardUrl }],
    },
  };
}

// Google Wallet generic object for a contact card.
export function buildGoogleGenericObject(card: any, issuerId: string, cardUrl: string): Record<string, any> {
  const c = contactFields(card);
  const tm: any[] = [];
  if (c.phone) tm.push({ header: "Phone", body: c.phone });
  if (c.email) tm.push({ header: "Email", body: c.email });
  return {
    id: `${issuerId}.${card.slug}`,
    classId: `${issuerId}.opencard_contact`,
    genericType: "GENERIC_TYPE_UNSPECIFIED",
    hexBackgroundColor: /^#[0-9a-fA-F]{6}$/.test(c.primary) ? c.primary : "#1f6f43",
    cardTitle: { defaultValue: { language: "en-US", value: c.company || "Contact" } },
    header: { defaultValue: { language: "en-US", value: c.fullName } },
    subheader: c.title ? { defaultValue: { language: "en-US", value: c.title } } : undefined,
    textModulesData: tm,
    barcode: { type: "QR_CODE", value: cardUrl },
  };
}

// The "Save to Google Wallet" JWT claims (signed RS256 with the service account).
export function googleSaveClaims(
  object: Record<string, any>,
  ctx: { serviceEmail: string; origins: string[]; now?: Date }
): Record<string, any> {
  return {
    iss: ctx.serviceEmail,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor((ctx.now || new Date()).getTime() / 1000),
    origins: ctx.origins,
    payload: { genericObjects: [object] },
  };
}

export function googleSaveUrl(jwt: string): string {
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

// "#rrggbb" -> "rgb(r,g,b)" (Apple expects rgb()); falls back to a brand green.
export function hexToRgb(hex: string | null | undefined): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ""));
  if (!m) return "rgb(31,111,67)";
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
}
