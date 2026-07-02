// Pure HubSpot mapping — no db/network. Turns a lead into HubSpot contact
// properties (default mapping or a custom field map), with the values coerced to
// the strings HubSpot's Contacts API expects. The dispatcher does the HTTP upsert.

import { sanitizeFieldMap } from "./crmsync";

export const HUBSPOT_BASE = "https://api.hubapi.com";
export const HUBSPOT_CONTACTS_URL = `${HUBSPOT_BASE}/crm/v3/objects/contacts`;

// URL to update a contact by email (idProperty=email), for the upsert fallback.
export function hubspotContactByEmailUrl(email: string): string {
  return `${HUBSPOT_CONTACTS_URL}/${encodeURIComponent(email)}?idProperty=email`;
}

// Split a full name into HubSpot's firstname / lastname. Last token is lastname.
export function splitName(full: string | null | undefined): { firstname?: string; lastname?: string } {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  if (parts.length === 1) return { firstname: parts[0] };
  return { firstname: parts.slice(0, -1).join(" "), lastname: parts[parts.length - 1] };
}

function toPropString(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// Build the HubSpot `properties` object from a lead. With a custom field map the
// target keys are HubSpot property names (firstname, phone, custom_prop, ...).
// With no map, use a sensible default contact mapping (name split into
// firstname/lastname, plus email/phone/company).
export function hubspotProperties(lead: any, fieldMap: unknown): Record<string, string> {
  const map = sanitizeFieldMap(fieldMap);
  const out: Record<string, string> = {};
  if (Object.keys(map).length) {
    for (const [target, src] of Object.entries(map)) {
      const s = toPropString(lead?.[src]);
      if (s !== null) out[target] = s;
    }
    return out;
  }
  const name = splitName(lead?.name);
  const defaults: Record<string, unknown> = {
    firstname: name.firstname,
    lastname: name.lastname,
    email: lead?.email,
    phone: lead?.phone,
    company: lead?.company,
  };
  for (const [k, v] of Object.entries(defaults)) {
    const s = toPropString(v);
    if (s !== null) out[k] = s;
  }
  return out;
}

// The email used to upsert (from mapped props or the raw lead). Null if none.
export function hubspotEmail(lead: any, props: Record<string, string>): string | null {
  return props.email || lead?.email || null;
}
