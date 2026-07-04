import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketDays, svgAreaChart, svgBars } from "./charts";

const d = (s: string) => new Date(s);

test("bucketDays fills every day in the window, zeros included", () => {
  const now = d("2026-07-04T12:00:00Z");
  const out = bucketDays([d("2026-07-01T08:00:00Z"), d("2026-07-01T09:00:00Z"), d("2026-07-03T10:00:00Z")], d("2026-07-01T00:00:00Z"), now);
  assert.deepEqual(out.map((p) => p.count), [2, 0, 1, 0]);
  assert.equal(out[0].day, "2026-07-01");
  assert.equal(out.at(-1)!.day, "2026-07-04");
});

test("bucketDays all-time window starts at earliest point, capped at maxDays", () => {
  const now = d("2026-07-04T00:00:00Z");
  const out = bucketDays([d("2026-07-02T01:00:00Z")], null, now, 90);
  assert.equal(out[0].day, "2026-07-02");
  const capped = bucketDays([d("2020-01-01T00:00:00Z")], null, now, 90);
  assert.equal(capped.length, 90);
});

test("svgAreaChart renders a path and returns empty for flat-zero data", () => {
  const svg = svgAreaChart([
    { day: "2026-07-01", count: 3 },
    { day: "2026-07-02", count: 0 },
    { day: "2026-07-03", count: 5 },
  ]);
  assert.match(svg, /<svg /);
  assert.match(svg, /stroke-width="2"/);
  assert.equal(svgAreaChart([{ day: "2026-07-01", count: 0 }]), "");
  assert.equal(svgAreaChart([]), "");
});

test("svgBars escapes labels and scales widths", () => {
  const svg = svgBars([
    { label: "Employee <card>", count: 10 },
    { label: "QR poster", count: 5 },
  ]);
  assert.match(svg, /Employee &lt;card&gt;/);
  assert.doesNotMatch(svg, /<card>/);
  assert.equal(svgBars([]), "");
});
