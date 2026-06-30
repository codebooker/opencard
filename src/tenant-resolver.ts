import { Request } from "express";
import { prisma } from "./db";
import { defaultOrgId } from "./tenant";

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

// Bare hostname (no port) for the request, honoring the proxy's Host header.
export function requestHost(req: Request): string {
  const raw = (req.headers.host || "").toString();
  return raw.split(":")[0].trim().toLowerCase();
}

// Resolve an org from a hostname via custom domain or platform subdomain.
// Returns null when nothing matches (or when host-based routing isn't enabled).
export async function orgIdForHost(host: string): Promise<string | null> {
  if (!host) return null;

  // Exact custom-domain match first.
  const byDomain = await prisma.org.findFirst({ where: { customDomain: host }, select: { id: true } });
  if (byDomain) return byDomain.id;

  // Then a subdomain label under the configured platform domain.
  const platform = (process.env.PLATFORM_DOMAIN || "").toLowerCase().replace(/^\.+/, "");
  if (platform && host.endsWith(`.${platform}`)) {
    const label = host.slice(0, host.length - platform.length - 1);
    // Ignore reserved / non-tenant labels.
    if (label && !["www", "app", "admin", "api"].includes(label) && !label.includes(".")) {
      const bySub = await prisma.org.findFirst({ where: { subdomain: label }, select: { id: true } });
      if (bySub) return bySub.id;
    }
  }
  return null;
}

// Resolve the org for a public/host-addressed request, falling back to the
// single default org. Use this where the org is not already known from a
// credential (public card pages, future public signup-less surfaces).
export async function resolveOrgId(req: Request): Promise<string> {
  const byHost = await orgIdForHost(requestHost(req));
  return byHost ?? (await defaultOrgId());
}
