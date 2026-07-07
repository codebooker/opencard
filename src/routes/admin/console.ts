// Admin route group: console (split from admin.ts, CQ-05).
import {
  Router, CsvTarget, DEFAULT_PLAN, applyImport, audit, clean, clearCookieOptions, config,
  cookieOptions, credsForOrg, currentTerminology, deleteDirectoryConfig, directoryConfigSummary, esc, filterByDepartment, forbidden,
  getPlatformConfig, guessMapping, humanSize, isConsole, isPlanKey, isVertical, listBackups, listDirectoryUsers,
  mapCsvRow, mapGraphUser, multer, onlySelected, page, parseCsv, parseSeatLimit, planCandidates,
  planImport, prisma, purgeOrgData, reqAdmin, restoreClientToBackup, runManualBackup, runWithOrg, saveDirectoryConfig,
  searchGroups, testGraphCreds, updatePlatformConfig, upload, uploadDir, withRestoreLock,
} from "./context";
import { RBAC } from "./context";
import { V } from "./context";

export function registerConsoleRoutes(router: Router) {
  const adminRouter = router;

// ---------- dashboard ----------
// OpenCard staff console: list every client workspace. Drill in to manage one.
adminRouter.get("/clients", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform) return forbidden(res);
  const orgs = await prisma.org.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, subdomain: true, plan: true, billingMode: true, subscriptionStatus: true, suspended: true,
      _count: { select: { brands: true, cards: true, leads: true } },
    },
  });
  res.send(V.clientsConsole(orgs, p));
});

const VALID_MODES = ["free", "standard", "demo"];

adminRouter.get("/clients/new", (req, res) => {
  if (!reqAdmin(req).platform) return forbidden(res);
  res.send(V.clientForm());
});

// ---------- platform settings (signup defaults) ----------
adminRouter.get("/platform", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform || !p.staffAdmin) return forbidden(res);
  res.send(V.platformSettingsView(await getPlatformConfig(), req.query.saved === "1"));
});

// ---------- directory import wizard (Phase 13) ----------
// Self-service: org owners connect their OWN Azure tenant on this page.
// Platform staff fall back to env credentials only for testing.

async function importCtx(req: any) {
  const p = reqAdmin(req);
  const t = await currentTerminology(p.orgId);
  // Org-level credentials ONLY — no platform/env fallback (a staff fallback
  // once leaked the platform's directory into every client workspace).
  const resolved = await credsForOrg(p.orgId);
  const summary = await directoryConfigSummary(p.orgId);
  return { p, t, resolved, config: summary ? { ...summary, source: "org" as const } : null };
}

adminRouter.get("/import", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  const ctx = await importCtx(req);
  res.send(V.importView({ configured: !!ctx.resolved, t: ctx.t, config: ctx.config, showSettings: req.query.settings === "1" }));
});

// Save/replace the org's Azure credentials, then prove they work.
adminRouter.post("/import/config", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  const t = await currentTerminology(p.orgId);
  const tenantId = clean(req.body?.tenantId) || "";
  const clientId = clean(req.body?.clientId) || "";
  const clientSecret = String(req.body?.clientSecret || "").trim();
  try {
    if (!tenantId || !clientId) throw new Error("Directory (tenant) ID and Application (client) ID are required.");
    await saveDirectoryConfig(p.orgId, { tenantId, clientId, clientSecret });
    const resolved = await credsForOrg(p.orgId);
    const test = resolved ? await testGraphCreds(resolved.creds) : { ok: false as const, message: "Saved, but the secret could not be read back." };
    audit(req, p, "import.config", { summary: `Azure directory connection ${test.ok ? "verified" : "saved (test failed)"}` });
    res.send(
      V.importView({
        configured: test.ok,
        t,
        config: { tenantId, clientId, source: "org" },
        showSettings: !test.ok,
        testResult: test.ok ? "Connected — credentials verified against your directory." : null,
        error: test.ok ? undefined : `Saved, but the test call failed: ${test.message}`,
      })
    );
  } catch (e: any) {
    res.send(V.importView({ configured: false, t, config: null, showSettings: true, error: String(e?.message || e).slice(0, 400) }));
  }
});

