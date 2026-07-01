import { prisma } from "./db";

export function baseSlug(first: string, last: string): string {
  const s = `${first}-${last}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "card";
}

// Ensure uniqueness by appending -2, -3, ... if needed.
export async function uniqueSlug(first: string, last: string): Promise<string> {
  const base = baseSlug(first, last);
  let candidate = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.card.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

// Slug from a single free-text name (for assets), unique among assets.
export function baseSlugFrom(name: string, fallback = "asset"): string {
  const s = (name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || fallback;
}

export async function uniqueAssetSlug(name: string): Promise<string> {
  const base = baseSlugFrom(name);
  let candidate = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.asset.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}
