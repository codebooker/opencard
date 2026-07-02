// Pure lead-lifecycle helpers — no db/config, unit-testable in isolation.

export const LEAD_STATUSES = ["new", "sent", "synced", "failed", "archived"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const STATUS_LABELS: Record<string, string> = {
  new: "New",
  sent: "Sent",
  synced: "Synced",
  failed: "Failed",
  archived: "Archived",
};

// Allowed status transitions (a small state machine).
const TRANSITIONS: Record<string, string[]> = {
  new: ["sent", "archived"],
  sent: ["synced", "failed", "archived"],
  synced: ["archived"],
  failed: ["sent", "archived"], // retry a failed sync
  archived: ["new"], // un-archive
};

export function canTransition(from: string, to: string): boolean {
  if (from === to) return false;
  if (!(LEAD_STATUSES as readonly string[]).includes(to)) return false;
  return (TRANSITIONS[from] || []).includes(to);
}

export function nextStatuses(from: string): string[] {
  return TRANSITIONS[from] || [];
}

// Normalize contact details for duplicate matching: lowercased email, and the
// last 10 digits of the phone (so formatting/country prefixes don't matter).
export function normalizeContact(
  email: string | null | undefined,
  phone: string | null | undefined
): { email: string | null; phone: string | null } {
  const e = (email || "").trim().toLowerCase();
  const digits = (phone || "").replace(/\D/g, "");
  const p = digits ? digits.slice(-10) : "";
  return {
    email: e.includes("@") ? e : null,
    phone: p.length >= 7 ? p : null,
  };
}

// Find a prior lead this candidate duplicates (same normalized email OR phone).
// Returns the matched lead id, or null.
export function findDuplicate(
  candidate: { email?: string | null; phone?: string | null },
  existing: Array<{ id: string; email?: string | null; phone?: string | null }>
): string | null {
  const c = normalizeContact(candidate.email, candidate.phone);
  if (!c.email && !c.phone) return null;
  for (const e of existing) {
    const n = normalizeContact(e.email, e.phone);
    if ((c.email && n.email && c.email === n.email) || (c.phone && n.phone && c.phone === n.phone)) {
      return e.id;
    }
  }
  return null;
}
