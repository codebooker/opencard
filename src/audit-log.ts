import { prisma } from "./db";

// Fire-and-forget audit write — never throws into the caller, never awaited.
export function recordAudit(e: {
  orgId: string;
  actor?: { email?: string | null; role?: string | null } | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  summary?: string | null;
  ip?: string | null;
}): void {
  prisma.auditLog
    .create({
      data: {
        orgId: e.orgId,
        actorEmail: e.actor?.email ?? null,
        actorRole: e.actor?.role ?? null,
        action: e.action,
        targetType: e.targetType ?? null,
        targetId: e.targetId ?? null,
        summary: e.summary ?? null,
        ip: e.ip ?? null,
      },
    })
    .catch(() => {});
}

// Best-effort client IP. req.ip honors the `trust proxy` hop count configured
// in server.ts; never read X-Forwarded-For directly (leftmost value is
// client-controlled).
export function reqIp(req: any): string | null {
  return req?.ip || req?.socket?.remoteAddress || null;
}
