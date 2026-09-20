// Admin security routes.
import {
  Router, Prisma, SESSION_COOKIE, audit,
  config, findSession, forbidden, generateRecoveryCodes, generateTotpSecret, hashRecoveryCodes,
  issueToken, listSessions, prisma,
  qrDataUrl, recoveryCodeCount, reqAdmin, revokeAllSessions, revokeSession, sendMail,
  totpUri, verifyTotp,
} from "./context";
import { V } from "./context";

export function registerSecurityRoutes(router: Router) {
  const adminRouter = router;

// ---------- security (per-account two-factor) ----------
adminRouter.get("/security", async (req, res) => {
  const p = reqAdmin(req);
  const note =
    req.query.mfa === "on"
      ? `<p style="color:#15803d">Two-factor is now enabled.</p>`
      : req.query.mfa === "off"
      ? `<p class="muted">Two-factor disabled.</p>`
      : "";
  const workspace = (await prisma.org.findUnique({ where: { id: p.orgId }, select: { name: true } }))?.name || null;
  if (!p.email) return res.send(V.securityView({ email: null, on: false, note, workspace }));
  const au = await prisma.adminUser.findUnique({ where: { email: p.email } });
  const current = await findSession(req.cookies?.[SESSION_COOKIE]);
  const sessions = au ? await listSessions(au.id) : [];
  res.send(
    V.securityView({
      email: p.email,
      on: !!au?.mfaEnabled,
      note,
      workspace,
      recoveryCount: recoveryCodeCount(au?.recoveryCodes),
      sessions: sessions.map((s) => ({
        id: s.id,
        current: s.id === current?.id,
        lastSeenAt: s.lastSeenAt,
        createdAt: s.createdAt,
        ip: s.ip,
        userAgent: s.userAgent,
      })),
    })
  );
});

adminRouter.post("/security/mfa/start", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.email) return forbidden(res);
  const secret = generateTotpSecret();
  await prisma.adminUser.update({ where: { email: p.email }, data: { mfaSecret: secret, mfaEnabled: false } });
  const uri = totpUri(secret, p.email);
  res.send(V.mfaSetupView(await qrDataUrl(uri, "#111827"), secret));
});

adminRouter.post("/security/mfa/enable", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.email) return forbidden(res);
  const au = await prisma.adminUser.findUnique({ where: { email: p.email } });
  if (!au?.mfaSecret || !verifyTotp(au.mfaSecret, String(req.body?.code || ""))) {
    return res.status(401).send(V.mfaSetupView(await qrDataUrl(totpUri(au?.mfaSecret || "", p.email), "#111827"), au?.mfaSecret || "", "Incorrect code, try again."));
  }
  // Enable MFA and hand out single-use recovery codes (shown exactly once).
  const codes = generateRecoveryCodes();
  await prisma.adminUser.update({
    where: { email: p.email },
    data: { mfaEnabled: true, recoveryCodes: hashRecoveryCodes(codes) },
  });
  audit(req, p, "security.mfa_enabled", { targetType: "AdminUser", summary: p.email });
  res.send(V.recoveryCodesView(codes, "Two-factor is on. Save these recovery codes now — they're shown only once."));
});

adminRouter.post("/security/recovery/regenerate", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.email) return forbidden(res);
  const au = await prisma.adminUser.findUnique({ where: { email: p.email }, select: { mfaEnabled: true } });
  if (!au?.mfaEnabled) return res.redirect("/admin/security");
  const codes = generateRecoveryCodes();
  await prisma.adminUser.update({ where: { email: p.email }, data: { recoveryCodes: hashRecoveryCodes(codes) } });
  audit(req, p, "security.recovery_regenerated", { targetType: "AdminUser", summary: p.email });
  res.send(V.recoveryCodesView(codes, "New recovery codes. Your previous codes no longer work."));
});

adminRouter.post("/security/sessions/:id/revoke", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.email) return forbidden(res);
  const au = await prisma.adminUser.findUnique({ where: { email: p.email }, select: { id: true } });
  if (au) await revokeSession(req.params.id, au.id);
  res.redirect("/admin/security");
});

adminRouter.post("/security/sessions/revoke-others", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.email) return forbidden(res);
  const au = await prisma.adminUser.findUnique({ where: { email: p.email }, select: { id: true } });
  const current = await findSession(req.cookies?.[SESSION_COOKIE]);
  if (au) await revokeAllSessions(au.id, current?.id);
  res.redirect("/admin/security");
});

adminRouter.post("/security/mfa/disable", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.email) return forbidden(res);
  await prisma.adminUser.update({ where: { email: p.email }, data: { mfaEnabled: false, mfaSecret: null, recoveryCodes: Prisma.DbNull } });
  res.redirect("/admin/security?mfa=off");
});

}
