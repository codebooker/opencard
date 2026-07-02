// Pure analytics aggregation helpers — no db/express. Date-range resolution,
// conversion math, and leaderboard sorting. The route does the DB queries and
// feeds rows in here. Unit-tested.

import { LEAD_STATUSES, STATUS_LABELS } from "./leadstatus";

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

// The lead-status funnel in canonical order, filling zeros for missing statuses.
export function buildFunnel(statusCounts: Record<string, number>): { status: string; label: string; count: number }[] {
  return (LEAD_STATUSES as readonly string[]).map((s) => ({
    status: s,
    label: STATUS_LABELS[s as keyof typeof STATUS_LABELS] || s,
    count: statusCounts[s] || 0,
  }));
}

// Top-N groups from a { key: count } map, sorted by count desc then key; blank
// keys dropped.
export function topGroups(counts: Record<string, number>, n = 10): { key: string; count: number }[] {
  return Object.entries(counts)
    .filter(([k]) => k && k.trim())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, n);
}

export type LeaderRow = { id: string; name: string; views: number; leads: number };

// Sort a leaderboard by leads, then views, then name; annotate each with its
// conversion rate.
export function sortLeaderboard(rows: LeaderRow[]): (LeaderRow & { conv: number })[] {
  return rows
    .map((r) => ({ ...r, conv: conversionPct(r.leads, r.views) }))
    .sort((a, b) => b.leads - a.leads || b.views - a.views || a.name.localeCompare(b.name));
}