adminRouter.post("/import/config/delete", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  await deleteDirectoryConfig(p.orgId);
  audit(req, p, "import.config", { summary: "Azure directory connection removed" });
  res.redirect("/admin/import");
});

adminRouter.post("/import/preview", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  const ctx = await importCtx(req);
  const { t } = ctx;
  if (!ctx.resolved) return res.send(V.importView({ configured: false, t, config: ctx.config }));
  const creds = ctx.resolved.creds;
  const groupId = clean(req.body?.groupId);
  const deptQuery = clean(req.body?.deptQuery) || "";
  const source = String(req.body?.source || (groupId ? "group" : "all"));
  try {
    if (source === "groupsearch") {
      const q = clean(req.body?.groupQuery) || "";
      const groups = q ? await searchGroups(creds, q) : [];
      return res.send(V.importView({ configured: true, t, config: ctx.config, groups, groupQuery: q }));
    }
    let users = await listDirectoryUsers(creds, groupId || undefined);
    if (source === "department" && deptQuery) users = filterByDepartment(users, deptQuery);
    const rows = await planImport(p.orgId, users);
    res.send(
      V.importView({
        configured: true,
        t,
        config: ctx.config,
        plan: { rows, source, groupId: groupId || undefined, deptQuery: source === "department" ? deptQuery : undefined },
      })
    );
  } catch (e: any) {
    res.send(V.importView({ configured: true, t, config: ctx.config, error: String(e?.message || e).slice(0, 400) }));
  }
});

adminRouter.post("/import/apply", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  const ctx = await importCtx(req);
  const { t } = ctx;
  if (!ctx.resolved) return res.send(V.importView({ configured: false, t, config: ctx.config }));
  const creds = ctx.resolved.creds;
  const groupId = clean(req.body?.groupId);
  const deptQuery = clean(req.body?.deptQuery) || "";
  const source = String(req.body?.source || (groupId ? "group" : "all"));
  const selRaw = req.body?.sel;
  const selected = (Array.isArray(selRaw) ? selRaw : selRaw ? [selRaw] : []).map((s: any) => String(s)).slice(0, 5000);
  try {
    if (!selected.length) throw new Error("Nobody is selected — tick at least one person in the preview.");
    // Re-fetch and re-plan at apply time: the directory is the source of
    // truth, and existing emails stay skipped either way.
    let users = await listDirectoryUsers(creds, groupId || undefined);
    if (source === "department" && deptQuery) users = filterByDepartment(users, deptQuery);
    const rows = onlySelected(await planImport(p.orgId, users), selected);
    const result = await applyImport(p.orgId, rows);
    audit(req, p, "import.graph", {
      summary: `${result.created} created, ${result.skipped} skipped (${selected.length} selected${groupId ? `, group ${groupId}` : ""}${deptQuery ? `, dept "${deptQuery}"` : ""})`,
    });
    res.send(V.importView({ configured: true, t, config: ctx.config, result }));
  } catch (e: any) {
    res.send(V.importView({ configured: true, t, config: ctx.config, error: String(e?.message || e).slice(0, 400) }));
  }
});

// ---------- CSV employee import (Phase 14) ----------
// Same preview/selective-apply flow as the Graph wizard, fed by a spreadsheet.
// Stateless: the parsed CSV travels between steps as a base64 hidden field
// (capped at 1 MB / 2000 rows), so nothing is stored until Apply.

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });
const CSV_ROW_CAP = 2000;

function csvStage(csvText: string, mappingIn?: string[]) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error("That file needs a header row plus at least one data row.");
  const headers = rows[0];
  const mapping = (
    mappingIn && mappingIn.length === headers.length ? mappingIn : guessMapping(headers)
  ) as CsvTarget[];
  const data = rows.slice(1, 1 + CSV_ROW_CAP);
  const candidates = data.map((r) => mapCsvRow(mapping, r)).filter((c): c is NonNullable<ReturnType<typeof mapCsvRow>> => !!c);
  return { headers, mapping, data, candidates, skippedNoEmail: data.length - candidates.length };
}

adminRouter.get("/import/csv", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  res.send(V.importCsvView({ t: await currentTerminology(p.orgId) }));
});

