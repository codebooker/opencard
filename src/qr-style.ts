// Styled QR rendering — pure SVG built from the qrcode module matrix, so we can
// draw branded codes (colors, gradients, dot styles, center logo) without any
// native image dependency. Scannability guardrails: finder patterns always
// render high-contrast, and a center logo forces error-correction level H with
// a bounded knockout window.

import QRCode from "qrcode";

export type QrModuleStyle = "square" | "rounded" | "dots";

export interface QrDesign {
  style: QrModuleStyle;
  fill: string; // module color (gradient start when fill2 set)
  fill2?: string | null; // optional gradient end
  bg: string; // background; "transparent" allowed
  logoUrl?: string | null; // center logo (same-origin path, absolute URL, or data URL)
}

export const DEFAULT_QR_DESIGN: QrDesign = {
  style: "square",
  fill: "#111827",
  fill2: null,
  bg: "#ffffff",
  logoUrl: null,
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(s: unknown): s is string {
  return typeof s === "string" && HEX.test(s);
}

function safeColor(s: unknown, fallback: string): string {
  return isHexColor(s) ? s : fallback;
}

function safeLogoUrl(s: unknown): string | null {
  if (typeof s !== "string" || !s.trim()) return null;
  const v = s.trim();
  // Same-origin uploads, absolute https, or an inline data image only.
  if (v.startsWith("/uploads/")) return v;
  if (/^https:\/\/\S+$/i.test(v) && v.length < 600) return v;
  if (/^data:image\/(png|jpeg|svg\+xml);base64,/i.test(v) && v.length < 200_000) return v;
  return null;
}

// Parse a stored JSON design (or a partial object) into a safe, complete QrDesign.
export function parseQrDesign(raw: unknown): QrDesign | null {
  if (raw === null || raw === undefined || raw === "") return null;
  let obj: any = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const style: QrModuleStyle = obj.style === "rounded" || obj.style === "dots" ? obj.style : "square";
  const fill = safeColor(obj.fill, DEFAULT_QR_DESIGN.fill);
  const fill2 = isHexColor(obj.fill2) ? obj.fill2 : null;
  const bg = obj.bg === "transparent" ? "transparent" : safeColor(obj.bg, DEFAULT_QR_DESIGN.bg);
  const logoUrl = safeLogoUrl(obj.logoUrl);
  return { style, fill, fill2, bg, logoUrl };
}

// Serialize a design for storage; null when it equals the default (store nothing).
export function serializeQrDesign(d: QrDesign | null): string | null {
  if (!d) return null;
  const c = parseQrDesign(d) || DEFAULT_QR_DESIGN;
  const def = DEFAULT_QR_DESIGN;
  if (c.style === def.style && c.fill === def.fill && !c.fill2 && c.bg === def.bg && !c.logoUrl) return null;
  return JSON.stringify(c);
}

interface Matrix {
  size: number;
  get(x: number, y: number): boolean;
}

function matrixFor(url: string, ecc: "M" | "H"): Matrix {
  const q = QRCode.create(url, { errorCorrectionLevel: ecc });
  const size = q.modules.size;
  const data = q.modules.data as Uint8Array;
  return { size, get: (x, y) => !!data[y * size + x] };
}

const FINDER = 7; // finder pattern is 7x7 modules

function inFinder(x: number, y: number, size: number): boolean {
  const tl = x < FINDER && y < FINDER;
  const tr = x >= size - FINDER && y < FINDER;
  const bl = x < FINDER && y >= size - FINDER;
  return tl || tr || bl;
}

// Rounded-rect path helper (r may be 0).
function rrect(x: number, y: number, w: number, h: number, r: number, fill: string): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
}

// One finder pattern: outer ring + inner eye, styled to match the module style.
function finder(px: number, py: number, m: number, style: QrModuleStyle, fill: string, bg: string): string {
  // Keep rounding modest: scanners locate finders by the 1:1:3:1:1 dark/light
  // ratio across scanlines, and aggressive corner rounding erodes it.
  const rOut = style === "square" ? 0 : m * 1.4;
  const rMid = style === "square" ? 0 : m * 1.0;
  const rIn = style === "dots" ? m * 1.5 : style === "rounded" ? m * 0.75 : 0;
  const bgFill = bg === "transparent" ? "#ffffff" : bg;
  return (
    rrect(px, py, m * 7, m * 7, rOut, fill) +
    rrect(px + m, py + m, m * 5, m * 5, rMid, bgFill) +
    rrect(px + m * 2, py + m * 2, m * 3, m * 3, rIn, fill)
  );
}

export interface QrSvgOptions {
  size?: number; // rendered width/height in px (default 600)
  margin?: number; // quiet zone in modules (default 2)
}

