// Admin route group: auth (split from admin.ts, CQ-05).
import {
  Router, SESSION_COOKIE, SESSION_TTL_MS, authNoticePage, clearCookieOptions, config, consumeRecoveryCode, consumeToken,
  cookieOptions, createSession, defaultOrgId, findSession, forgotPage, hashPassword, invitePage, issueToken,
  loginBrandingForHost, loginPage, mfaPage, peekToken, prisma, recordAudit, reqIp, requestHost,
  resetPage, revokeAllSessions, revokeSession, sendMail, signEmail, verifyEmail, verifyPassword, verifyTotp,
} from "./context";

export function registerAuthRoutes(router: Router) {
  const adminRouter = router;

// ---------- auth ----------
// Client-branded login when the request arrives on a registered client domain.
const brandingFor = (req: any) => loginBrandingForHost(requestHost(req));

adminRouter.get("/login", async (req, res) =>
  res.send(
    loginPage(
      undefined,
      req.query.ready
        ? "Account created and email verified — sign in to get started."
        : req.query.welcome
        ? "Account created. Sign in to continue."
        : undefined,
      await brandingFor(req)
    )
  )
);

// The ADMIN_TOKEN break-glass login was removed (single-point-of-failure god
// credential). First-admin bootstrap and lockout recovery now run on the box:
//   node dist/scripts/make-admin.js <email> [name] [role]
// Email + password. MFA is optional: if the account has it enabled we ask for a
// code, otherwise we sign in directly. Admins can turn MFA on later under
// Admin -> Security.
adminRouter.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").toLowerCase().trim();
  const password = String(req.body?.password || "");
  const au = await prisma.adminUser.findUnique({ where: { email } });
  if (!au || !au.active || !verifyPassword(password, au.passwordHash)) {
    recordAudit({ orgId: await defaultOrgId(), actor: { email }, action: "login.failed", ip: reqIp(req) });
    return res.status(401).send(loginPage("Invalid email or password.", undefined, await brandingFor(req)));
  }
  if (au.mfaEnabled && au.mfaSecret) {
    res.cookie("oc_pwauth", signEmail(email), cookieOptions(5 * 60 * 1000));
    return res.send(mfaPage());
  }
  recordAudit({ orgId: au.orgId ?? (await defaultOrgId()), actor: { email, role: au.role }, action: "login.success", ip: reqIp(req) });
  res.cookie(SESSION_COOKIE, await createSession(au.id, reqIp(req), req.headers["user-agent"] as string), cookieOptions(SESSION_TTL_MS));
  return res.redirect("/admin");
});

adminRouter.post("/login/mfa", async (req, res) => {
  const email = verifyEmail(req.cookies?.oc_pwauth);
  if (!email) return res.redirect("/admin/login");
  const au = await prisma.adminUser.findUnique({ where: { email } });
  if (!au || !au.mfaSecret) return res.status(401).send(mfaPage("Incorrect code, try again."));
  // Accept a 6-digit TOTP or one of the single-use recovery codes.
  const input = String(req.body?.code || "");
  const totpOk = /^\s*\d{6}\s*$/.test(input) && verifyTotp(au.mfaSecret, input.trim());
  const recoveryOk = !totpOk && (await consumeRecoveryCode(au.id, input));
  if (!totpOk && !recoveryOk) return res.status(401).send(mfaPage("Incorrect code, try again."));
  res.clearCookie("oc_pwauth", clearCookieOptions());
  recordAudit({
    orgId: au.orgId ?? (await defaultOrgId()),
    actor: { email, role: au.role },
    action: "login.success",
    summary: recoveryOk ? "MFA (recovery code)" : "MFA",
    ip: reqIp(req),
  });
  res.cookie(SESSION_COOKIE, await createSession(au.id, reqIp(req), req.headers["user-agent"] as string), cookieOptions(SESSION_TTL_MS));
  res.redirect("/admin");
});

adminRouter.get("/logout", async (req, res) => {
  // Revoke the DB session behind this cookie (if any) so it can't be replayed.
  const sess = await findSession(req.cookies?.[SESSION_COOKIE]);
  if (sess) await revokeSession(sess.id, sess.adminUserId);
  res.clearCookie(SESSION_COOKIE, clearCookieOptions());
  res.clearCookie("oc_emp", clearCookieOptions());
  res.redirect("/admin/login");
});

// ---------- password reset (pre-auth) ----------
adminRouter.get("/forgot", (_req, res) => res.send(forgotPage()));

adminRouter.post("/forgot", async (req, res) => {
  const email = String(req.body?.email || "").toLowerCase().trim();
  // Always respond identically — never reveal whether an account exists.
  if (email) {
    const au = await prisma.adminUser.findUnique({ where: { email } });
    if (au && au.active) {
      const raw = await issueToken("reset", email);
      await sendMail(
        [email],
        "Reset your OpenCard password",
        `Someone (hopefully you) asked to reset the password for ${email}.\n\n` +
          `Reset it here (link expires in 1 hour):\n${config.baseUrl}/admin/reset?token=${raw}\n\n` +
          `If this wasn't you, you can ignore this email — your password is unchanged.`
      );
      recordAudit({ orgId: au.orgId ?? (await defaultOrgId()), actor: { email }, action: "password.reset_requested", ip: reqIp(req) });
    }
  }
  res.send(forgotPage({ sent: true }));
});

