// Pure CSV builder (RFC-4180-ish quoting). The single CSV helper for all
// exports (analytics, leads) — don't hand-roll CSV elsewhere.

// Cells starting with = + - @ (or tab/CR) are executed as formulas by
// Excel/Sheets, so user-sourced values like "=HYPERLINK(...)" would run when
// an admin opens the export. Prefix them with ' so they render as text
// (OWASP CSV-injection guidance). Genuine numbers are passed through.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (typeof v !== "number" && FORMULA_LEAD.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
