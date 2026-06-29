import type { Card } from "@prisma/client";
import { asLabeled, asSocials, Address } from "./types";

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

// vCard 3.0 (RFC 6350-ish, 3.0 for broadest mobile compatibility — iOS/Android).
export function buildVCard(card: Card): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];

  const last = card.lastName || "";
  const first = card.firstName || "";
  lines.push(`N:${esc(last)};${esc(first)};;${esc(card.prefix || "")};`);
  const fn = [card.prefix, first, last].filter(Boolean).join(" ");
  lines.push(`FN:${esc(fn)}`);

  if (card.company) lines.push(`ORG:${esc(card.company)}${card.department ? ";" + esc(card.department) : ""}`);
  if (card.title) lines.push(`TITLE:${esc(card.title)}`);
  if (card.bio) lines.push(`NOTE:${esc(card.bio)}`);

  for (const p of asLabeled(card.phones)) {
    if (p.value) lines.push(`TEL;TYPE=${esc((p.label || "WORK").toUpperCase())},VOICE:${esc(p.value)}`);
  }
  for (const e of asLabeled(card.emails)) {
    if (e.value) lines.push(`EMAIL;TYPE=${esc((e.label || "WORK").toUpperCase())}:${esc(e.value)}`);
  }
  for (const w of asLabeled(card.websites)) {
    if (w.value) lines.push(`URL:${esc(w.value)}`);
  }
  for (const s of asSocials(card.socials)) {
    if (s.value) lines.push(`URL:${esc(s.value)}`);
  }

  const addr = card.address as Address | null;
  if (addr) {
    lines.push(
      `ADR;TYPE=WORK:;;${esc(addr.line1 || "")};${esc(addr.city || "")};${esc(
        addr.region || ""
      )};${esc(addr.postal || "")};${esc(addr.country || "")}`
    );
  }

  if (card.photoUrl) lines.push(`PHOTO;VALUE=URI:${esc(card.photoUrl)}`);

  lines.push("END:VCARD");
  return lines.join("\r\n");
}
