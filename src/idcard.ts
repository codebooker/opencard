import PDFDocument from "pdfkit";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { qrPng } from "./qr";
import { uploadDir } from "./upload";
import { config } from "./config";

// Printable ID card (CR80): a credit-card-sized PDF of a person's card —
// photo, logo, name, title, and a BLACK QR to their public card URL — sized
// exactly for badge printers (Datacard/Entrust, Fargo, Zebra…). One tap on
// the badge = their business card.
//
// CR80 is 3.375" x 2.125" = 243 x 153 points at 72dpi. Printers rasterize
// the vector/QR content at their native resolution, so edges stay crisp.

const CR80_W = 243;
const CR80_H = 153;

export type IdCardInput = {
  firstName: string;
  lastName: string;
  title?: string | null;
  photoUrl?: string | null;
  logoUrl?: string | null;
  slug: string;
  primaryColor: string;
  orgName: string; // brand or company line under the title
  // The digital card's resolved layout — the badge mirrors the design family
  // where a print translation exists (currently: wave). Others use the
  // accent-band layout.
  layout?: string | null;
};

// pdfkit embeds JPEG and PNG only. Uploads live on disk; external URLs are
// fetched (https, small, with a timeout). Anything else — webp/gif/avif,
// fetch errors, bad magic bytes — returns null and the layout falls back.
async function loadImage(url: string | null | undefined): Promise<Buffer | null> {
  try {
    if (!url) return null;
    let buf: Buffer | null = null;
    if (url.startsWith("/uploads/")) {
      const file = path.join(uploadDir, path.basename(url));
      if (fs.existsSync(file)) buf = fs.readFileSync(file);
    } else if (/^https:\/\//.test(url)) {
      const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (resp.ok) {
        const ab = await resp.arrayBuffer();
        if (ab.byteLength <= 8 * 1024 * 1024) buf = Buffer.from(ab);
      }
    }
    if (!buf || buf.length < 8) return null;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    if (isJpeg || isPng) return buf;
    // webp/gif/avif uploads (allowed on cards) can't go into a PDF directly —
    // transcode to PNG. Any failure just drops the image, never the badge.
    try {
      return await sharp(buf).png().toBuffer();
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

const isHex = (s: string) => /^#[0-9a-fA-F]{3,8}$/.test(s);

export async function buildIdCardPdf(
  input: IdCardInput,
  orientation: "landscape" | "portrait" = "landscape",
  withBack = false,
  backStyle: BackStyle = "cubes"
): Promise<Buffer> {
  const W = orientation === "landscape" ? CR80_W : CR80_H;
  const H = orientation === "landscape" ? CR80_H : CR80_W;
  const primary = isHex(input.primaryColor) ? input.primaryColor : "#1f6f43";
  const name = `${input.firstName} ${input.lastName}`.trim() || "—";
  const cardUrl = `${config.cardUrl}/c/${input.slug}`;

  const [photo, logo, qr] = await Promise.all([
    loadImage(input.photoUrl),
    loadImage(input.logoUrl),
    qrPng(cardUrl, "#000000"), // always black: badge printers love pure K
  ]);

  const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `${name} — ID card` } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  // Background + accent band.
  doc.rect(0, 0, W, H).fill("#ffffff");
  const BAND = orientation === "landscape" ? 10 : 8;
  doc.rect(0, 0, W, BAND).fill(primary);

  const circlePhoto = (cx: number, cy: number, r: number) => {
    if (photo) {
      doc.save();
      doc.circle(cx, cy, r).clip();
      doc.image(photo, cx - r, cy - r, { cover: [r * 2, r * 2], align: "center", valign: "center" });
      doc.restore();
      doc.circle(cx, cy, r).lineWidth(1).stroke(primary);
    } else {
      // Vector fallback: tinted circle with initials.
      doc.circle(cx, cy, r).fill(primary);
      const initials = `${(input.firstName[0] || "").toUpperCase()}${(input.lastName[0] || "").toUpperCase()}` || "?";
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(r * 0.9);
      doc.text(initials, cx - r, cy - r * 0.48, { width: r * 2, align: "center" });
    }
  };

  if (orientation === "landscape") {
    // Left: photo + identity. Right: QR.
    const QR = 92;
    const qrX = W - QR - 14;
    const qrY = (H - BAND - QR) / 2 + BAND - 4;
    doc.image(qr, qrX, qrY, { width: QR, height: QR });
    doc.fillColor("#666666").font("Helvetica").fontSize(5);
    doc.text("SCAN TO CONNECT", qrX, qrY + QR + 3, { width: QR, align: "center", characterSpacing: 0.6 });

    circlePhoto(44, 62, 27);
    const textX = 14;
    const textW = qrX - textX - 10;
    doc.fillColor("#111111").font("Helvetica-Bold").fontSize(12);
    doc.text(name, textX, 98, { width: textW, lineBreak: false, ellipsis: true });
    if (input.title) {
      doc.fillColor(primary).font("Helvetica").fontSize(8);
      doc.text(input.title, textX, 114, { width: textW, lineBreak: false, ellipsis: true });
    }
    doc.fillColor("#777777").font("Helvetica").fontSize(6.5);
    doc.text(input.orgName, textX, input.title ? 126 : 114, { width: textW, lineBreak: false, ellipsis: true });
    if (logo) doc.image(logo, W - 62, H - 20, { fit: [50, 12], align: "right" });
  } else if (input.layout === "wave") {
    // Portrait wave badge: the digital wave card, translated to print —
    // full-bleed photo up top, the signature curve, logo under it, identity
    // left-aligned, black QR at the bottom.
    const PHOTO_H = 132; // generous hero — the photo is the point
    // Cover the accent band too; the wave hero owns the whole top.
    if (photo) {
      doc.save();
      doc.rect(0, 0, W, PHOTO_H).clip();
      doc.image(photo, 0, 0, { cover: [W, PHOTO_H], align: "center", valign: "center" });
      doc.restore();
    } else {
      doc.rect(0, 0, W, PHOTO_H).fill(primary);
      const initials = `${(input.firstName[0] || "").toUpperCase()}${(input.lastName[0] || "").toUpperCase()}` || "?";
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(34);
      doc.text(initials, 0, PHOTO_H / 2 - 17, { width: W, align: "center" });
    }
    // White body rises along the customer-supplied hump: flat low on the
    // left, S-sweep up to a high shelf on the right (Jack's SVG geometry,
    // scaled: x-span 210 -> W, rise 40.43 -> proportional).
    const lowY = PHOTO_H - 8;
    const rise = W * (40.43 / 210);
    const x1 = W * (97.45 / 210); // end of the flat left run
    const hump = () =>
      doc
        .moveTo(0, lowY)
        .lineTo(x1, lowY)
        .bezierCurveTo(
          x1 + W * (21.36 / 210), lowY - rise * (0.559 / 40.43),
          x1 + W * (31.13 / 210), lowY - rise * (39.32 / 40.43),
          x1 + W * (55.13 / 210), lowY - rise
        )
        .lineTo(W, lowY - rise);
    hump().lineTo(W, H).lineTo(0, H).closePath().fill("#ffffff");
    // …with the primary-colored ribbon on the seam.
    hump().lineWidth(4).stroke(primary);
    if (logo) doc.image(logo, W - 52, PHOTO_H - 8 - W * (40.43 / 210) + 10, { fit: [40, 11], align: "right" });
    doc.fillColor("#111111").font("Helvetica-Bold").fontSize(11.5);
    doc.text(name, 12, PHOTO_H + 2, { width: W - 24, lineBreak: false, ellipsis: true });
    if (input.title) {
      doc.fillColor(primary).font("Helvetica").fontSize(7.5);
      doc.text(input.title, 12, PHOTO_H + 17, { width: W - 24, lineBreak: false, ellipsis: true });
    }
    doc.fillColor("#777777").font("Helvetica").fontSize(6);
    doc.text(input.orgName, 12, PHOTO_H + (input.title ? 27 : 17), { width: W - 24, lineBreak: false, ellipsis: true });
    const QR = 54;
    doc.image(qr, (W - QR) / 2, H - QR - 13, { width: QR, height: QR });
    doc.fillColor("#666666").font("Helvetica").fontSize(5);
    doc.text("SCAN TO CONNECT", 0, H - 9, { width: W, align: "center", characterSpacing: 0.6 });
  } else {
    // Portrait badge: photo top-center, identity, QR bottom.
    circlePhoto(W / 2, 46, 30);
    doc.fillColor("#111111").font("Helvetica-Bold").fontSize(11);
    doc.text(name, 10, 84, { width: W - 20, align: "center", lineBreak: false, ellipsis: true });
    if (input.title) {
      doc.fillColor(primary).font("Helvetica").fontSize(7.5);
      doc.text(input.title, 10, 99, { width: W - 20, align: "center", lineBreak: false, ellipsis: true });
    }
    doc.fillColor("#777777").font("Helvetica").fontSize(6);
    doc.text(input.orgName, 10, input.title ? 110 : 99, { width: W - 20, align: "center", lineBreak: false, ellipsis: true });
    const QR = 96;
    doc.image(qr, (W - QR) / 2, H - QR - 24, { width: QR, height: QR });
    doc.fillColor("#666666").font("Helvetica").fontSize(5);
    doc.text("SCAN TO CONNECT", 0, H - 18, { width: W, align: "center", characterSpacing: 0.6 });
    if (logo) doc.image(logo, (W - 60) / 2, H - 11, { fit: [60, 8], align: "center" });
  }

  if (withBack) drawBackPage(doc, W, H, primary, name, input.orgName, backStyle, input.slug);

  doc.end();
  return done;
}

// ---- Card back (page 2, for duplex badge printers) ----
// Jack's design: mirrored isometric-cube lattice, split vertically — one half
// in the brand primary, the other in a darkened shade — with the name and
// company running vertically in white. Pattern geometry lifted from his SVG
// (Inkscape "Cubes" cell, 142x123 units).

// Darken a hex color by multiplying channels (f < 1 = darker).
export function shadeHex(hex: string, f: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// The five paths of one pattern cell, with their fill opacities.
const CUBE_CELL: { d: string; op: number }[] = [
  { d: "M 0.002,0.002 V 0.004 L 35.51,20.504 71.01,0.008 106.51,20.504 142,0.014 V 0.002 Z", op: 0.6 },
  {
    d: "m 35.504,61.5 0.004,0.002 v 41 L 0,123.002 V 81.998 Z M 142.012,0 l 0.004,0.002 v 41 l -35.508,20.5 V 20.498 Z m -71,0 0.004,0.002 v 41 L 35.508,61.502 V 20.498 Z m 35.492,61.5 0.004,0.002 v 41 L 71,123.002 V 81.998 Z",
    op: 0.3,
  },
  {
    d: "m 106.496,61.5 -0.004,0.002 v 41 L 142,123.002 V 81.998 Z M 71.004,0 71,0.002 v 41 l 35.508,20.5 V 20.498 Z m -71,0 L 0,0.002 v 41 L 35.508,61.502 V 20.498 Z m 35.492,61.5 -0.004,0.002 v 41 L 71,123.002 V 81.998 Z",
    op: 1,
  },
  {
    d: "m 70.998,41.002 -35.5,20.496 L 0,41.004 v 40.998 l 0.002,0.002 35.5,-20.496 35.5,20.496 L 106.502,61.508 142,82.002 V 41.004 l -0.002,-0.002 -35.5,20.496 z",
    op: 0.6,
  },
  { d: "M 35.506,102.502 0.002,123 v 0.002 H 142 v -0.008 l -35.494,-20.492 -35.5,20.496 z", op: 0.6 },
];

function drawCubeLayer(
  doc: PDFKit.PDFDocument,
  W: number,
  H: number,
  color: string,
  mirror: boolean,
  phaseX: number
) {
  const CELL_W = 142;
  const CELL_H = 123;
  // Jack's SVG: pattern cell at scale 0.4 inside a 0.178 group = 10.1mm
  // cells -> ~28.7pt on the badge.
  const scale = 28.66 / CELL_W;
  doc.save();
  doc.rect(0, 0, W, H).clip();
  if (mirror) {
    // Mirror about the card's vertical center line, like the SVG's
    // scale(-1,1) rect (its phase offset keeps the lattice aligned).
    doc.translate(W, 0);
    doc.scale(-1, 1);
  }
  const cols = Math.ceil(W / (CELL_W * scale)) + 2;
  const rows = Math.ceil(H / (CELL_H * scale)) + 1;
  const startX = -((phaseX % (CELL_W * scale)) + CELL_W * scale) % (CELL_W * scale);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      doc.save();
      doc.translate(startX + cx * CELL_W * scale, cy * CELL_H * scale);
      doc.scale(scale, scale);
      for (const p of CUBE_CELL) {
        doc.path(p.d).fillOpacity(p.op).fill(color);
      }
      doc.restore();
    }
  }
  doc.restore();
  doc.fillOpacity(1);
}

// Blend the primary toward white; w=1 -> full primary, w=0 -> white.
function tint(primary: string, w: number): string {
  const h = primary.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  const ch = (v: number) => Math.round(255 - (255 - v) * w);
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// Deterministic PRNG so a person's badge back is identical on every print.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Jack's second back design (cardback2.svg, v2): a solid brand-color
// rectangle with the gray triangle mosaic laid over it at 40% opacity —
// subtle texture on brand color; recoloring only touches the rectangle.
function drawTriangleBack(doc: PDFKit.PDFDocument, W: number, H: number, seedKey: string) {
  const GRAYS = [0x94, 0xa5, 0xb4, 0xe1, 0xf2, 0xfe];
  const palette = GRAYS.map((g) => `#${((g << 16) | (g << 8) | g).toString(16).padStart(6, "0")}`);
  const rnd = mulberry32(hashStr(seedKey));
  const CW = 12.1; // column width (77 units at the SVG's effective scale)
  const HH = 6.7; // half a triangle's vertical span (44.456 units)
  const cols = Math.ceil(W / CW) + 1;
  const rows = Math.ceil(H / HH) + 2;
  const pick = () => palette[Math.floor(rnd() * palette.length)];
  doc.save();
  doc.fillOpacity(0.18); // subtle texture — the brand color must stay dominant
  for (let c = 0; c < cols; c++) {
    const x0 = c * CW;
    for (let r = -1; r < rows; r++) {
      const y = r * HH;
      // Left-pointing: vertical edge on the right column line.
      doc
        .moveTo(x0 + CW, y + HH)
        .lineTo(x0, y)
        .lineTo(x0 + CW, y - HH)
        .closePath()
        .fill(pick());
      // Right-pointing: vertical edge on the left column line.
      doc
        .moveTo(x0, y + 2 * HH)
        .lineTo(x0, y)
        .lineTo(x0 + CW, y + HH)
        .closePath()
        .fill(pick());
    }
  }
  doc.restore();
  doc.fillOpacity(1);
}

export type BackStyle = "cubes" | "triangles";

function drawBackPage(
  doc: PDFKit.PDFDocument,
  W: number,
  H: number,
  primary: string,
  name: string,
  orgName: string,
  style: BackStyle = "cubes",
  seedKey = ""
) {
  doc.addPage({ size: [W, H], margin: 0 });
  doc.rect(0, 0, W, H).fill("#ffffff");
  if (style === "triangles") {
    doc.rect(0, 0, W, H).fill(primary); // THE recolorable rectangle
    drawTriangleBack(doc, W, H, seedKey || name);
    drawBackText(doc, W, H, name, orgName);
    return;
  }
  // Jack's layering: the DARK pattern underneath, the primary-colored pattern
  // mirrored on top with a phase shift — the translucent cube faces blend the
  // two into one continuous two-tone lattice (no seam, no visible mirror).
  const dark = shadeHex(primary, 0.64);
  drawCubeLayer(doc, W, H, dark, false, 0);
  drawCubeLayer(doc, W, H, primary, true, 14.2);
  drawBackText(doc, W, H, name, orgName);
}

// Vertical text, reading top-to-bottom from the top edge (per Jack's SVGs):
// name down the LEFT edge, company down the RIGHT edge.
function drawBackText(doc: PDFKit.PDFDocument, W: number, H: number, name: string, orgName: string, outline?: string) {
  const vtext = (t: string, anchorX: number) => {
    doc.save();
    doc.rotate(90, { origin: [anchorX, 10] });
    doc.font("Helvetica-Bold").fontSize(9).fillOpacity(1);
    const opts = { width: H - 24, characterSpacing: 0.9, lineBreak: false, ellipsis: true } as any;
    // Thin dark outline keeps white text legible over light mosaic tiles.
    if (outline) {
      doc.fillColor("#f9f9f9").strokeColor(outline).lineWidth(0.8);
      doc.text(t.toUpperCase(), anchorX, 10, { ...opts, fill: true, stroke: true });
    } else {
      doc.fillColor("#f9f9f9");
      doc.text(t.toUpperCase(), anchorX, 10, opts);
    }
    doc.restore();
  };
  vtext(name, 21);
  vtext(orgName, W - 18);
}
