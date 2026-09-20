import { prisma, runWithOrg } from "./db";
import { uniqueSlug } from "./slug";
import { emitEvent, cardPayload } from "./webhooks";
import { isOrgLimitReached, withOrgLimit } from "./entitlements";
import * as secretbox from "./secretbox";

// Microsoft Graph directory import (Phase 13): bulk-backfill existing
// employees into cards. SCIM handles ongoing provisioning; this wizard is the
// day-one on-ramp — pick everyone, one group, or one department, PREVIEW the
// mapping, tick the people you want, then create. Cards are created exactly
// like SCIM does (User + Card together), and existing emails are always
// skipped, so re-running is safe.

export type GraphCreds = { tenantId: string; clientId: string; clientSecret: string };

// STRICTLY the org's own self-service config — no fallback of any kind. An
// earlier revision fell back to platform env credentials for staff, which
// surfaced the PLATFORM's directory inside every client workspace a staff
// member opened. Directory data is tenant data: each org connects its own
// Azure app on the Import page, or the wizard stays unconfigured.
export async function credsForOrg(orgId: string): Promise<{ creds: GraphCreds; source: "org" } | null> {
  const row = await prisma.directoryConfig.findUnique({ where: { orgId } });
  if (!row) return null;
  const secret = secretbox.open(row.clientSecret);
  if (!secret) return null;
  return { creds: { tenantId: row.tenantId, clientId: row.clientId, clientSecret: secret }, source: "org" };
}

// Public shape for the settings form (never includes the secret).
export async function directoryConfigSummary(orgId: string): Promise<{ tenantId: string; clientId: string } | null> {
  const row = await prisma.directoryConfig.findUnique({ where: { orgId }, select: { tenantId: true, clientId: true } });
  return row;
}

// Upsert the org's credentials. Blank secret on an existing config means
// "keep the current one" so tenants can fix a typo'd ID without re-pasting.
export async function saveDirectoryConfig(orgId: string, input: { tenantId: string; clientId: string; clientSecret: string }): Promise<void> {
  const existing = await prisma.directoryConfig.findUnique({ where: { orgId } });
  const sealed = input.clientSecret ? secretbox.seal(input.clientSecret) : existing?.clientSecret;
  if (!sealed) throw new Error("A client secret is required.");
  await prisma.directoryConfig.upsert({
    where: { orgId },
    create: { orgId, tenantId: input.tenantId, clientId: input.clientId, clientSecret: sealed },
    update: { tenantId: input.tenantId, clientId: input.clientId, clientSecret: sealed },
  });
  tokenCache.delete(cacheKey({ tenantId: input.tenantId, clientId: input.clientId, clientSecret: "" }));
}

export async function deleteDirectoryConfig(orgId: string): Promise<void> {
  await prisma.directoryConfig.deleteMany({ where: { orgId } });
}

// ---- Graph auth (client credentials; requires APPLICATION permissions
// User.Read.All — and GroupMember.Read.All for group imports — with admin
// consent). Tokens are cached per tenant+app, never per process-global. ----
const tokenCache = new Map<string, { token: string; exp: number }>();
const cacheKey = (c: GraphCreds) => `${c.tenantId}:${c.clientId}`;

async function graphToken(creds: GraphCreds): Promise<string> {
  const hit = tokenCache.get(cacheKey(creds));
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const resp = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(creds.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const json: any = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.access_token) {
    throw new Error(`Azure sign-in failed (${resp.status}): ${json.error_description?.slice(0, 200) || json.error || "unknown"}`);
  }
  tokenCache.set(cacheKey(creds), { token: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 });
  return json.access_token;
}

async function graphGet(creds: GraphCreds, path: string): Promise<any> {
  const token = await graphToken(creds);
  const resp = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" },
    signal: AbortSignal.timeout(20000),
  });
  const json: any = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = json?.error?.message || `HTTP ${resp.status}`;
    if (resp.status === 403)
      throw new Error(
        `Graph permission denied: ${msg}. Grant the app registration APPLICATION permissions User.Read.All (and GroupMember.Read.All for groups) with admin consent.`
      );
    throw new Error(`Graph request failed: ${msg}`);
  }
  return json;
}

