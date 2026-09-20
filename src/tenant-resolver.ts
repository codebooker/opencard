import { Request } from "express";
import { prisma } from "./db";
import { defaultOrgId } from "./tenant";
import { parseHost, requestHost } from "./host";
import { LoginBranding, loginBranding, normalizeHost, normalizeDomainKind, DomainKind } from "./branding";

export { requestHost };

// Resolve client login-branding for a hostname via a registered TenantDomain.
// A domain maps to a brand (brand-wide) or a rooftop (location override). Returns
// null when the host isn't registered (caller then uses default OpenCard branding).
export async function loginBrandingForHost(host: string): Promise<LoginBranding | null> {
  const h = normalizeHost(host);
  if (!h) return null;
  const d = await prisma.tenantDomain.findUnique({
    where: { host: h },
    include: { brand: true, location: { include: { brand: true } } },
  });
  if (!d) return null;
  if (d.location) return loginBranding(d.location.brand, d.location);
  return loginBranding(d.brand, null);
}

// Which portal a custom domain lands on (admin vs employee), or null if the host
// isn't a registered client domain. Used to redirect the domain root.
export async function domainKindForHost(host: string): Promise<DomainKind | null> {
  const h = normalizeHost(host);
  if (!h) return null;
  const d = await prisma.tenantDomain.findUnique({ where: { host: h }, select: { kind: true } });
  return d ? normalizeDomainKind(d.kind) : null;
}

// Is `host` approved for on-demand TLS issuance? (Caddy asks before getting a
// cert, so we only auto-issue for hostnames a client admin registered.)
export async function isDomainApproved(host: string): Promise<boolean> {
  const h = normalizeHost(host);
  if (!h) return false;
  const d = await prisma.tenantDomain.findUnique({ where: { host: h }, select: { approved: true } });
  return !!d?.approved;
}

// Tenant (Org) resolution for a request.
//
// This is the single seam that answers "which org is this request for?". Today
// most requests resolve to the single default org, but the strategies are
// ordered so that turning on real multi-tenant addressing later is additive:
//
//   1. Host-based: a customer custom domain (cards.acmecorp.com) or a subdomain
//      under the platform domain (acme.opencard.id). Ready now, but inert until
//      PLATFORM_DOMAIN is set and orgs have subdomain/customDomain populated and
//      DNS/TLS actually points those hosts at us.
//   2. Fallback: the single default org (current single-tenant behavior).
//
// API, SCIM, and admin requests resolve their org from their own credential
// (API key -> key.orgId, etc.) rather than the host, so those callers pass the
// org they already know straight to runWithOrg.

// Resolve an org from a hostname via custom domain or platform subdomain.
// Returns null when nothing matches (or when host-based routing isn't enabled).
export async function orgIdForHost(host: string): Promise<string | null> {
  const parsed = parseHost(host, process.env.PLATFORM_DOMAIN || "");
  if (!parsed) return null;
  // Branded login domains are scoped at brand/location level, but still carry
  // the authoritative org id needed by employee SSO and public tenant routing.
  // Only approved claims participate in routing; pending DNS claims do not.
  if (parsed.kind === "custom") {
    const branded = await prisma.tenantDomain.findFirst({
      where: { host: parsed.host, approved: true },
      select: { orgId: true },
    });
    if (branded) return branded.orgId;
  }
  const where = parsed.kind === "custom" ? { customDomain: parsed.host } : { subdomain: parsed.label };
  const org = await prisma.org.findFirst({ where, select: { id: true } });
  return org?.id ?? null;
}

// Resolve the org for a public/host-addressed request, falling back to the
// single default org. Use this where the org is not already known from a
// credential (public card pages, future public signup-less surfaces).
export async function resolveOrgId(req: Request): Promise<string> {
  const byHost = await orgIdForHost(requestHost(req));
  return byHost ?? (await defaultOrgId());
}
