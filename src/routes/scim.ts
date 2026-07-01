import { Router, Request, Response, NextFunction } from "express";
import { prisma, runWithOrg } from "../db";
import { config } from "../config";
import { uniqueSlug } from "../slug";
import { resolveScimOrg } from "../scim-auth";
import { orgHasFeature } from "../entitlements";
import { emitEvent, cardPayload } from "../webhooks";

// Minimal SCIM 2.0 Users endpoint for Azure AD / Entra automatic provisioning.
// Entra calls this to create/update/deactivate users; we mirror each into a
// User + a Card pre-filled from directory attributes, mapped to the right store.
export const scimRouter = Router();

const ENTERPRISE = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";

// ---- bearer auth: resolve the tenant from the SCIM token ----
scimRouter.use(async (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const orgId = await resolveScimOrg(token);
  if (!orgId) {
    return res.status(401).json({ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], detail: "Unauthorized", status: "401" });
  }
  if (!(await orgHasFeature(orgId, "scim"))) {
    return res.status(403).json({ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], detail: "SCIM provisioning is not included in this plan.", status: "403" });
  }
  (req as any).scimOrgId = orgId;
  next();
});

const scimOrg = (req: Request): string => (req as any).scimOrgId;

scimRouter.get("/ServiceProviderConfig", (_req, res) => {
  res.json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: "oauthbearertoken", name: "OAuth Bearer Token" }],
  });
});

// Decide which store a provisioned user belongs to.
// Order: explicit store code (enterprise.costCenter/organization or address locality)
// matched against Location.code, then brand name match, then default location.
async function resolveLocationId(scim: any, orgId: string): Promise<string | null> {
  const ent = scim[ENTERPRISE] || {};
  const candidates = [
    ent.costCenter,
    ent.organization,
    ent.division,
    Array.isArray(scim.addresses) ? scim.addresses[0]?.locality : undefined,
  ].filter(Boolean);

  for (const code of candidates) {
    const loc = await prisma.location.findFirst({ where: { code: String(code), orgId } });
    if (loc) return loc.id;
  }
  // brand name match -> that brand's first store (within this org)
  if (ent.organization) {
    const brand = await prisma.brand.findFirst({
      where: { name: { equals: String(ent.organization), mode: "insensitive" }, orgId },
      include: { locations: { take: 1, orderBy: { createdAt: "asc" } } },
    });
    if (brand?.locations[0]) return brand.locations[0].id;
  }
  // fallback: first location in this org
  const fallback = await prisma.location.findFirst({ where: { orgId }, orderBy: { createdAt: "asc" } });
  return fallback?.id || null;
}

function scimUserResponse(user: any, card: any, req: Request) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: user.id,
    externalId: user.externalId || undefined,
    userName: user.email,
    active: user.active,
    name: { givenName: card?.firstName, familyName: card?.lastName },
    displayName: user.displayName,
    emails: [{ value: user.email, primary: true, type: "work" }],
    meta: {
      resourceType: "User",
      location: `${config.baseUrl}/scim/v2/Users/${user.id}`,
      cardUrl: card ? `${config.cardUrl}/c/${card.slug}` : undefined,
    },
  };
}

function firstEmail(scim: any): string {
  if (Array.isArray(scim.emails)) {
    const primary = scim.emails.find((e: any) => e.primary) || scim.emails[0];
    if (primary?.value) return primary.value;
  }
  return scim.userName;
}

function phonesFromScim(scim: any) {
  if (!Array.isArray(scim.phoneNumbers)) return [];
  return scim.phoneNumbers
    .filter((p: any) => p?.value)
    .map((p: any) => ({ label: (p.type || "Work").replace(/^\w/, (c: string) => c.toUpperCase()), value: p.value }));
}

// ---- list / filter (Entra queries before create) ----
scimRouter.get("/Users", async (req, res) => {
  const orgId = scimOrg(req);
  const filter = String(req.query.filter || "");
  const m = filter.match(/(userName|externalId)\s+eq\s+"([^"]+)"/i);
  let users: any[] = [];
  if (m) {
    const field = m[1].toLowerCase();
    const value = m[2];
    users = await prisma.user.findMany({
      where: { orgId, ...(field === "username" ? { email: value } : { externalId: value }) },
      include: { card: true },
    });
  } else {
    users = await prisma.user.findMany({ where: { orgId }, include: { card: true }, take: 200 });
  }
  res.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: users.length,
    startIndex: 1,
    itemsPerPage: users.length,
    Resources: users.map((u) => scimUserResponse(u, u.card, req)),
  });
});

