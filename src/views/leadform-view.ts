import { esc } from "./html";
import { PREFERRED_CONTACTS } from "../attribution";

export type LeadAttribution = {
  campaign?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
};

// Render the lead-capture <form>, showing only the configured fields. Used by
// both the card page and asset landing pages. UTM is carried as hidden inputs;
// the referrer input is filled client-side (see the .lead-ref script).
export function renderLeadForm(opts: {
  action: string;
  fields: Set<string>;
  consentText: string;
  attribution: LeadAttribution;
}): string {
  const has = (f: string) => opts.fields.has(f);
  const a = opts.attribution;
  return `<form method="POST" action="${esc(opts.action)}">
    <input name="name" placeholder="Your name" required />
    ${has("email") ? `<input name="email" type="email" placeholder="Email" />` : ""}
    ${has("phone") ? `<input name="phone" placeholder="Phone" />` : ""}
    ${has("company") ? `<input name="company" placeholder="Company" />` : ""}
    ${
      has("preferredContact")
        ? `<select name="preferredContact"><option value="">Preferred contact…</option>${PREFERRED_CONTACTS.map(
            ([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`
          ).join("")}</select>`
        : ""
    }
    ${has("vehicleInterest") ? `<input name="vehicleInterest" placeholder="Vehicle of interest (year/make/model)" />` : ""}
    ${has("tradeIn") ? `<label class="chk-inline"><input type="checkbox" name="tradeIn" value="1" /> I have a trade-in</label>` : ""}
    ${has("serviceNeed") ? `<input name="serviceNeed" placeholder="Service need (optional)" />` : ""}
    ${
      has("appointmentRequest")
        ? `<label class="chk-inline"><input type="checkbox" name="appointmentRequest" value="1" /> I'd like to book an appointment</label>`
        : ""
    }
    ${has("note") ? `<textarea name="note" placeholder="Note (optional)"></textarea>` : ""}
    ${
      has("consent")
        ? `<label class="chk-inline"><input type="checkbox" name="consent" value="1" /> ${esc(opts.consentText)}</label>`
        : ""
    }
    <input type="hidden" name="campaign" value="${esc(a.campaign)}" />
    <input type="hidden" name="utm_source" value="${esc(a.utmSource)}" />
    <input type="hidden" name="utm_medium" value="${esc(a.utmMedium)}" />
    <input type="hidden" name="utm_campaign" value="${esc(a.utmCampaign)}" />
    <input type="hidden" name="referrer" class="lead-ref" value="" />
    <button type="submit">Send my details</button>
  </form>`;
}

// Small script that fills every .lead-ref hidden input with document.referrer.
export const leadRefScript = `<script>try{document.querySelectorAll('.lead-ref').forEach(function(e){e.value=document.referrer||'';});}catch(e){}</script>`;