adminRouter.post("/import/csv/preview", csvUpload.single("csvFile"), async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  const t = await currentTerminology(p.orgId);
  try {
    const csvText = (req as any).file
      ? (req as any).file.buffer.toString("utf8")
      : Buffer.from(String(req.body?.csvData || ""), "base64").toString("utf8");
    if (!csvText.trim()) throw new Error("Choose a CSV file to upload.");
    const mappingIn = Array.isArray(req.body?.map) ? req.body.map.map(String) : undefined;
    const stage = csvStage(csvText, mappingIn);
    if (!stage.mapping.includes("email"))
      return res.send(
        V.importCsvView({
          t,
          stage: { ...stage, csvB64: Buffer.from(csvText).toString("base64"), plan: null },
          error: "Map one column to Email — it's how existing people are recognized and skipped.",
        })
      );
    const plan = await planCandidates(p.orgId, stage.candidates);
    res.send(V.importCsvView({ t, stage: { ...stage, csvB64: Buffer.from(csvText).toString("base64"), plan } }));
  } catch (e: any) {
    res.send(V.importCsvView({ t, error: String(e?.message || e).slice(0, 400) }));
  }
});

adminRouter.post("/import/csv/apply", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  const t = await currentTerminology(p.orgId);
  try {
    const csvText = Buffer.from(String(req.body?.csvData || ""), "base64").toString("utf8");
    const mappingIn = Array.isArray(req.body?.map) ? req.body.map.map(String) : undefined;
    const selRaw = req.body?.sel;
    const selected = (Array.isArray(selRaw) ? selRaw : selRaw ? [selRaw] : []).map((s: any) => String(s)).slice(0, CSV_ROW_CAP);
    if (!selected.length) throw new Error("Nobody is selected — tick at least one person in the preview.");
    const stage = csvStage(csvText, mappingIn);
    const rows = onlySelected(await planCandidates(p.orgId, stage.candidates), selected);
    const result = await applyImport(p.orgId, rows, "csv");
    audit(req, p, "import.csv", { summary: `${result.created} created, ${result.skipped} skipped (${selected.length} selected)` });
    res.send(V.importCsvView({ t, result }));
  } catch (e: any) {
    res.send(V.importCsvView({ t, error: String(e?.message || e).slice(0, 400) }));
  }
});

// ---------- sync health (Phase 13): what the directory paths created ----------

async function syncOverview(orgId: string) {
  const groups = await prisma.user.groupBy({
    by: ["provisionedBy"],
    where: { orgId },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const bySource = (s: string | null) => groups.find((g) => g.provisionedBy === s);
  const row = (s: string | null) => ({
    count: bySource(s)?._count._all || 0,
    last: bySource(s)?._max.createdAt || null,
  });
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { scimTokenHash: true } });
  return {
    scim: row("scim"),
    imported: row("import"),
    csv: row("csv"),
    jit: row("jit"),
    manual: row(null),
    scimTokenSet: !!org?.scimTokenHash,
    dirConfigured: !!(await credsForOrg(orgId)),
  };
}

adminRouter.get("/sync", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  res.send(V.syncView({ t: await currentTerminology(p.orgId), overview: await syncOverview(p.orgId) }));
});

