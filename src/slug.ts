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
