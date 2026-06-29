import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { prisma } from "./db";
import { config } from "./config";

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

// Generate a new API key. The raw value is shown to the admin ONCE; we store its hash.
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = "oc_live_" + crypto.randomBytes(24).toString("hex");
  return { raw, hash: sha256(raw), prefix: raw.slice(0, 16) };
}

// Authenticate a REST API request. Accepts a valid issued API key OR the admin token.
export async function requireApi(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "missing_bearer_token" });

  if (token === config.adminToken) return next();

  const key = await prisma.apiKey.findUnique({ where: { keyHash: sha256(token) } });
  if (!key || key.revoked) return res.status(401).json({ error: "invalid_api_key" });

  prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  next();
}