// Compare the live directory against active cards: who no longer exists (or is
// disabled) in Azure but still has a public card here. Read-only.
adminRouter.post("/sync/check", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  const t = await currentTerminology(p.orgId);
  const overview = await syncOverview(p.orgId);
  try {
    const resolved = await credsForOrg(p.orgId);
    if (!resolved) throw new Error("Connect your Azure directory on the Import page first.");
    const dirUsers = (await listDirectoryUsers(resolved.creds)).map(mapGraphUser).filter((c): c is NonNullable<typeof c> => !!c);
    const inDirectory = new Set(dirUsers.map((u) => u.email));
    const disabled = new Set(dirUsers.filter((u) => !u.enabled).map((u) => u.email));
    const cards = await prisma.card.findMany({
      where: { orgId: p.orgId, active: true, ownerEmail: { not: null } },
      select: { id: true, firstName: true, lastName: true, ownerEmail: true },
    });
    const orphans = cards
      .map((c) => {
        const email = (c.ownerEmail || "").toLowerCase();
        const reason = !inDirectory.has(email) ? "not in directory" : disabled.has(email) ? "disabled in directory" : null;
        return reason ? { id: c.id, name: `${c.firstName} ${c.lastName}`.trim(), email, reason } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    res.send(V.syncView({ t, overview, checked: { total: cards.length, directorySize: dirUsers.length, orphans } }));
  } catch (e: any) {
    res.send(V.syncView({ t, overview, error: String(e?.message || e).slice(0, 400) }));
  }
});

// Deactivate the selected orphaned cards (card unpublished + user deactivated).
// Reversible from the card editor; nothing is deleted.
adminRouter.post("/sync/deactivate", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  const t = await currentTerminology(p.orgId);
  const selRaw = req.body?.sel;
  const ids = (Array.isArray(selRaw) ? selRaw : selRaw ? [selRaw] : []).map((s: any) => String(s)).slice(0, 5000);
  let deactivated = 0;
  if (ids.length) {
    // Org-scoped: ids from another tenant simply don't match.
    const cards = await prisma.card.findMany({
      where: { id: { in: ids }, orgId: p.orgId },
      select: { id: true, userId: true },
    });
    await runWithOrg(p.orgId, async (db) => {
      await db.card.updateMany({ where: { id: { in: cards.map((c) => c.id) } }, data: { active: false } });
      const userIds = cards.map((c) => c.userId).filter((x): x is string => !!x);
      if (userIds.length) await db.user.updateMany({ where: { id: { in: userIds } }, data: { active: false } });
      deactivated = cards.length;
    });
    audit(req, p, "sync.deactivate", { summary: `${deactivated} orphaned ${deactivated === 1 ? "card" : "cards"} deactivated` });
  }
  res.send(V.syncView({ t, overview: await syncOverview(p.orgId), flash: `${deactivated} deactivated.` }));
});

// ---------- backups & per-client restore (platform owner/admin) ----------
adminRouter.get("/backups", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform || !p.staffAdmin) return forbidden(res);
  const orgs = await prisma.org.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  res.send(
    V.backupsView({
      backups: listBackups().map((b) => ({ ...b, sizeHuman: humanSize(b.size) })),
      orgs,
      flash: req.query.ran
        ? "Backup complete."
        : req.query.restored
        ? `Client restored (${String(req.query.restored)} rows).`
        : null,
      error: req.query.error ? String(req.query.error).slice(0, 300) : null,
    })
  );
});

adminRouter.post("/backups/run", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform || !p.staffAdmin) return forbidden(res);
  try {
    const out = await runManualBackup(uploadDir);
    audit(req, p, "backup.manual", { summary: out.db });
    res.redirect("/admin/backups?ran=1");
  } catch (e: any) {
    res.redirect("/admin/backups?error=" + encodeURIComponent(String(e?.message || e).slice(0, 200)));
  }
});

adminRouter.post("/backups/restore-client", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform || !p.staffAdmin) return forbidden(res);
  const org = await prisma.org.findUnique({ where: { id: String(req.body?.orgId || "") }, select: { id: true, name: true } });
  if (!org) return res.redirect("/admin/backups?error=" + encodeURIComponent("Client not found."));
  if (String(req.body?.confirmName || "") !== org.name)
    return res.redirect("/admin/backups?error=" + encodeURIComponent("The client name you typed does not match."));
  const dump = String(req.body?.dump || "");
  try {
    const result = await withRestoreLock(() => restoreClientToBackup(org.id, dump));
    audit(req, p, "backup.restore_client", { targetType: "Org", targetId: org.id, summary: `${org.name} <- ${dump} (${result.rows} rows)` });
    res.redirect("/admin/backups?restored=" + result.rows);
  } catch (e: any) {
    audit(req, p, "backup.restore_failed", { targetType: "Org", targetId: org.id, summary: String(e?.message || e).slice(0, 150) });
    res.redirect("/admin/backups?error=" + encodeURIComponent(String(e?.message || e).slice(0, 200)));
  }
});

