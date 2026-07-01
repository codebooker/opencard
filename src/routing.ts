// Pure lead-routing helpers — no db/config, unit-testable in isolation.

export function isValidEmail(s: string | null | undefined): boolean {
  const t = (s || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

// A stored campaign->email map, validated.
export function parseCampaignRouting(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const email = String(val ?? "").trim();
      if (k && isValidEmail(email)) out[k.trim().toLowerCase()] = email;
    }
  }
  return out;
}

// Parse the admin textarea ("campaign | email" per line) into the routing map.
export function parseCampaignRoutingLines(text: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of (text || "").split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    const i = s.indexOf("|");
    if (i < 0) continue;
    const camp = s.slice(0, i).trim().toLowerCase();
    const email = s.slice(i + 1).trim();
    if (camp && isValidEmail(email)) out[camp] = email;
  }
  return out;
}

// Serialize a stored routing map back to editable lines.
export function campaignRoutingToLines(v: unknown): string {
  return Object.entries(parseCampaignRouting(v))
    .map(([k, e]) => `${k} | ${e}`)
    .join("\n");
}

export type RoutingContext = {
  ownerEmail?: string | null;
  departmentEmail?: string | null;
  rooftopEmail?: string | null;
  campaign?: string | null;
  campaignRouting?: unknown;
  fallbackEmail?: string | null;
};

// Resolve the recipient set for a lead: card owner + department inbox + rooftop
// inbox + any campaign-matched address, validated + de-duped (case-insensitive),
// in that priority order. Falls back to `fallbackEmail` if nothing else resolves.
export function resolveRecipients(ctx: RoutingContext): string[] {
  const candidates: Array<string | null | undefined> = [ctx.ownerEmail, ctx.departmentEmail, ctx.rooftopEmail];
  const map = parseCampaignRouting(ctx.campaignRouting);
  if (ctx.campaign) {
    const hit = map[ctx.campaign.trim().toLowerCase()];
    if (hit) candidates.push(hit);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const trimmed = (c || "").trim();
    const key = trimmed.toLowerCase();
    if (trimmed && isValidEmail(trimmed) && !seen.has(key)) {
      seen.add(key);
      out.push(trimmed);
    }
  }
  if (!out.length && ctx.fallbackEmail && isValidEmail(ctx.fallbackEmail)) out.push(ctx.fallbackEmail.trim());
  return out;
}

// Build the notification email content for a lead (pure).
export function buildLeadEmail(lead: any, source: { card?: any; asset?: any }): { subject: string; text: string } {
  const fromName = source.card
    ? [source.card.firstName, source.card.lastName].filter(Boolean).join(" ")
    : source.asset?.name || "dealership";
  const interest = lead.vehicleInterest || lead.serviceNeed || "inquiry";
  const subject = `New lead: ${lead.name} — ${interest}`;
  const sourceLine =
    [lead.campaign, lead.utmSource, lead.device].filter(Boolean).join(" · ") || lead.device || "unknown";
  const lines = [
    `New lead via ${source.card ? "card" : "asset"} (${fromName}).`,
    ``,
    `Name: ${lead.name}`,
    lead.email ? `Email: ${lead.email}` : null,
    lead.phone ? `Phone: ${lead.phone}` : null,
    lead.preferredContact ? `Preferred contact: ${lead.preferredContact}` : null,
    lead.vehicleInterest ? `Vehicle interest: ${lead.vehicleInterest}` : null,
    lead.tradeIn ? `Trade-in: yes` : null,
    lead.serviceNeed ? `Service need: ${lead.serviceNeed}` : null,
    lead.appointmentRequest ? `Appointment requested: yes` : null,
    lead.note ? `Note: ${lead.note}` : null,
    `Consent: ${lead.consent ? "given" : "not given"}`,
    ``,
    `Source: ${sourceLine}`,
    lead.referrer ? `Referrer: ${lead.referrer}` : null,
  ].filter((x): x is string => x !== null);
  return { subject, text: lines.join("\n") };
}
