import { prisma, runWithOrg } from "./db";
import { uniqueSlug } from "./slug";
import { emitEvent, cardPayload } from "./webhooks";

// SAML JIT provisioning (Phase 13): when an org opts in, the first SSO
// sign-in creates the person's User + Card from assertion attributes —
// the same record shape SCIM and the import wizard produce, so all three
// provisioning paths are interchangeable. Existing emails are never touched;
// JIT only fills the "signed in but has no card" gap.

export type JitCandidate = {
  email: string;
  firstName: string;
  lastName: string;
  title: string | null;
  department: string | null;
};

// Attribute names vary wildly by IdP: friendly names (Okta/Google), WS-Fed
// claim URIs (Entra), and LDAP OIDs (ADFS). Check them all.
const ATTR = {
  givenName: [
    "givenName",
    "firstName",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
    "urn:oid:2.5.4.42",
  ],
  surname: [
    "sn",
    "surname",
    "lastName",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
    "urn:oid:2.5.4.4",
  ],
  displayName: [
    "displayName",
    "cn",
    "name",
    "http://schemas.microsoft.com/identity/claims/displayname",
    "urn:oid:2.16.840.1.113730.3.1.241",
  ],
  title: ["title", "jobTitle", "urn:oid:2.5.4.12"],
  department: ["department", "urn:oid:2.5.4.11"],
};

function attr(profile: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = profile[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v) && typeof v[0] === "string" && v[0].trim()) return v[0].trim();
  }
  return null;
}

// Pure mapping (unit-tested): assertion profile -> card fields, with the same
// fallback chain the SCIM and Graph paths use.
export function mapSamlProfile(profile: Record<string, unknown>, email: string): JitCandidate {
  const display = attr(profile, ATTR.displayName) || "";
  const firstName = attr(profile, ATTR.givenName) || display.split(" ")[0] || email.split("@")[0];
  const lastName = attr(profile, ATTR.surname) || display.split(" ").slice(1).join(" ") || "";
  return {
    email: email.toLowerCase().trim(),
    firstName,
    lastName,
    title: attr(profile, ATTR.title),
    department: attr(profile, ATTR.department),
  };
}

// Create the User + Card if (and only if) this email has neither. Returns
// what happened so the caller can log it; never throws into the sign-in flow.
export async function jitProvision(
  orgId: string,
  profile: Record<string, unknown>,
  email: string
): Promise<"created" | "exists" | "no-location" | "failed"> {
  try {
    const existingUser = await prisma.user.findFirst({ where: { orgId, email }, select: { id: true } });
    if (existingUser) return "exists";
    const existingCard = await prisma.card.findFirst({
      where: { orgId, ownerEmail: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (existingCard) return "exists";

    const location = await prisma.location.findFirst({
      where: { orgId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!location) return "no-location";

    const c = mapSamlProfile(profile, email);
    const slug = await uniqueSlug(c.firstName, c.lastName);
    const user = await runWithOrg(orgId, (db) =>
      db.user.create({
        data: {
          locationId: location.id,
          orgId,
          email: c.email,
          displayName: `${c.firstName} ${c.lastName}`.trim(),
          provisionedBy: "jit",
          active: true,
          card: {
            create: {
              locationId: location.id,
              orgId,
              slug,
              firstName: c.firstName,
              lastName: c.lastName,
              title: c.title,
              department: c.department,
              ownerEmail: c.email,
              emails: [{ label: "Work", value: c.email }],
              phones: [],
              active: true,
            },
          },
        },
        include: { card: true },
      })
    );
    if (user.card) emitEvent(user.card.orgId, "card.created", cardPayload(user.card));
    return "created";
  } catch {
    return "failed";
  }
}
