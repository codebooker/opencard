// Pure request-host parsing for tenant addressing. No runtime deps (only a
// type-only express import, erased by the compiler) so it is unit-testable.
import type { Request } from "express";

export type HostTenant = { kind: "custom"; host: string } | { kind: "subdomain"; label: string };

// Labels under the platform domain that never map to a tenant.
const RESERVED_LABELS = ["www", "app", "admin", "api"];

// Bare hostname (no port), lowercased, honoring the proxy's Host header.
export function requestHost(req: Request): string {
  const raw = (req.headers.host || "").toString();
  return raw.split(":")[0].trim().toLowerCase();
}

// Classify a host as either a platform subdomain (acme.opencard.id -> label
// "acme") or a custom domain (cards.acmecorp.com). Returns null when the host is
// the platform apex, a reserved label, or empty.
export function parseHost(host: string, platformDomain: string): HostTenant | null {
  host = (host || "").trim().toLowerCase();
  if (!host) return null;
  const platform = (platformDomain || "").toLowerCase().replace(/^\.+/, "");
  if (platform) {
    if (host === platform) return null; // the platform apex itself is not a tenant
    if (host.endsWith(`.${platform}`)) {
      const label = host.slice(0, host.length - platform.length - 1);
      if (label && !RESERVED_LABELS.includes(label) && !label.includes(".")) {
        return { kind: "subdomain", label };
      }
      return null;
    }
  }
  return { kind: "custom", host };
}
