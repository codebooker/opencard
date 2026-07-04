import crypto from "crypto";
import { prisma } from "./db";

// Account lifecycle primitives: revocable admin sessions, single-use auth
// tokens (password reset / invite / email verification), and MFA recovery
// codes. Raw secrets never touch the database — only SHA-256 hashes.

export const sha256hex = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

export function newRawToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

// ---------- single-use auth tokens ----------
export type TokenKind = "reset" | "invite" | "verify" | "signup";

export const TOKEN_TTL_MS: Record<TokenKind, number> = {
  reset: 60 * 60 * 1000, // 1 hour
  invite: 7 * 24 * 60 * 60 * 1000, // 7 days
  verify: 7 * 24 * 60 * 60 * 1000, // 7 days
  signup: 24 * 60 * 60 * 1000, // 24 hours — magic link to start an account
};

export async function issueToken(kind: TokenKind, email: string, orgId?: string | null): Promise<string> {
  const raw = newRawToken();
  // Invalidate any earlier outstanding tokens of the same kind for this email
  // so only the newest link works.
  await prisma.authToken.updateMany({
    where: { kind, email: email.toLowerCase(), usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.authToken.create({
    data: {
      kind,
      tokenHash: sha256hex(raw),
      email: email.toLowerCase(),
      orgId: orgId ?? null,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS[kind]),
    },
  });
  return raw;
}

// Validate without consuming (for rendering the set-password form).
export async function peekToken(kind: TokenKind, raw: string) {
  if (!raw) return null;
  const t = await prisma.authToken.findUnique({ where: { tokenHash: sha256hex(raw) } });
  if (!t || t.kind !== kind || t.usedAt || t.expiresAt.getTime() < Date.now()) return null;
  return t;
}

// Validate and mark used (single use).
export async function consumeToken(kind: TokenKind, raw: string) {
  const t = await peekToken(kind, raw);
  if (!t) return null;
  const updated = await prisma.authToken.updateMany({
    where: { id: t.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  return updated.count === 1 ? t : null; // count 0 = raced another consume
}

// ---------- admin sessions ----------
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // matches the old cookie lifetime
export const SESSION_COOKIE = "oc_admsess";

export async function createSession(adminUserId: string, ip?: string | null, userAgent?: string | null): Promise<string> {
  const raw = newRawToken();
  await prisma.adminSession.create({
    data: {
      tokenHash: sha256hex(raw),
      adminUserId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ip: ip || null,
      userAgent: (userAgent || "").slice(0, 250) || null,
    },
  });
  return raw;
}

// Resolve a live session (unexpired, unrevoked) from the raw cookie value.
export async function findSession(raw?: string) {
  if (!raw) return null;
  const s = await prisma.adminSession.findUnique({ where: { tokenHash: sha256hex(raw) } });
  if (!s || s.revokedAt || s.expiresAt.getTime() < Date.now()) return null;
  // Throttled activity touch — fire-and-forget.
  if (Date.now() - s.lastSeenAt.getTime() > 5 * 60 * 1000) {
    prisma.adminSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return s;
}

export async function revokeSession(id: string, adminUserId: string): Promise<void> {
  await prisma.adminSession.updateMany({ where: { id, adminUserId, revokedAt: null }, data: { revokedAt: new Date() } });
}

// Revoke every session for an admin (password change, reset, deactivation),
// optionally keeping one (the session doing the change).
export async function revokeAllSessions(adminUserId: string, exceptId?: string): Promise<number> {
  const r = await prisma.adminSession.updateMany({
    where: { adminUserId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return r.count;
}

export async function listSessions(adminUserId: string) {
  return prisma.adminSession.findMany({
    where: { adminUserId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
  });
}

// ---------- MFA recovery codes ----------
// Unambiguous alphabet (no 0/O/1/I/L) — codes look like "k3mp-x7ne".
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function generateRecoveryCodes(n = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    let c = "";
    const bytes = crypto.randomBytes(8);
    for (let j = 0; j < 8; j++) c += CODE_ALPHABET[bytes[j] % CODE_ALPHABET.length];
    codes.push(`${c.slice(0, 4)}-${c.slice(4)}`);
  }
  return codes;
}

export function normalizeRecoveryCode(input: string): string {
  return String(input || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hashRecoveryCodes(codes: string[]): string[] {
  return codes.map((c) => sha256hex(normalizeRecoveryCode(c)));
}

// True + consumes when `input` matches an unused recovery code.
export async function consumeRecoveryCode(adminUserId: string, input: string): Promise<boolean> {
  const norm = normalizeRecoveryCode(input);
  if (norm.length < 8) return false;
  const au = await prisma.adminUser.findUnique({ where: { id: adminUserId }, select: { recoveryCodes: true } });
  const hashes = Array.isArray(au?.recoveryCodes) ? (au!.recoveryCodes as string[]) : [];
  const h = sha256hex(norm);
  if (!hashes.includes(h)) return false;
  await prisma.adminUser.update({
    where: { id: adminUserId },
    data: { recoveryCodes: hashes.filter((x) => x !== h) },
  });
  return true;
}

export function recoveryCodeCount(recoveryCodes: unknown): number {
  return Array.isArray(recoveryCodes) ? recoveryCodes.length : 0;
}