adminRouter.post("/platform", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform || !p.staffAdmin) return forbidden(res);
  const saved = await updatePlatformConfig({
    signupPlan: String(req.body?.signupPlan || ""),
    signupTrialDays: parseInt(String(req.body?.signupTrialDays || ""), 10),
    signupAccessCode: String(req.body?.signupAccessCode ?? ""),
  });
  // Don't write the code itself into the audit log.
  audit(req, p, "platform.settings", {
    targetType: "PlatformConfig",
    summary: JSON.stringify({ ...saved, signupAccessCode: saved.signupAccessCode ? "(set)" : "(off)" }),
  });
  res.redirect("/admin/platform?saved=1");
});

adminRouter.post("/clients", async (req, res) => {
  if (!reqAdmin(req).platform) return forbidden(res);
  const b = req.body;
  const name = clean(b.name);
  if (!name) return res.redirect("/admin/clients/new");
  const mode = VALID_MODES.includes(b.billingMode) ? b.billingMode : "standard";
  const demo =
    mode === "demo"
      ? {
          trialEndsAt: new Date(Date.now() + (Number(b.demoDays) === 60 ? 60 : 30) * 24 * 60 * 60 * 1000),
          subscriptionStatus: "trialing",
        }
      : {};
  await prisma.org.create({
    data: {
      name,
      vertical: isVertical(b.businessType) ? b.businessType : "general",
      plan: isPlanKey(b.plan) ? b.plan : DEFAULT_PLAN,
      billingMode: mode,
      idCardsEnabled: b.idCards === "1",
      seatLimit: parseSeatLimit(b.seatLimit),
      // Staff-created clients skip signup email verification (staff vouches).
      ownerVerifiedAt: new Date(),
      ...demo,
    },
  });
  res.redirect("/admin/clients");
});

adminRouter.get("/clients/:orgId/settings", async (req, res) => {
  if (!reqAdmin(req).platform) return forbidden(res);
  const org = await prisma.org.findUnique({ where: { id: req.params.orgId } });
  if (!org) return res.status(404).send("Client not found");
  res.send(V.clientForm(org));
});

adminRouter.post("/clients/:orgId/settings", async (req, res) => {
  if (!reqAdmin(req).platform) return forbidden(res);
  const b = req.body;
  const data: any = { seatLimit: parseSeatLimit(b.seatLimit), idCardsEnabled: b.idCards === "1" };
  if (clean(b.name)) data.name = clean(b.name);
  if (isVertical(b.businessType)) data.vertical = b.businessType;
  if (isPlanKey(b.plan)) data.plan = b.plan;
  if (VALID_MODES.includes(b.billingMode)) {
    data.billingMode = b.billingMode;
    if (b.billingMode === "demo") {
      data.trialEndsAt = new Date(Date.now() + (Number(b.demoDays) === 60 ? 60 : 30) * 24 * 60 * 60 * 1000);
      data.subscriptionStatus = "trialing";
    }
  }
  await prisma.org.update({ where: { id: req.params.orgId }, data });
  res.redirect("/admin/clients");
});

// Suspend / unsuspend a client workspace (platform staff only). A suspended
// org is fully dark: admin UI, self-service, API, and all public surfaces.
adminRouter.post("/clients/:orgId/suspend", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform) return forbidden(res);
  const org = await prisma.org.findUnique({ where: { id: req.params.orgId }, select: { id: true, suspended: true, name: true } });
  if (!org) return res.status(404).send("Client not found");
  const suspended = !org.suspended;
  await prisma.org.update({ where: { id: org.id }, data: { suspended } });
  audit(req, p, suspended ? "client.suspend" : "client.unsuspend", {
    targetType: "Org",
    targetId: org.id,
    summary: org.name,
  });
  res.redirect(`/admin/clients/${org.id}/settings`);
});

