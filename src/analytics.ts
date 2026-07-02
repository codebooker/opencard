// Pure analytics aggregation helpers — no db/express. Date-range resolution,
// conversion math, and leaderboard sorting. The route does the DB queries and
// feeds rows in here. Unit-tested.

export type RangeKey = "7" | "30" | "90" | "all";

export const ANALYTICS_RANGES: [RangeKey, string][] = [
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
  ["all", "All time"],
];

// Resolve a range query param to a start date (null = all time) + label.
export function resolveRange(raw: unknown, now: Date = new Date()): { key: RangeKey; since: Date | null; label: string } {
  const key = (ANALYTICS_RANGES.some(([k]) => k === raw) ? raw : "30") as RangeKey;
  const label = ANALYTICS_RANGES.find(([k]) => k === key)![1];
  if (key === "all") return { key, since: null, label };
  const since = new Date(now.getTime() - Number(key) * 86400000);
  return { key, since, label };
}

// Lead-to-view conversion rate as a percentage with one decimal (0 when no views).
export function conversionPct(leads: number, views: number): number {
  if (!views || views <= 0) return 0;
  return Math.round((leads / views) * 1000) / 10;
}

export type LeaderRow = { id: string; name: string; views: number; leads: number };

// Sort a leaderboard by leads, then views, then name; annotate each with its
// conversion rate.
export function sortLeaderboard(rows: LeaderRow[]): (LeaderRow & { conv: number })[] {
  return rows
    .map((r) => ({ ...r, conv: conversionPct(r.leads, r.views) }))
    .sort((a, b) => b.leads - a.leads || b.views - a.views || a.name.localeCompare(b.name));
}
