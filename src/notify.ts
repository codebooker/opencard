import nodemailer, { Transporter } from "nodemailer";
import { config, mailEnabled } from "./config";
import { resolveRecipients, buildLeadEmail } from "./routing";

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

// Fire-and-forget lead notification. `source` carries the loaded card (with dept
// + location) or asset (with location) used to resolve routing.
export function notifyLead(lead: any, source: { card?: any; asset?: any }): void {
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
