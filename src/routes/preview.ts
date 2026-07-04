import { Router } from "express";
import { config } from "../config";
import { qrDataUrl } from "../qr";
import { renderCardPage } from "../views/card";
import { buildSignatureModel, renderSignatureHtml, normalizeTheme } from "../signature";
import { CARD_LAYOUTS } from "../layouts";

export const previewRouter = Router();

const isHex = (s: string) => /^#[0-9a-fA-F]{3,8}$/.test(s);
// blob: is allowed so the card editor's live preview can show a just-picked
// photo before upload — blob URLs only resolve same-origin, grant nothing
// remote, and are attribute-escaped like everything else.
const isImg = (s: string) => /^https:\/\//.test(s) || /^\/uploads\//.test(s) || /^blob:https?:\/\//.test(s);
const LAYOUTS: readonly string[] = CARD_LAYOUTS;

// Parse a JSON list param of {label,value} (or {type,value}) pairs, hard-capped.
function pairList(raw: unknown, keyA: string, keyB: string, cap = 4): any[] {
  try {
    const arr = JSON.parse(String(raw || "[]"));
    if (!Array.isArray(arr)) return [];
    return arr
      .slice(0, cap)
      .map((x: any) => ({ [keyA]: String(x?.[keyA] || "").slice(0, 40), [keyB]: String(x?.[keyB] || "").slice(0, 120) }))
      .filter((x: any) => x[keyB]);
  } catch {
    return [];
  }
}

// Renders a sample card styled by the query design params. Used as a live
// preview iframe in the brand/template/card design editors. No DB access.
previewRouter.get("/card", async (req, res) => {
  const q = req.query;
  const layout = LAYOUTS.includes(String(q.layout)) ? String(q.layout) : "classic";
  const primary = isHex(String(q.primary)) ? String(q.primary) : "#1f6f43";
  const text = isHex(String(q.text)) ? String(q.text) : "#111827";
  const bg = isHex(String(q.bg)) ? String(q.bg) : "#ffffff";
  const font = String(q.font || "system");
  const logo = isImg(String(q.logo)) ? String(q.logo) : null;
  const photo = isImg(String(q.photo)) ? String(q.photo) : null;
  const showQr = String(q.qr) !== "0";
  // live=1: the card editor's live preview. Every content field comes from
  // the form (empty stays empty). Without it, the design editors get the
  // usual fully-populated sample person.
  const live = String(q.live) === "1";
  const str = (v: unknown, fallback: string, max = 60) => (live ? String(v || "").slice(0, max) : v ? String(v).slice(0, max) : fallback);
  const name = str(q.name, "Jordan Avery") || "Your Name";
  const [firstName, ...rest] = name.split(" ");
  const lastName = rest.join(" ") || (live ? "" : "Avery");
  const title = str(q.title, "Sales Director");
  const company = str(q.company, "Acme Co.");
  const pronouns = str(q.pronouns, "she/her", 30) || null;
  const bio = str(q.bio, "Helping customers succeed, one connection at a time.", 300) || null;
  const department = live ? String(q.department || "").slice(0, 60) || null : null;

  const sample: any = {
    prefix: null,
    firstName,
    lastName,
    pronouns,
    title: title || null,
    department,
    company: company || null,
    bio,
    photoUrl: photo,
    phones: live ? pairList(q.phones, "label", "value") : [{ label: "Work", value: "+1 555 123 4567" }],
    emails: live ? pairList(q.emails, "label", "value") : [{ label: "Work", value: "hello@example.com" }],
    websites: live ? pairList(q.websites, "label", "value") : [{ label: "Website", value: "https://example.com" }],
    socials: live ? pairList(q.socials, "type", "value", 8) : [{ type: "linkedin", value: "https://linkedin.com" }],
    address: null,
    slug: "preview",
    layout,
    primaryColor: primary,
    logoUrl: logo,
    showQr,
    location: {
      name: "HQ",
      address: null,
      logoUrl: null,
      primaryColor: null,
      layout: null,
      brand: {
        name: company,
        logoUrl: logo,
        primaryColor: primary,
        textColor: text,
        bgColor: bg,
        font,
        layout,
      },
    },
    template: null,
  };

  const qr = await qrDataUrl(`${config.cardUrl}/c/preview`, primary);
  res.setHeader("Cache-Control", "no-store");
  res.send(renderCardPage(sample, qr, config.cardUrl));
});

// Renders a sample email signature in the given theme. Used as the live preview
// iframe in the rooftop signature-design editor. No DB access.
previewRouter.get("/signature", async (req, res) => {
  const q = req.query;
  const theme = normalizeTheme(String(q.theme || "classic"));
  const primary = isHex(String(q.primary)) ? String(q.primary) : "#1f6f43";
  const logo = isImg(String(q.logo)) ? String(q.logo) : null;
  const disclaimer = q.disclaimer ? String(q.disclaimer).slice(0, 400) : null;
  const bannerText = q.banner ? String(q.banner).slice(0, 120) : null;

  const sample: any = {
    slug: "preview",
    firstName: "Jordan",
    lastName: "Avery",
    title: "Sales Consultant",
    company: null,
    ownerEmail: "jordan.avery@example.com",
    primaryColor: primary,
    phones: [{ label: "Work", value: "(555) 123-4567" }],
    emails: [{ label: "Work", value: "jordan.avery@example.com" }],
    address: null,
    logoUrl: logo,
    location: {
      phone: "(555) 000-0000",
      logoUrl: logo,
      address: { line1: "1 Auto Way", city: "Springfield", region: "IL", postal: "62701" },
      signatureTheme: theme,
      signatureDisclaimer: disclaimer,
      brand: { name: "Acme Ford", logoUrl: logo, primaryColor: primary },
    },
    template: null,
  };
  const model = buildSignatureModel(sample, {
    cardBaseUrl: config.cardUrl,
    theme,
    ctas: [
      { label: "Shop inventory", href: "#" },
      { label: "Book service", href: "#" },
    ],
    banner: bannerText ? { text: bannerText, href: null } : null,
  });
  res.setHeader("Cache-Control", "no-store");
  res.send(
    `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body{margin:0;padding:18px;background:#fff;font-family:Arial,Helvetica,sans-serif}</style></head>
    <body>${renderSignatureHtml(model)}</body></html>`
  );
});
