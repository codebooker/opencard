import { config } from "./config";
import { prisma, runWithOrg } from "./db";
import { uniqueSlug } from "./slug";
import { emitEvent, cardPayload } from "./webhooks";

// Microsoft Graph directory import (Phase 13): bulk-backfill existing
// employees into cards. SCIM handles ongoing provisioning; this wizard is the
// day-one on-ramp — pick all users or one group, PREVIEW the mapping, then
// create. Cards are created exactly like SCIM does (User + Card together),
// and existing emails are always skipped, so re-running is safe.

export function graphConfigured(): boolean {
  return !!(config.azure.tenantId && config.azure.clientId && config.azure.clientSecret);
}

// ---- Graph auth (client credentials; requires APPLICATION permissions
// User.Read.All — and GroupMember.Read.All for group imports — with admin
// consent on the app registration already used for OIDC sign-in). ----
let cachedToken: { token: string; exp: number } | null = null;

async function graphToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const body = new URLSearchParams({
    client_id: config.azure.clientId,
    client_secret: config.azure.clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const resp = await fetch(`https://login.microsoftonline.com/${config.azure.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const json: any = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.access_token) {
    throw new Error(`Azure token request failed (${resp.status}): ${json.error_description?.slice(0, 200) || json.error || "unknown"}`);
  }
  cachedToken = { token: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 };
  return json.access_token;
}

async function graphGet(path: string): Promise<any> {
  const token = await graphToken();
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

async function pagedUsers(firstPath: string): Promise<any[]> {
  const out: any[] = [];
  let url: string | null = firstPath;
  while (url && out.length < PAGE_CAP) {
    const json: any = await graphGet(url);
    out.push(...(json.value || []));
    const next: string | undefined = json["@odata.nextLink"];
    url = next ? next.replace("https://graph.microsoft.com/v1.0", "") : null;
  }
  return out.slice(0, PAGE_CAP);
}

export async function listDirectoryUsers(groupId?: string): Promise<any[]> {
  if (groupId) return pagedUsers(`/groups/${encodeURIComponent(groupId)}/members/microsoft.graph.user?${USER_SELECT}&$top=999`);
  return pagedUsers(`/users?${USER_SELECT}&$top=999`);
}

export async function searchGroups(q: string): Promise<{ id: string; displayName: string }[]> {
  // $search matches any WORD in the group name (prefix per token), unlike a
  // startswith filter — "IT" finds "Tawes IT Team". Requires the
  // ConsistencyLevel: eventual header, which graphGet always sends.
  const safe = q.replace(/["\\]/g, "").slice(0, 60);
  const json = await graphGet(`/groups?$search=${encodeURIComponent(`"displayName:${safe}"`)}&$select=id,displayName&$top=25`);
  return (json.value || []).map((g: any) => ({ id: g.id, displayName: g.displayName }));
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

// Create User + Card pairs for every "create" row — identical shape to SCIM
// provisioning, so both paths produce the same records.
export async function applyImport(orgId: string, rows: PlanRow[]): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.status !== "create" || !row.location) {
      skipped++;
      continue;
    }
    const slug = await uniqueSlug(row.firstName, row.lastName);
    const user = await runWithOrg(orgId, (db) =>
      db.user.create({
        data: {
          locationId: row.location!.id,
          orgId,
          email: row.email,
          displayName: `${row.firstName} ${row.lastName}`.trim(),
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
    );
    if (user.card) emitEvent("card.created", cardPayload(user.card));
    created++;
  }
  return { created, skipped };
}
