// Rasterize a styled QR (see qr-style.ts) to PNG for printers and tools that
// won't take SVG. Local /uploads logos are inlined as data URLs first — the
// SVG rasterizer never fetches external resources.

import fs from "fs";
import path from "path";
import sharp from "sharp";
import { qrPng as plainQrPng } from "./qr";
import { qrSvg, QrDesign } from "./qr-style";
import { uploadDir } from "./upload";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

// Inline a same-origin /uploads/<file> logo as a data URL so it renders inside
// the rasterized SVG. Anything else (remote URLs) is dropped for PNG output.
function inlineLogo(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  if (logoUrl.startsWith("data:")) return logoUrl;
  if (!logoUrl.startsWith("/uploads/")) return null;
  try {
    const name = path.basename(logoUrl); // strips any traversal
    const file = path.join(uploadDir, name);
    const ext = path.extname(name).toLowerCase();
    const mime = MIME[ext];
    if (!mime || !fs.existsSync(file)) return null;
    const buf = fs.readFileSync(file);
    if (buf.length > 2_000_000) return null;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// Render the styled QR as a PNG buffer. Falls back to the plain single-color
// PNG if rasterization fails, so the endpoint never breaks.
export async function styledQrPng(
  url: string,
  design: QrDesign,
  fallbackColor: string,
  size = 600
): Promise<Buffer> {
  try {
    const d: QrDesign = { ...design, logoUrl: inlineLogo(design.logoUrl) };
    const svg = qrSvg(url, d, { size });
    return await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  } catch {
    return plainQrPng(url, fallbackColor);
  }
}
