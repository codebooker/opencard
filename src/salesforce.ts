// Pure Salesforce Web-to-Lead mapping — no db/network. Web-to-Lead is the
// low-friction path: form-encode the lead + the org's `oid` and POST it to
// Salesforce, which creates a Lead. No OAuth. The dispatcher does the HTTP POST.

import { sanitizeFieldMap, splitName } from "./crmsync";

export const SALESFORCE_WEBTOLEAD_URL = "https://webto.salesforce.com/servlet/servlet.WebToLead?encoding=UTF-8";

function toStr(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// Build the Web-to-Lead field set from a lead. With a custom map the target keys
// are Salesforce Web-to-Lead field names (first_name, last_name, email, phone,
// company, or a custom field id like 00N...). With no map, use standard fields.
export function salesforceFields(lead: any, fieldMap: unknown): Record<string, string> {
  const map = sanitizeFieldMap(fieldMap);
  const out: Record<string, string> = {};
  if (Object.keys(map).length) {
    for (const [target, src] of Object.entries(map)) {
      const s = toStr(lead?.[src]);
      if (s !== null) out[target] = s;
    }
    return out;
  }
  const name = splitName(lead?.name);
  const defaults: Record<string, unknown> = {
    first_name: name.firstname,
    // Salesforce requires last_name + company on a Lead; fall back to the full
    // name / a placeholder company so the Lead isn't rejected outright.
    last_name: name.lastname || name.firstname || lead?.name,
    email: lead?.email,
    phone: lead?.phone,
    company: lead?.company || "Unknown",
  };
  for (const [k, v] of Object.entries(defaults)) {
    const s = toStr(v);
    if (s !== null) out[k] = s;
  }
  return out;
}

// URL-encode the oid + mapped fields into a Web-to-Lead form body.
export function salesforceBody(lead: any, oid: string, fieldMap: unknown): string {
  const params = new URLSearchParams();
  params.set("oid", String(oid));
  for (const [k, v] of Object.entries(salesforceFields(lead, fieldMap))) params.set(k, v);
  return params.toString();
}

// The submission URL — an explicit override (e.g. a sandbox host), else the
// standard production Web-to-Lead endpoint.
export function salesforceUrl(override?: string | null): string {
  const o = (override || "").trim();
  return o || SALESFORCE_WEBTOLEAD_URL;
}