adminRouter.get("/reset", async (req, res) => {
  const raw = String(req.query.token || "");
  const t = await peekToken("reset", raw);
  if (!t) return res.status(400).send(authNoticePage("Link expired", "This reset link is invalid or has expired. Request a new one.", { href: "/admin/forgot", label: "Request a new link" }));
  res.send(resetPage(raw));
});

adminRouter.post("/reset", async (req, res) => {
  const raw = String(req.body?.token || "");
  const password = String(req.body?.password || "");
  if (password.length < 8) return res.status(400).send(resetPage(raw, "Password must be at least 8 characters."));
  if (password !== String(req.body?.password2 || "")) return res.status(400).send(resetPage(raw, "Passwords don't match."));
  const t = await consumeToken("reset", raw);
  if (!t) return res.status(400).send(authNoticePage("Link expired", "This reset link is invalid or has expired. Request a new one.", { href: "/admin/forgot", label: "Request a new link" }));
  const au = await prisma.adminUser.findUnique({ where: { email: t.email } });
  if (!au || !au.active) return res.status(400).send(authNoticePage("Account unavailable", "This account can't be reset. Contact your administrator.", { href: "/admin/login", label: "Back to sign in" }));
  await prisma.adminUser.update({ where: { id: au.id }, data: { passwordHash: hashPassword(password), emailVerifiedAt: au.emailVerifiedAt ?? new Date() } });
  const revoked = await revokeAllSessions(au.id);
  recordAudit({ orgId: au.orgId ?? (await defaultOrgId()), actor: { email: au.email, role: au.role }, action: "password.reset", summary: `${revoked} session(s) signed out`, ip: reqIp(req) });
  res.send(authNoticePage("Password updated", "Your password has been changed and other sessions were signed out.", { href: "/admin/login", label: "Sign in" }));
});

// ---------- signup email verification (pre-auth) ----------
adminRouter.get("/verify", async (req, res) => {
  const t = await consumeToken("verify", String(req.query.token || ""));
  if (!t) return res.status(400).send(authNoticePage("Link expired", "This verification link is invalid or has expired. Sign in and use “Resend verification email”.", { href: "/admin/login", label: "Sign in" }));
  await prisma.adminUser.updateMany({ where: { email: t.email }, data: { emailVerifiedAt: new Date() } });
  if (t.orgId) await prisma.org.updateMany({ where: { id: t.orgId, ownerVerifiedAt: null }, data: { ownerVerifiedAt: new Date() } });
  recordAudit({ orgId: t.orgId ?? (await defaultOrgId()), actor: { email: t.email }, action: "signup.verified", ip: reqIp(req) });
  res.send(authNoticePage("Email verified", "Your workspace is live — cards and lead capture are now public.", { href: "/admin/login", label: "Sign in" }));
});

// ---------- admin invite acceptance (pre-auth) ----------
adminRouter.get("/invite", async (req, res) => {
  const raw = String(req.query.token || "");
  const t = await peekToken("invite", raw);
  if (!t) return res.status(400).send(authNoticePage("Invite expired", "This invite link is invalid or has expired. Ask your administrator to send a new one.", { href: "/admin/login", label: "Back to sign in" }));
  res.send(invitePage(raw, t.email));
});

adminRouter.post("/invite", async (req, res) => {
  const raw = String(req.body?.token || "");
  const t0 = await peekToken("invite", raw);
  if (!t0) return res.status(400).send(authNoticePage("Invite expired", "This invite link is invalid or has expired. Ask your administrator to send a new one.", { href: "/admin/login", label: "Back to sign in" }));
  const password = String(req.body?.password || "");
  if (password.length < 8) return res.status(400).send(invitePage(raw, t0.email, "Password must be at least 8 characters."));
  if (password !== String(req.body?.password2 || "")) return res.status(400).send(invitePage(raw, t0.email, "Passwords don't match."));
  const t = await consumeToken("invite", raw);
  if (!t) return res.status(400).send(authNoticePage("Invite expired", "This invite link is invalid or has expired.", { href: "/admin/login", label: "Back to sign in" }));
  const au = await prisma.adminUser.findUnique({ where: { email: t.email } });
  if (!au || !au.active) return res.status(400).send(authNoticePage("Account unavailable", "This account no longer exists. Contact your administrator.", { href: "/admin/login", label: "Back to sign in" }));
  await prisma.adminUser.update({ where: { id: au.id }, data: { passwordHash: hashPassword(password), emailVerifiedAt: new Date() } });
  recordAudit({ orgId: au.orgId ?? (await defaultOrgId()), actor: { email: au.email, role: au.role }, action: "admin.invite_accepted", ip: reqIp(req) });
  res.send(authNoticePage("You're all set", "Your password is saved. Sign in to get started.", { href: "/admin/login", label: "Sign in" }));
});
}
