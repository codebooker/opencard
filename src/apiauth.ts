import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { prisma } from "./db";
import { ApiScope, hasScope, sanitizeScopes } from "./api-scopes";

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

// The org an authenticated API request is scoped to (attached by requireApi).
export const apiOrgId = (req: Request): string => (req as any).apiOrgId;

// The scopes granted to the request. null = unrestricted (admin token / legacy key).
export const apiScopes = (req: Request): string[] | null => (req as any).apiScopes ?? null;

// Generate a new API key. The raw value is shown to the admin ONCE; we store its hash.
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = "oc_live_" + crypto.randomBytes(24).toString("hex");
  return { raw, hash: sha256(raw), prefix: raw.slice(0, 16) };
}

// Authenticate a REST API request and resolve its tenant (org) + scopes.
// Accepts only a valid issued API key (scoped to that key's org + granted
// scopes). The unrestricted ADMIN_TOKEN master-key path was removed — API
// access is now always a per-key, revocable credential.
export async function requireApi(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "missing_bearer_token" });

  const key = await prisma.apiKey.findUnique({ where: { keyHash: sha256(token) } });
  if (!key || key.revoked) return res.status(401).json({ error: "invalid_api_key" });
  const keyOrg = await prisma.org.findUnique({ where: { id: key.orgId }, select: { suspended: true } });
  if (keyOrg?.suspended) return res.status(403).json({ error: "org_suspended" });

  (req as any).apiOrgId = key.orgId;
  (req as any).apiScopes = sanitizeScopes(key.scopes);
  // Fire-and-forget usage metadata (last used time + route).
  prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date(), lastUsedPath: `${req.method} ${req.baseUrl}${req.path}` } })
    .catch(() => {});
  next();
}

// Route guard: require a specific scope (the admin token / unrestricted keys pass).
export function requireScope(scope: ApiScope) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (hasScope(apiScopes(req), scope)) return next();
    return res.status(403).json({ error: "insufficient_scope", required: scope });
  };
}
