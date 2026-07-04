// Server-rendered SVG charts (Phase 14). Pure string builders — no client JS,
// no framework, theme-aware via currentColor + a single accent. Unit-tested.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Bucket timestamps into per-day counts covering [since..now] (inclusive).
// With no `since` (all time), the window starts at the earliest timestamp,
// capped at `maxDays` back so the chart stays readable.
export function bucketDays(dates: Date[], since: Date | null, now: Date = new Date(), maxDays = 90): { day: string; count: number }[] {
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  let start: Date;
  if (since) start = since;
  else if (dates.length) start = new Date(Math.min(...dates.map((d) => d.getTime())));
  else start = new Date(now.getTime() - 29 * 86400000);
  const floor = new Date(now.getTime() - (maxDays - 1) * 86400000);
  if (start < floor) start = floor;
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(dayKey(d), (counts.get(dayKey(d)) || 0) + 1);
  const out: { day: string; count: number }[] = [];
  for (let t = new Date(dayKey(start)); t <= now; t = new Date(t.getTime() + 86400000)) {
    const k = dayKey(t);
    out.push({ day: k, count: counts.get(k) || 0 });
  }
  return out;
}

// Area/line chart of a daily series. Returns "" for empty/flat-zero series.
export function svgAreaChart(series: { day: string; count: number }[], opts: { width?: number; height?: number; accent?: string } = {}): string {
  if (!series.length) return "";
  const W = opts.width ?? 640;
  const H = opts.height ?? 140;
  const accent = opts.accent ?? "#1F5BEA";
  const PAD = { l: 34, r: 8, t: 8, b: 18 };
  const max = Math.max(...series.map((p) => p.count));
  if (max === 0) return "";
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.count).toFixed(1)}`);
  const area = `M${PAD.l},${PAD.t + ih} L${pts.join(" L")} L${(PAD.l + iw).toFixed(1)},${PAD.t + ih} Z`;
  const line = `M${pts.join(" L")}`;
  const mid = Math.floor(series.length / 2);
  const tick = (i: number, anchor: string) =>
    `<text x="${x(i).toFixed(1)}" y="${H - 4}" font-size="10" fill="currentColor" opacity="0.55" text-anchor="${anchor}">${esc(series[i].day.slice(5))}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily views" style="width:100%;height:auto;max-width:${W}px">
    <text x="4" y="${(y(max) + 4).toFixed(1)}" font-size="10" fill="currentColor" opacity="0.55">${max}</text>
    <text x="4" y="${PAD.t + ih}" font-size="10" fill="currentColor" opacity="0.55">0</text>
    <line x1="${PAD.l}" y1="${PAD.t + ih}" x2="${W - PAD.r}" y2="${PAD.t + ih}" stroke="currentColor" opacity="0.15"/>
    <path d="${area}" fill="${accent}" opacity="0.12"/>
    <path d="${line}" fill="none" stroke="${accent}" stroke-width="2"/>
    ${tick(0, "start")}${series.length > 4 ? tick(mid, "middle") : ""}${series.length > 1 ? tick(series.length - 1, "end") : ""}
  </svg>`;
}

// Horizontal bars for categorical breakdowns (funnel, source mix). Labels on
// the left, counts on the right; widths proportional to the max value.
export function svgBars(rows: { label: string; count: number }[], opts: { width?: number; accent?: string } = {}): string {
  if (!rows.length) return "";
  const W = opts.width ?? 640;
  const accent = opts.accent ?? "#1F5BEA";
  const ROW = 24;
  const LABEL_W = 170;
  const COUNT_W = 44;
  const max = Math.max(...rows.map((r) => r.count), 1);
  const bw = W - LABEL_W - COUNT_W;
  const H = rows.length * ROW + 4;
  const bars = rows
    .map((r, i) => {
      const yTop = i * ROW + 2;
      const w = Math.max(r.count > 0 ? 3 : 0, (r.count / max) * bw);
      return `
    <text x="${LABEL_W - 8}" y="${yTop + 15}" font-size="12" fill="currentColor" text-anchor="end">${esc(r.label.slice(0, 26))}</text>
    <rect x="${LABEL_W}" y="${yTop + 3}" width="${w.toFixed(1)}" height="14" rx="3" fill="${accent}" opacity="${0.9 - i * 0.03}"/>
    <text x="${LABEL_W + w + 6}" y="${yTop + 15}" font-size="12" fill="currentColor" opacity="0.7">${r.count}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" style="width:100%;height:auto;max-width:${W}px">${bars}</svg>`;
}
