import nodemailer, { Transporter } from "nodemailer";
import { config, mailEnabled } from "./config";
import { resolveRecipients, buildLeadEmail } from "./routing";
import { prisma } from "./db";

// Lead notifications: resolve recipients via routing, then email them (or log the
// intended delivery when SMTP isn't configured). Never throws into the caller.

let transporter: Transporter | null = null;
function getTransport(): Transporter | null {
  if (!mailEnabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

// Generic mail send (reuses the transporter). Logs the intended delivery when
// SMTP isn't configured. Never throws.
export async function sendMail(to: string[], subject: string, text: string): Promise<{ delivered: string }> {
  try {
    if (!to.length) return { delivered: "none (no recipients)" };
    const t = getTransport();
    if (!t) {
      // Include the body so links (reset/verify/invite) are usable from logs in dev.
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ msg: "mail", to, subject, text, delivered: "logged (SMTP not configured)" }));
      return { delivered: "logged" };
    }
    await t.sendMail({ from: config.smtp.from, to: to.join(","), subject, text });
    return { delivered: "smtp" };
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ msg: "mail-error", error: String(e?.message || e).slice(0, 200) }));
    return { delivered: "error" };
  }
}

// POST a plain-text message to a Slack or Teams incoming webhook. Both accept
// { "text": "..." }. Never throws; 6s timeout. Exposed for the settings
// page's "Send test" button.
export async function postChatWebhook(url: string, text: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    if (!/^https:\/\//.test(url)) return { ok: false, error: "Webhook URL must be https." };
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(6000),
    });
    return resp.ok ? { ok: true, status: resp.status } : { ok: false, status: resp.status, error: `HTTP ${resp.status}` };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 150) };
  }
}

// One-line chat summary for a new lead.
export function leadChatText(lead: any, source: { card?: any; asset?: any }): string {
  const loc = source.card?.location || source.asset?.location;
  const who = [lead.name, lead.phone, lead.email].filter(Boolean).join(" · ") || "Anonymous";
  const via = source.card
    ? `${source.card.firstName || ""} ${source.card.lastName || ""}`.trim() + "'s card"
    : "a QR asset";
  const extras = [lead.vehicleInterest, lead.serviceNeed, lead.campaign || lead.utmCampaign].filter(Boolean).join(" · ");
  return `🪪 New lead: ${who} — via ${via}${loc?.name ? ` at ${loc.name}` : ""}${extras ? ` (${extras})` : ""}\n${config.baseUrl}/admin/leads`;
}

// Fire-and-forget lead notification. `source` carries the loaded card (with dept
// + location) or asset (with location) used to resolve routing.
export function notifyLead(lead: any, source: { card?: any; asset?: any }): void {
  // Chat webhook (Slack/Teams) alongside email — independent failure domains.
  (async () => {
    try {
      const orgId = lead.orgId || source.card?.orgId || source.asset?.orgId;
      if (!orgId) return;
      const org = await prisma.org.findUnique({ where: { id: orgId }, select: { leadWebhookUrl: true } });
      if (!org?.leadWebhookUrl) return;
      const r = await postChatWebhook(org.leadWebhookUrl, leadChatText(lead, source));
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ msg: "lead-chat-webhook", leadId: lead.id, delivered: r.ok ? "webhook" : `failed (${r.error})` }));
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ msg: "lead-chat-webhook-error", error: String(e?.message || e).slice(0, 200) }));
    }
  })();
  (async () => {
    try {
      const loc = source.card?.location || source.asset?.location;
      const recipients = resolveRecipients({
        ownerEmail: source.card?.ownerEmail,
        departmentEmail: source.card?.dept?.leadEmail,
        rooftopEmail: loc?.leadEmail,
        campaign: lead.campaign,
        campaignRouting: loc?.campaignRouting,
      });
      const base = { msg: "lead-notify", leadId: lead.id, recipients, source: source.card ? "card" : "asset" };
      if (!recipients.length) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ...base, delivered: "none (no recipients configured)" }));
        return;
      }
      const { subject, text } = buildLeadEmail(lead, source);
      const t = getTransport();
      if (!t) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ...base, subject, delivered: "logged (SMTP not configured)" }));
        return;
      }
      await t.sendMail({ from: config.smtp.from, to: recipients.join(","), subject, text });
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ...base, subject, delivered: "smtp" }));
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ msg: "lead-notify-error", error: String(e?.message || e).slice(0, 200) }));
    }
  })();
}
