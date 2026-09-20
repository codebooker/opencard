// Admin route group: accounts (split from admin.ts, CQ-05).
import {
  Router, PLATFORM_ROLES_ALL, Prisma, asArray, audit,
  clean, config, esc, forbidden, hashPassword, isPlatformRole, issueToken, limitReached,
  page, prisma, reqAdmin, revokeAllSessions, sendMail, upload, isOrgLimitReached, withOrgLimit,
} from "./context";
import { RBAC } from "./context";
import { V } from "./context";

export function registerAccountRoutes(router: Router) {
  const adminRouter = router;

// ---------- admin accounts (org owner / platform only) ----------
// Admins are per-org: an org owner only sees/manages admins in their own org and
// can only scope them to their own org's brands/rooftops. Platform owners span all.

// Confirm the target admin is one this principal may manage; returns it or null.
async function manageableAdmin(p: RBAC.AdminPrincipal, id: string) {
  const admin = await prisma.adminUser.findUnique({ where: { id }, include: { scopes: true } });
  if (!admin) return null;
  // The client Admins form never touches OpenCard-staff (platform) accounts —
  // those are managed only in the Staff console.
  if (isPlatformRole(admin.role)) return null;
  if (!RBAC.seesAllOrgs(p) && admin.orgId !== p.orgId) return null;
  return admin;
}

adminRouter.get("/admins", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageAdmins(p)) return forbidden(res);
  // Only org-level admins here; platform accounts live in the Staff console.
  const admins = await prisma.adminUser.findMany({
    where: { ...(RBAC.seesAllOrgs(p) ? {} : { orgId: p.orgId }), role: { notIn: PLATFORM_ROLES_ALL } },
    orderBy: { createdAt: "asc" },
    include: { scopes: true },
  });
  res.send(V.adminsView(admins));
});
adminRouter.get("/admins/new", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageAdmins(p)) return forbidden(res);
  const orgFilter = RBAC.seesAllOrgs(p) ? {} : { orgId: p.orgId };
  const [brands, locations] = await Promise.all([
    prisma.brand.findMany({ where: orgFilter, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: orgFilter, orderBy: { name: "asc" }, include: { brand: true } }),
  ]);
  res.send(V.adminForm({ brands, locations }));
});
adminRouter.get("/admins/:id/edit", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageAdmins(p)) return forbidden(res);
  const admin = await manageableAdmin(p, req.params.id);
  if (!admin) return res.status(404).send("Not found");
  const orgFilter = RBAC.seesAllOrgs(p) ? {} : { orgId: p.orgId };
  const [brands, locations] = await Promise.all([
    prisma.brand.findMany({ where: orgFilter, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: orgFilter, orderBy: { name: "asc" }, include: { brand: true } }),
  ]);
  res.send(V.adminForm({ admin, brands, locations }));
});

function scopeRowsFromBody(b: any): { brandId?: string; locationId?: string }[] {
  const rows: { brandId?: string; locationId?: string }[] = [];
  if (b.role === "brand_admin") for (const id of asArray(b.brandScope)) rows.push({ brandId: id });
  if (b.role === "location_admin") for (const id of asArray(b.locationScope)) rows.push({ locationId: id });
  return rows;
}

// The client Admins form only assigns org-level roles — platform (OpenCard-staff)
// roles are never grantable here; they're managed in the Staff console.
function safeRole(_p: RBAC.AdminPrincipal, role: string): string {
  return isPlatformRole(role) ? "org_admin" : role;
}

adminRouter.post("/admins", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageAdmins(p)) return forbidden(res);
  const b = req.body;
  const email = String(b.email || "").toLowerCase().trim();
  if (!email || !b.role) return res.redirect("/admin/admins/new");
  const data: any = {
    email,
    name: clean(b.name),
    role: safeRole(p, b.role),
    orgId: p.orgId,
    scopes: { create: scopeRowsFromBody(b) },
  };
  if (b.password) data.passwordHash = hashPassword(String(b.password));
  try {
    await withOrgLimit(p.orgId, "admins", () => prisma.adminUser.create({ data }));
  } catch (e) {
    if (isOrgLimitReached(e)) return limitReached(res, "admin");
    throw e;
  }
  audit(req, p, "admin.create", { targetType: "AdminUser", summary: `${email} (${data.role})` });
  // No password typed + invite requested: email a set-password link instead.
  if (!b.password && b.sendInvite) {
    const raw = await issueToken("invite", email);
    await sendMail(
      [email],
      "You've been invited to OpenCard",
      `${p.name} invited you to the OpenCard admin workspace.\n\n` +
        `Set your password here (link expires in 7 days):\n${config.baseUrl}/admin/invite?token=${raw}`
    );
    audit(req, p, "admin.invite_sent", { targetType: "AdminUser", summary: email });
  }
  res.redirect("/admin/admins");
});

adminRouter.post("/admins/:id", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageAdmins(p)) return forbidden(res);
  const target = await manageableAdmin(p, req.params.id);
  if (!target) return res.status(404).send("Not found");
  const b = req.body;
  const data: any = { name: clean(b.name), role: safeRole(p, b.role), active: !!b.active };
  if (b.password) data.passwordHash = hashPassword(String(b.password));
  if (b.resetMfa) {
    data.mfaEnabled = false;
    data.mfaSecret = null;
    data.recoveryCodes = Prisma.DbNull;
  }
  await prisma.$transaction([
    prisma.adminScope.deleteMany({ where: { adminUserId: target.id } }),
    prisma.adminUser.update({
      where: { id: target.id },
      data: { ...data, scopes: { create: scopeRowsFromBody(b) } },
    }),
  ]);
  // A changed password or deactivation kills the target's live sessions.
  if (b.password || !b.active) await revokeAllSessions(target.id);
  res.redirect("/admin/admins");
});

adminRouter.post("/admins/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageAdmins(p)) return forbidden(res);
  const target = await manageableAdmin(p, req.params.id);
  if (!target) return res.status(404).send("Not found");
  await prisma.adminUser.delete({ where: { id: target.id } });
  audit(req, p, "admin.delete", { targetType: "AdminUser", targetId: target.id, summary: target.email });
  res.redirect("/admin/admins");
});

// Friendly handling for upload errors (wrong type / too large) — instead of a
// silent fallback or a 500, tell the admin what went wrong.
adminRouter.use((err: any, _req: any, res: any, _next: any) => {
  const msg =
    err?.code === "LIMIT_FILE_SIZE"
      ? "That image is too large (max 5 MB)."
      : err?.message || "Something went wrong with the upload.";
  res.status(400).send(
    page({
      title: "Upload error",
      body: `<main class="card"><section class="ident"><h1>Upload problem</h1><p class="company">${esc(
        msg
      )}</p></section><a class="cta" href="javascript:history.back()">Go back and try another image</a></main>`,
    })
  );
});
}