// Permanently delete a client: purge all tenant data, then remove the org's
// admin accounts, audit trail, and the org row itself. Platform staff only,
// gated on typing the client name exactly.
adminRouter.post("/clients/:orgId/delete", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform) return forbidden(res);
  const org = await prisma.org.findUnique({ where: { id: req.params.orgId }, select: { id: true, name: true } });
  if (!org) return res.status(404).send("Client not found");
  if (String(req.body?.confirmName || "") !== org.name) {
    return res.status(400).send(
      page({
        title: "Name mismatch",
        body: `<main class="admin"><h2>Name didn't match</h2><p class="muted">To delete <strong>${esc(
          org.name
        )}</strong>, type its name exactly.</p><a class="btn secondary" href="/admin/clients/${esc(org.id)}/settings">Back</a></main>`,
      })
    );
  }
  // Audit first, attributed to the platform org, so the record outlives the client.
  audit(req, p, "client.delete", { targetType: "Org", targetId: org.id, summary: org.name });
  await purgeOrgData(org.id);
  await prisma.auditLog.deleteMany({ where: { orgId: org.id } });
  await prisma.adminUser.deleteMany({ where: { orgId: org.id } }); // scopes cascade
  await prisma.org.delete({ where: { id: org.id } });
  res.redirect("/admin/clients");
});

adminRouter.post("/clients/:orgId/enter", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform) return forbidden(res);
  const org = await prisma.org.findUnique({ where: { id: req.params.orgId }, select: { id: true } });
  if (!org) return res.status(404).send("Client not found");
  res.cookie("oc_actorg", org.id, cookieOptions(12 * 60 * 60 * 1000));
  res.redirect("/admin");
});

adminRouter.get("/clients/exit", (_req, res) => {
  res.clearCookie("oc_actorg", clearCookieOptions());
  res.redirect("/admin");
});

adminRouter.get("/", async (req, res) => {
  const p = reqAdmin(req);
  const t = await currentTerminology(reqAdmin(req).orgId);
  // OpenCard staff who haven't drilled into a client see the clients console.
  if (isConsole(p)) return res.redirect("/admin/clients");
  const brandIds = await RBAC.accessibleBrandIds(p);
  const locFilter = p.global ? undefined : { id: { in: await RBAC.accessibleLocationIds(p) } };
  const brands = await prisma.brand.findMany({
    where: { id: { in: brandIds } },
    orderBy: { name: "asc" },
    include: {
      locations: {
        where: locFilter,
        orderBy: { name: "asc" },
        include: { _count: { select: { cards: true } } },
      },
    },
  });
  // When a platform admin has drilled into a client, show whose workspace this is.
  let actingClientName: string | undefined;
  if (p.actingOrgId) {
    const org = await prisma.org.findUnique({ where: { id: p.actingOrgId }, select: { name: true } });
    actingClientName = org?.name;
  }
  // Unverified self-signup org: banner until the owner confirms their email.
  const own = await prisma.org.findUnique({
    where: { id: p.orgId },
    select: { ownerVerifiedAt: true, onboardingDismissedAt: true },
  });
  const verifyState = own?.ownerVerifiedAt ? null : req.query.verify === "sent" ? ("sent" as const) : ("needed" as const);

  // First-run checklist: real progress from real data, gone once complete
  // (or dismissed). Only for admins who can actually do the steps.
  let onboarding: V.OnboardingState | null = null;
  if (p.global && !own?.onboardingDismissedAt) {
    const orgId = p.orgId;
    const [brandCount, loc, card, viewed, leadCount] = await Promise.all([
      prisma.brand.count({ where: { orgId } }),
      prisma.location.findFirst({ where: { orgId }, select: { id: true } }),
      prisma.card.findFirst({ where: { orgId }, orderBy: { createdAt: "asc" }, select: { slug: true, locationId: true } }),
      prisma.analyticsEvent.findFirst({ where: { orgId, type: "view" }, select: { id: true } }),
      prisma.lead.count({ where: { orgId } }),
    ]);
    const steps = {
      brand: brandCount > 0,
      location: !!loc,
      card: !!card,
      shared: !!viewed,
      lead: leadCount > 0,
    };
    if (!Object.values(steps).every(Boolean)) {
      onboarding = { steps, firstBrandId: brands[0]?.id || null, firstCard: card || null };
    }
  }
  res.send(V.dashboard(brands as any, p, t, actingClientName, verifyState, onboarding));
});

adminRouter.post("/onboarding/dismiss", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  await prisma.org.update({ where: { id: p.orgId }, data: { onboardingDismissedAt: new Date() } });
  res.redirect("/admin");
});

}
