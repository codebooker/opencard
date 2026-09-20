import { asStringArray } from "./roletemplate";
import { parseUtm, deviceFromUa, normalizePreferredContact, cleanReferrer } from "./attribution";
import { VERTICAL_PACKS, packFor } from "./verticals";

// Pure lead-form helpers — no db/express, unit-testable. `assembleLead` takes the
// raw form body + user-agent; the route adds cardId/assetId/orgId.

// Configurable optional lead-form fields (name is always required + shown).
export const LEAD_FIELDS: [string, string][] = [
  ["email", "Email"],
  ["phone", "Phone"],
  ["company", "Company"],
  ["preferredContact", "Preferred contact method"],
  ["vehicleInterest", "Vehicle of interest"],
  ["tradeIn", "Trade-in checkbox"],
  ["serviceNeed", "Service need"],
  ["appointmentRequest", "Appointment request checkbox"],
  ["note", "Note"],
  ["consent", "Consent checkbox"],
];

export const DEFAULT_LEAD_FIELDS = ["email", "phone", "vehicleInterest", "note", "consent"];
export const DEFAULT_CONSENT_TEXT = "I agree to be contacted about my inquiry.";

// Vertical-specific behavior comes from the pack registry (verticals.ts):
// each pack claims its own field keys from the catalog above and defines its
// default set. Kept exports below preserve existing call sites/tests.
export const DEALERSHIP_LEAD_FIELDS = packFor("dealership").extraLeadFieldKeys;
export const GENERAL_DEFAULT_LEAD_FIELDS = packFor("general").defaultLeadFields;

// Fields claimed by ANY pack are hidden from every other pack.
const packOwnedKeys = new Set(VERTICAL_PACKS.flatMap((p) => p.extraLeadFieldKeys));

// The lead-form field choices an admin may enable, per vertical: the common
// catalog plus the pack's own fields, in catalog order.
export function leadFieldChoicesFor(vertical?: string | null): [string, string][] {
  const own = new Set(packFor(vertical).extraLeadFieldKeys);
  return LEAD_FIELDS.filter(([k]) => !packOwnedKeys.has(k) || own.has(k));
}

// The built-in default field set, per vertical.
export function defaultLeadFieldsFor(vertical?: string | null): string[] {
  return packFor(vertical).defaultLeadFields;
}

// Which fields to show: template override -> brand default -> built-in defaults.
// null/undefined = inherit; an explicit array (even empty) is used as-is.
export function resolveLeadFields(
  templateFields: unknown,
  brandFields: unknown,
  defaults: string[] = DEFAULT_LEAD_FIELDS
): string[] {
  if (Array.isArray(templateFields)) return asStringArray(templateFields);
  if (Array.isArray(brandFields)) return asStringArray(brandFields);
  return defaults;
}

export function resolveConsentText(
  templateText: string | null | undefined,
  brandText: string | null | undefined,
  def: string = DEFAULT_CONSENT_TEXT
): string {
  return (templateText && templateText.trim()) || (brandText && brandText.trim()) || def;
}

// Assemble a lead's data (all fields + attribution) from a submitted form body.
export function assembleLead(body: Record<string, any>, userAgent: string | null | undefined) {
  const str = (v: any, n: number) => {
    const value = v == null ? "" : String(v).trim();
    return value ? value.slice(0, n) : null;
  };
  const utm = parseUtm(body);
  return {
    name: String(body?.name || "").trim().slice(0, 200),
    email: str(body?.email, 200),
    phone: str(body?.phone, 60),
    company: str(body?.company, 200),
    note: str(body?.note, 1000),
    preferredContact: normalizePreferredContact(body?.preferredContact),
    vehicleInterest: str(body?.vehicleInterest, 200),
    tradeIn: body?.tradeIn === "1",
    serviceNeed: str(body?.serviceNeed, 200),
    appointmentRequest: body?.appointmentRequest === "1",
    consent: body?.consent === "1",
    campaign: utm.campaign,
    utmSource: utm.utmSource,
    utmMedium: utm.utmMedium,
    utmCampaign: utm.utmCampaign,
    referrer: cleanReferrer(body?.referrer),
    device: deviceFromUa(userAgent),
  };
}

export function leadSubmissionError(body: Record<string, any>, fields: string[] = []): string | null {
  const name = String(body?.name || "").trim();
  if (!name) return "Name required";
  const email = String(body?.email || "").trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "Enter a valid email address";
  if (fields.includes("consent") && body?.consent !== "1") return "Consent is required";
  return null;
}