const USER_SELECT =
  "$select=id,displayName,givenName,surname,mail,userPrincipalName,jobTitle,department,officeLocation,businessPhones,mobilePhone,accountEnabled";
const PAGE_CAP = 2000; // sanity cap for a single import run

async function pagedUsers(creds: GraphCreds, firstPath: string): Promise<any[]> {
  const out: any[] = [];
  let url: string | null = firstPath;
  while (url && out.length < PAGE_CAP) {
    const json: any = await graphGet(creds, url);
    out.push(...(json.value || []));
    const next: string | undefined = json["@odata.nextLink"];
    url = next ? next.replace("https://graph.microsoft.com/v1.0", "") : null;
  }
  return out.slice(0, PAGE_CAP);
}

export async function listDirectoryUsers(creds: GraphCreds, groupId?: string): Promise<any[]> {
  if (groupId) return pagedUsers(creds, `/groups/${encodeURIComponent(groupId)}/members/microsoft.graph.user?${USER_SELECT}&$top=999`);
  return pagedUsers(creds, `/users?${USER_SELECT}&$top=999`);
}

export async function searchGroups(creds: GraphCreds, q: string): Promise<{ id: string; displayName: string }[]> {
  // $search matches any WORD in the group name (prefix per token), unlike a
  // startswith filter — "IT" finds "Tawes IT Team". Requires the
  // ConsistencyLevel: eventual header, which graphGet always sends.
  const safe = q.replace(/["\\]/g, "").slice(0, 60);
  const json = await graphGet(creds, `/groups?$search=${encodeURIComponent(`"displayName:${safe}"`)}&$select=id,displayName&$top=25`);
  return (json.value || []).map((g: any) => ({ id: g.id, displayName: g.displayName }));
}

// Departments exist as a user ATTRIBUTE in most tenants (not as groups), so
// this filters client-side over the fetched directory — case-insensitive
// substring, e.g. "service" matches "Service" and "Service & Parts".
export function filterByDepartment(users: any[], q: string): any[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return users;
  return users.filter((u) => String(u?.department || "").toLowerCase().includes(needle));
}

// Settings-page "Test connection": prove sign-in + User.Read.All in one call.
export async function testGraphCreds(creds: GraphCreds): Promise<{ ok: true; sample: number } | { ok: false; message: string }> {
  try {
    const json = await graphGet(creds, `/users?$select=id&$top=5`);
    return { ok: true, sample: (json.value || []).length };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e).slice(0, 300) };
  }
}

// ---- mapping (pure; unit-tested) ----
export type ImportCandidate = {
  email: string;
  firstName: string;
  lastName: string;
  title: string | null;
  department: string | null;
  locationHint: string | null;
  phones: { label: string; value: string }[];
  enabled: boolean;
};

export function mapGraphUser(u: any): ImportCandidate | null {
  const email = String(u?.mail || u?.userPrincipalName || "").toLowerCase().trim();
  if (!email || !email.includes("@")) return null;
  const display = String(u?.displayName || "");
  const firstName = String(u?.givenName || display.split(" ")[0] || email.split("@")[0]);
  const lastName = String(u?.surname || display.split(" ").slice(1).join(" ") || "");
  const phones: { label: string; value: string }[] = [];
  if (Array.isArray(u?.businessPhones) && u.businessPhones[0]) phones.push({ label: "Work", value: String(u.businessPhones[0]) });
  if (u?.mobilePhone) phones.push({ label: "Mobile", value: String(u.mobilePhone) });
  return {
    email,
    firstName,
    lastName,
    title: u?.jobTitle ? String(u.jobTitle) : null,
    department: u?.department ? String(u.department) : null,
    locationHint: u?.officeLocation ? String(u.officeLocation) : null,
    phones,
    enabled: u?.accountEnabled !== false,
  };
}

