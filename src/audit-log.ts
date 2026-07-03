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

// Best-effort client IP from proxy headers.
export function reqIp(req: any): string | null {
  const xff = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req?.ip || null;
}
