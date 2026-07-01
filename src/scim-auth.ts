import crypto from "crypto";
import { prisma } from "./db";
import { config } from "./config";
import { defaultOrgId } from "./tenant";

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

// Generate a new per-org SCIM token. The raw value is shown to the admin once;
// we store only its hash on the Org.
export function generateScimToken(): { raw: string; hash: string } {
  const raw = "scim_" + crypto.randomBytes(24).toString("hex");
  return { raw, hash: sha256(raw) };
}

export function scimTokenHash(raw: string): string {
  return sha256(raw);
}

// Resolve which org a SCIM bearer token belongs to, or null if unknown.
//   * The legacy global SCIM_TOKEN maps to the default org (back-compat).
//   * Otherwise the token is matched by hash against Org.scimTokenHash.
export async function resolveScimOrg(token: string): Promise<string | null> {
  if (!token) return null;
  if (config.scimToken && token === config.scimToken) return defaultOrgId();
  const org = await prisma.org.findFirst({ where: { scimTokenHash: sha256(token) }, select: { id: true } });
  return org?.id ?? null;
}
