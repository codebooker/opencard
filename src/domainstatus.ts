// Pure helpers for the custom-domain onboarding hub — no db/dns here, just the
// logic that turns a DNS lookup result into a client-friendly status, plus the
// exact record the client must create.

// The host clients CNAME their domain to (an A record for this points at the
// server). Overridable per deploy.
export const CNAME_TARGET = process.env.TENANTS_CNAME_TARGET || "tenants.opencard.id";

export type DnsResolved = { cnames: string[]; addrs: string[] };
export type DomainExpectation = { cnameTarget: string; ips: string[] };
export type DomainVerdict = { ok: boolean; reason: string };

function norm(h: string): string {
  return String(h || "").trim().toLowerCase().replace(/\.$/, "");
}

// Decide whether a hostname's DNS points at us (so a cert will auto-issue).
export function evaluateDomain(resolved: DnsResolved, expected: DomainExpectation): DomainVerdict {
  const cnames = (resolved.cnames || []).map(norm).filter(Boolean);
  const addrs = (resolved.addrs || []).filter(Boolean);
  const target = norm(expected.cnameTarget);
  if (target && cnames.includes(target)) return { ok: true, reason: `Points to ${expected.cnameTarget}` };
  if (addrs.some((a) => (expected.ips || []).includes(a))) return { ok: true, reason: "Resolves to our server" };
  if (!cnames.length && !addrs.length) return { ok: false, reason: "No DNS record found yet — add the CNAME below." };
  return { ok: false, reason: `Currently points to ${cnames[0] || addrs[0]}, not us.` };
}

// The exact DNS record the client should create for their host.
export function cnameInstruction(host: string, target = CNAME_TARGET): { type: string; name: string; value: string } {
  return { type: "CNAME", name: norm(host), value: target };
}
