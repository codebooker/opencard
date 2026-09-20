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
    <label for="lead-name">Your name</label><input id="lead-name" name="name" autocomplete="name" required />
    ${has("email") ? `<label for="lead-email">Email</label><input id="lead-email" name="email" type="email" autocomplete="email" />` : ""}
    ${has("phone") ? `<label for="lead-phone">Phone</label><input id="lead-phone" name="phone" type="tel" autocomplete="tel" />` : ""}
    ${has("company") ? `<label for="lead-company">Company</label><input id="lead-company" name="company" autocomplete="organization" />` : ""}
    ${
      has("preferredContact")
        ? `<label for="lead-preferred">Preferred contact method</label><select id="lead-preferred" name="preferredContact"><option value="">Choose a method…</option>${PREFERRED_CONTACTS.map(
            ([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`
          ).join("")}</select>`
        : ""
    }
    ${has("vehicleInterest") ? `<label for="lead-vehicle">Vehicle of interest</label><input id="lead-vehicle" name="vehicleInterest" placeholder="Year, make, and model" />` : ""}
    ${has("tradeIn") ? `<label class="chk-inline"><input type="checkbox" name="tradeIn" value="1" /> I have a trade-in</label>` : ""}
    ${has("serviceNeed") ? `<label for="lead-service">Service need <span>(optional)</span></label><input id="lead-service" name="serviceNeed" />` : ""}
    ${
      has("appointmentRequest")
        ? `<label class="chk-inline"><input type="checkbox" name="appointmentRequest" value="1" /> I'd like to book an appointment</label>`
        : ""
    }
    ${has("note") ? `<label for="lead-note">Note <span>(optional)</span></label><textarea id="lead-note" name="note"></textarea>` : ""}
    ${
      has("consent")
        ? `<label class="chk-inline"><input type="checkbox" name="consent" value="1" required /> ${esc(opts.consentText)}</label>`
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