// Render a styled QR as a standalone SVG string.
export function qrSvg(url: string, design?: QrDesign | null, opts: QrSvgOptions = {}): string {
  const d = design ? (parseQrDesign(design) as QrDesign) : DEFAULT_QR_DESIGN;
  const px = Math.max(120, Math.min(2000, opts.size || 600));
  const margin = opts.margin ?? 2;
  const mat = matrixFor(url, d.logoUrl ? "H" : "M");
  const n = mat.size;
  const total = n + margin * 2;
  const m = px / total; // module size in px
  const off = margin * m;

  // Center logo knockout window (modules), only when a logo is set. ~24% of
  // the code width — safe under ECC H (30% recoverable).
  const winMod = d.logoUrl ? Math.floor(n * 0.24) | 1 : 0; // odd for symmetry
  const winStart = Math.floor((n - winMod) / 2);
  const inWindow = (x: number, y: number) =>
    winMod > 0 && x >= winStart && x < winStart + winMod && y >= winStart && y < winStart + winMod;

  // Gradient id must be unique per rendered SVG: several codes can share one
  // page (admin lists, galleries) and duplicate ids would bleed across them.
  const gid = `qg${d.fill.slice(1)}${(d.fill2 || "").slice(1)}`;
  const fillRef = d.fill2 ? `url(#${gid})` : d.fill;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}" role="img" aria-label="QR code">`
  );
  if (d.fill2) {
    parts.push(
      `<defs><linearGradient id="${gid}" x1="0%" y1="0%" x2="100%" y2="100%">` +
        `<stop offset="0%" stop-color="${d.fill}"/><stop offset="100%" stop-color="${d.fill2}"/>` +
        `</linearGradient></defs>`
    );
  }
  if (d.bg !== "transparent") parts.push(rrect(0, 0, px, px, 0, d.bg));

  // Data modules (finder cells drawn separately).
  const r = d.style === "rounded" ? m * 0.32 : 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!mat.get(x, y) || inFinder(x, y, n) || inWindow(x, y)) continue;
      const cx = off + x * m;
      const cy = off + y * m;
      if (d.style === "dots") {
        parts.push(`<circle cx="${(cx + m / 2).toFixed(2)}" cy="${(cy + m / 2).toFixed(2)}" r="${(m * 0.47).toFixed(2)}" fill="${fillRef}"/>`);
      } else {
        parts.push(
          `<rect x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" width="${(m * 0.92).toFixed(2)}" height="${(m * 0.92).toFixed(2)}" rx="${r.toFixed(2)}" fill="${fillRef}"/>`
        );
      }
    }
  }

  // Finder patterns, always solid + on-style.
  parts.push(finder(off, off, m, d.style, fillRef, d.bg));
  parts.push(finder(off + (n - FINDER) * m, off, m, d.style, fillRef, d.bg));
  parts.push(finder(off, off + (n - FINDER) * m, m, d.style, fillRef, d.bg));

  // Center logo on a white tile.
  if (d.logoUrl && winMod > 0) {
    const wpx = winMod * m;
    const wx = off + winStart * m;
    const pad = m * 0.6;
    parts.push(rrect(wx, wx, wpx, wpx, m, "#ffffff"));
    parts.push(
      `<image href="${d.logoUrl.replace(/"/g, "&quot;")}" x="${(wx + pad).toFixed(2)}" y="${(wx + pad).toFixed(2)}" ` +
        `width="${(wpx - pad * 2).toFixed(2)}" height="${(wpx - pad * 2).toFixed(2)}" preserveAspectRatio="xMidYMid meet"/>`
    );
  }

  parts.push("</svg>");
  return parts.join("");
}

// Parse the admin QR-designer form fields into a stored design string (or null
// for "inherit / default"). `logoUrl` is the brand logo to embed when the
// "logo in the middle" box is ticked.
export function qrDesignFromForm(b: Record<string, any>, logoUrl?: string | null): string | null {
  if (!b || b.qrMode !== "custom") return null;
  return serializeQrDesign({
    style: b.qrStyle === "rounded" || b.qrStyle === "dots" ? b.qrStyle : "square",
    fill: safeColor(b.qrFill, DEFAULT_QR_DESIGN.fill),
    fill2: b.qrGradient ? (isHexColor(b.qrFill2) ? b.qrFill2 : null) : null,
    bg: b.qrBgTransparent ? "transparent" : safeColor(b.qrBg, DEFAULT_QR_DESIGN.bg),
    logoUrl: b.qrLogo ? safeLogoUrl(logoUrl) : null,
  });
}

// Resolve the effective design for an entity: its own stored design, else the
// brand's, else a default tinted with the brand primary color.
export function resolveQrDesign(
  own: string | null | undefined,
  brand: string | null | undefined,
  brandPrimary?: string | null
): QrDesign {
  return (
    parseQrDesign(own ?? null) ??
    parseQrDesign(brand ?? null) ??
    (isHexColor(brandPrimary) ? { ...DEFAULT_QR_DESIGN, fill: brandPrimary } : DEFAULT_QR_DESIGN)
  );
}
