// Pure data-retention helpers — no db. Cutoff computation + input parsing.

// Parse an admin-entered retention value. Blank / 0 / negative / non-numeric =>
// null (keep forever). Otherwise a positive integer number of days (capped).
export function parseRetentionDays(raw: unknown): number | null {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, 3650); // cap at ~10 years
}

// The cutoff date: records created before this are eligible for pruning. Null when
// retention is disabled (keep forever).
export function retentionCutoff(days: number | null | undefined, now: Date = new Date()): Date | null {
  if (!days || days <= 0) return null;
  return new Date(now.getTime() - days * 86400000);
}

// Human summary for the UI.
export function retentionLabel(days: number | null | undefined): string {
  return days && days > 0 ? `Leads are deleted after ${days} day${days === 1 ? "" : "s"}.` : "Leads are kept indefinitely.";
}