scimRouter.get("/Users/:id", async (req, res) => {
  const user = await prisma.user.findFirst({ where: { id: req.params.id, orgId: scimOrg(req) }, include: { card: true } });
  if (!user) return res.status(404).json({ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: "404" });
  res.json(scimUserResponse(user, user.card, req));
});

// ---- create ----
scimRouter.post("/Users", async (req, res) => {
  const scim = req.body || {};
  const orgId = scimOrg(req);
  const email = firstEmail(scim);
  if (!email) return res.status(400).json({ detail: "userName/email required", status: "400" });

  const existing = await prisma.user.findFirst({ where: { email, orgId }, include: { card: true } });
  if (existing) return res.status(200).json(scimUserResponse(existing, existing.card, req));

  const locationId = await resolveLocationId(scim, orgId);
  if (!locationId)
    return res.status(400).json({ detail: "No location to assign user to. Create a brand+store first.", status: "400" });

  const ent = scim[ENTERPRISE] || {};
  const firstName = scim.name?.givenName || scim.displayName?.split(" ")[0] || email.split("@")[0];
  const lastName = scim.name?.familyName || scim.displayName?.split(" ").slice(1).join(" ") || "";
  const slug = await uniqueSlug(firstName, lastName);

  const user = await runWithOrg(orgId, (db) =>
    db.user.create({
      data: {
        locationId,
        orgId,
        email,
        displayName: scim.displayName || `${firstName} ${lastName}`.trim(),
        externalId: scim.externalId || null,
        active: scim.active !== false,
        card: {
          create: {
            locationId,
            orgId,
            slug,
            firstName,
            lastName,
            title: scim.title || null,
            department: ent.department || null,
            ownerEmail: email,
            emails: [{ label: "Work", value: email }],
            phones: phonesFromScim(scim),
            active: scim.active !== false,
          },
        },
      },
      include: { card: true },
    })
  );

  if (user.card) emitEvent("card.created", cardPayload(user.card));
  res.status(201).json(scimUserResponse(user, user.card, req));
});

// Confirm the target user belongs to the caller's org, returning the org id (so
// the mutation runs under RLS) or null. Scoping by orgId prevents one tenant's
// SCIM token from touching another tenant's users by id.
async function userOrgId(id: string, orgId: string): Promise<string | null> {
  const u = await prisma.user.findFirst({ where: { id, orgId }, select: { orgId: true } });
  return u?.orgId ?? null;
}
function scimNotFound(res: Response) {
  return res.status(404).json({ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: "404" });
}

// ---- replace ----
scimRouter.put("/Users/:id", async (req, res) => {
  const scim = req.body || {};
  const orgId = await userOrgId(req.params.id, scimOrg(req));
  if (!orgId) return scimNotFound(res);
  const user = await runWithOrg(orgId, (db) =>
    db.user.update({
      where: { id: req.params.id },
      data: {
        displayName: scim.displayName || undefined,
        active: scim.active !== false,
        card: { update: { active: scim.active !== false, title: scim.title || undefined } },
      },
      include: { card: true },
    })
  );
  res.json(scimUserResponse(user, user.card, req));
});

// ---- patch (Entra uses this for activate/deactivate) ----
scimRouter.patch("/Users/:id", async (req, res) => {
  const ops = req.body?.Operations || [];
  let active: boolean | undefined;
  for (const op of ops) {
    if (String(op.path).toLowerCase() === "active" || (op.value && "active" in op.value)) {
      active = typeof op.value === "object" ? op.value.active : op.value === true || op.value === "True";
    }
  }
  const orgId = await userOrgId(req.params.id, scimOrg(req));
  if (!orgId) return scimNotFound(res);
  const user = await runWithOrg(orgId, (db) =>
    db.user.update({
      where: { id: req.params.id },
      data: {
        active: active ?? undefined,
        card: active === undefined ? undefined : { update: { active } },
      },
      include: { card: true },
    })
  );
  res.json(scimUserResponse(user, user.card, req));
});

// ---- delete (deactivate) ----
scimRouter.delete("/Users/:id", async (req, res) => {
  const orgId = await userOrgId(req.params.id, scimOrg(req));
  if (!orgId) return res.status(204).end();
  await runWithOrg(orgId, (db) =>
    db.user.update({
      where: { id: req.params.id },
      data: { active: false, card: { update: { active: false } } },
    })
  );
  res.status(204).end();
});
