import { Router } from "express";
import { config } from "../config";
import { qrDataUrl } from "../qr";
import { renderCardPage } from "../views/card";

export const previewRouter = Router();

const isHex = (s: string) => /^#[0-9a-fA-F]{3,8}$/.test(s);
const isImg = (s: string) => /^https:\/\//.test(s) || /^\/uploads\//.test(s);
const LAYOUTS = ["classic", "banner", "minimal", "wave"];

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
  const name = (q.name ? String(q.name) : "Jordan Avery").slice(0, 60);
  const [firstName, ...rest] = name.split(" ");
  const lastName = rest.join(" ") || "Avery";
  const title = (q.title ? String(q.title) : "Sales Director").slice(0, 60);
  const company = (q.company ? String(q.company) : "Acme Co.").slice(0, 60);

  const sample: any = {
    prefix: null,
    firstName,
    lastName,
    pronouns: "she/her",
    title,
    department: null,
    company,
    bio: "Helping customers succeed, one connection at a time.",
    photoUrl: photo,
    phones: [{ label: "Work", value: "+1 555 123 4567" }],
    emails: [{ label: "Work", value: "hello@example.com" }],
    websites: [{ label: "Website", value: "https://example.com" }],
    socials: [{ type: "linkedin", value: "https://linkedin.com" }],
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

  const qr = await qrDataUrl(`${config.baseUrl}/c/preview`, primary);
  res.setHeader("Cache-Control", "no-store");
  res.send(renderCardPage(sample, qr, config.baseUrl));
});