// Same resolution order as SCIM: explicit code match, then name match, then
// the org's first location.
async function resolveLocation(orgId: string, hint: string | null, fallbackId: string | null): Promise<{ id: string; name: string } | null> {
  if (hint) {
    const byCode = await prisma.location.findFirst({ where: { orgId, code: hint }, select: { id: true, name: true } });
    if (byCode) return byCode;
    const byName = await prisma.location.findFirst({
      where: { orgId, name: { equals: hint, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (byName) return byName;
  }
  if (fallbackId) {
    return prisma.location.findUnique({ where: { id: fallbackId }, select: { id: true, name: true } });
  }
  return prisma.location.findFirst({ where: { orgId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
}

export type PlanRow = ImportCandidate & {
  status: "create" | "exists" | "disabled";
  location: { id: string; name: string } | null;
};

// Build the preview: what would happen for each directory user.
export async function planImport(orgId: string, rawUsers: any[], fallbackLocationId?: string): Promise<PlanRow[]> {
  const candidates = rawUsers.map(mapGraphUser).filter((c): c is ImportCandidate => !!c);
  return planCandidates(orgId, candidates, fallbackLocationId);
}

// Source-agnostic core (Graph wizard and CSV import both land here).
export async function planCandidates(orgId: string, candidates: ImportCandidate[], fallbackLocationId?: string): Promise<PlanRow[]> {
  const emails = candidates.map((c) => c.email);
  const existingUsers = await prisma.user.findMany({ where: { orgId, email: { in: emails } }, select: { email: true } });
  const existingCards = await prisma.card.findMany({
    where: { orgId, ownerEmail: { in: emails, mode: "insensitive" } },
    select: { ownerEmail: true },
  });
  const taken = new Set([
    ...existingUsers.map((u) => u.email.toLowerCase()),
    ...existingCards.map((c) => (c.ownerEmail || "").toLowerCase()),
  ]);
  const rows: PlanRow[] = [];
  for (const c of candidates) {
    const location = await resolveLocation(orgId, c.locationHint, fallbackLocationId || null);
    rows.push({
      ...c,
      location,
      status: taken.has(c.email) ? "exists" : c.enabled ? "create" : "disabled",
    });
  }
  return rows;
}

// Keep only the "create" rows the admin actually ticked in the preview.
// Selection is by email (stable across the re-fetch at apply time).
export function onlySelected(rows: PlanRow[], selected: string[]): PlanRow[] {
  const set = new Set(selected.map((e) => e.toLowerCase().trim()));
  return rows.filter((r) => r.status === "create" && set.has(r.email));
}

// Create User + Card pairs for every "create" row — identical shape to SCIM
// provisioning, so all paths produce the same records. `source` tags
// User.provisionedBy for the sync health dashboard ("import" | "csv").
export async function applyImport(orgId: string, rows: PlanRow[], source: "import" | "csv" = "import"): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.status !== "create" || !row.location) {
      skipped++;
      continue;
    }
    const slug = await uniqueSlug(row.firstName, row.lastName);
    let user;
    try {
      user = await withOrgLimit(orgId, "cards", () =>
        runWithOrg(orgId, (db) =>
          db.user.create({
            data: {
              locationId: row.location!.id,
              orgId,
              email: row.email,
              displayName: `${row.firstName} ${row.lastName}`.trim(),
              provisionedBy: source,
              active: true,
              card: {
                create: {
                  locationId: row.location!.id,
                  orgId,
                  slug,
                  firstName: row.firstName,
                  lastName: row.lastName,
                  title: row.title,
                  department: row.department,
                  ownerEmail: row.email,
                  emails: [{ label: "Work", value: row.email }],
                  phones: row.phones,
                  active: true,
                },
              },
            },
            include: { card: true },
          })
        )
      );
    } catch (e) {
      if (!isOrgLimitReached(e)) throw e;
      skipped++;
      continue;
    }
    if (user.card) emitEvent(user.card.orgId, "card.created", cardPayload(user.card));
    created++;
  }
  return { created, skipped };
}
