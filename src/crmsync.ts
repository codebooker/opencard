// Pure CRM-sync helpers — no db/network. Field mapping from a lead to an outbound
// CRM record, the normalized payload shape, and the retry / dead-letter state
// machine. Unit-tested; the dispatcher (crmsync-dispatch) does the DB + HTTP.

// Lead fields that can be mapped to a CRM target field.
export const CRM_SOURCE_FIELDS: [string, string][] = [
  ["name", "Name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["company", "Company"],
  ["note", "Note / message"],
  ["preferredContact", "Preferred contact"],
  ["vehicleInterest", "Vehicle interest"],
  ["tradeIn", "Trade-in interest"],
  ["serviceNeed", "Service need"],
  ["appointmentRequest", "Appointment requested"],
  ["consent", "Consent given"],
  ["campaign", "Campaign"],
  ["utmSource", "UTM source"],
  ["utmMedium", "UTM medium"],
  ["utmCampaign", "UTM campaign"],
  ["referrer", "Referrer"],
  ["device", "Device"],
  ["status", "Lead status"],
  ["assignedTo", "Assigned to"],
];

const SOURCE_KEYS = new Set(CRM_SOURCE_FIELDS.map(([k]) => k));

export type FieldMap = Record<string, string>; // targetKey -> lead source field

// Keep only mappings whose value is a known lead field and whose key is non-empty.
export function sanitizeFieldMap(raw: unknown): FieldMap {
  const out: FieldMap = {};
  if (raw && typeof raw === "object") {
    for (const [target, src] of Object.entries(raw as Record<string, unknown>)) {
      const t = String(target).trim();
      if (t && typeof src === "string" && SOURCE_KEYS.has(src)) out[t] = src;
    }
  }
  return out;
}

// Parse an admin textarea ("targetKey = leadField" per line) into a field map.
export function parseFieldMapLines(text: string | null | undefined): FieldMap {
  const map: Record<string, string> = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) {
      const target = line.slice(0, i).trim();
      const src = line.slice(i + 1).trim();
      if (target && src) map[target] = src;
    }
  }
  return sanitizeFieldMap(map);
}

// Render a field map back to textarea lines for editing.
export function fieldMapToLines(v: unknown): string {
  return Object.entries(sanitizeFieldMap(v))
    .map(([t, s]) => `${t} = ${s}`)
    .join("\n");
}

// Split a full name into first / last (last token = last name). Shared by the
// HubSpot and Salesforce connectors.
export function splitName(full: string | null | undefined): { firstname?: string; lastname?: string } {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  if (parts.length === 1) return { firstname: parts[0] };
  return { firstname: parts.slice(0, -1).join(" "), lastname: parts[parts.length - 1] };
}

function leadValue(lead: any, field: string): unknown {
  const v = lead?.[field];
  return v === undefined ? null : v;
}

// The default normalized record: every standard lead field under its own name.
export function defaultRecord(lead: any): Record<string, unknown> {
  const rec: Record<string, unknown> = {};
  for (const [k] of CRM_SOURCE_FIELDS) rec[k] = leadValue(lead, k);
  return rec;
}

// Map a lead to an outbound record. With a field map, produce { targetKey: value }
// using the mapped source fields; with an empty map, fall back to the default
// normalized record so an integration always sends something useful.
export function mapLeadToRecord(lead: any, fieldMap: unknown): Record<string, unknown> {
  const map = sanitizeFieldMap(fieldMap);
  const keys = Object.keys(map);
  if (!keys.length) return defaultRecord(lead);
  const rec: Record<string, unknown> = {};
  for (const target of keys) rec[target] = leadValue(lead, map[target]);
  return rec;
}

// The normalized JSON payload posted to a generic (Zapier/Make) endpoint.
export function buildCrmPayload(
  lead: any,
  ctx: { orgName?: string | null; rooftop?: string | null; sourceType: "card" | "asset"; sourceName?: string | null },
  fieldMap: unknown
): Record<string, unknown> {
  return {
    event: "lead.captured",
    capturedAt: (lead?.createdAt ? new Date(lead.createdAt) : new Date()).toISOString(),
    leadId: lead?.id ?? null,
    org: ctx.orgName ?? null,
    rooftop: ctx.rooftop ?? null,
    source: { type: ctx.sourceType, name: ctx.sourceName ?? null },
    record: mapLeadToRecord(lead, fieldMap),
  };
}

export type SyncStatus = "pending" | "sent" | "failed" | "dead";

// State machine: on success -> sent; on failure -> failed until attempts reach
// maxAttempts, then dead (dead-letter). `attempts` is the count AFTER this try.
export function nextSyncStatus(
  priorAttempts: number,
  ok: boolean,
  maxAttempts: number
): { status: SyncStatus; attempts: number } {
  const attempts = Math.max(0, priorAttempts) + 1;
  if (ok) return { status: "sent", attempts };
  const cap = Math.max(1, maxAttempts);
  return { status: attempts >= cap ? "dead" : "failed", attempts };
}

// Only "failed" logs are retryable; "dead" has exhausted attempts, "sent" is done.
export function isRetryable(status: string): boolean {
  return status === "failed";
}

// HTTP status counts as success only on 2xx.
export function httpOk(code: number | null | undefined): boolean {
  return typeof code === "number" && code >= 200 && code < 300;
}
