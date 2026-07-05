import PDFDocument from "pdfkit";
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
    return isJpeg || isPng ? buf : null;
  } catch {
    return null;
  }
}

const isHex = (s: string) => /^#[0-9a-fA-F]{3,8}$/.test(s);

export async function buildIdCardPdf(input: IdCardInput, orientation: "landscape" | "portrait" = "landscape"): Promise<Buffer> {
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
    const PHOTO_H = 96;
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
    // White body rises over the photo bottom along the wave curve…
    const yL = PHOTO_H - 10; // curve start (left edge)
    const yR = PHOTO_H - 16; // curve end (right edge)
    doc
      .moveTo(0, yL)
      .bezierCurveTo(W * 0.3, yL + 14, W * 0.7, yR - 12, W, yR)
      .lineTo(W, H)
      .lineTo(0, H)
      .closePath()
      .fill("#ffffff");
    // …with the primary-colored wave line on top of the seam.
    doc
      .moveTo(0, yL)
      .bezierCurveTo(W * 0.3, yL + 14, W * 0.7, yR - 12, W, yR)
      .lineWidth(2)
      .stroke(primary);
    if (logo) doc.image(logo, W - 56, PHOTO_H + 2, { fit: [44, 12], align: "right" });
    doc.fillColor("#111111").font("Helvetica-Bold").fontSize(11.5);
    doc.text(name, 12, PHOTO_H + 20, { width: W - 24, lineBreak: false, ellipsis: true });
    if (input.title) {
      doc.fillColor(primary).font("Helvetica").fontSize(7.5);
      doc.text(input.title, 12, PHOTO_H + 35, { width: W - 24, lineBreak: false, ellipsis: true });
    }
    doc.fillColor("#777777").font("Helvetica").fontSize(6);
    doc.text(input.orgName, 12, PHOTO_H + (input.title ? 46 : 35), { width: W - 24, lineBreak: false, ellipsis: true });
    const QR = 66;
    doc.image(qr, (W - QR) / 2, H - QR - 20, { width: QR, height: QR });
    doc.fillColor("#666666").font("Helvetica").fontSize(5);
    doc.text("SCAN TO CONNECT", 0, H - 14, { width: W, align: "center", characterSpacing: 0.6 });
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

  doc.end();
  return done;
}
