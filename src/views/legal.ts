// Public legal pages: Terms of Service (/terms) and Privacy Policy (/privacy).
// Rendered server-side with no dependencies. Bump the version constants when
// the text changes materially — signup records which version was accepted.
//
// NOTE: [PLACEHOLDERS] must be completed (entity name, state, contact email)
// and the documents reviewed by an attorney before relying on them.

import { page } from "./html";

export const TOS_VERSION = "2026-07-05";
export const PRIVACY_VERSION = "2026-07-05";

const LEGAL_CSS = `<style>
.legal{max-width:760px;margin:0 auto;padding:48px 24px 80px;line-height:1.7;color:#1f2937;font-size:15.5px}
.legal h1{font-size:30px;margin:0 0 4px;letter-spacing:-.01em}
.legal .vdate{color:#6b7280;font-size:13.5px;margin-bottom:32px}
.legal h2{font-size:19px;margin:34px 0 10px}
.legal p,.legal li{margin:0 0 12px}
.legal ul{padding-left:22px}
.legal .cap{text-transform:uppercase;font-size:13.5px;letter-spacing:.01em}
.legal a{color:#1F5BEA}
.legal .top{margin-bottom:28px}
.legal .top img{height:28px}
</style>`;

function legalPage(title: string, version: string, body: string): string {
  return page({
    title: `${title} — OpenCard`,
    head: LEGAL_CSS,
    body: `<div class="legal">
  <p class="top"><a href="/"><img src="/opencard-logo.svg" alt="OpenCard" /></a></p>
  <h1>${title}</h1>
  <p class="vdate">Last updated: ${version}</p>
  ${body}
</div>`,
  });
}

export function termsPage(): string {
  return legalPage("Terms of Service", TOS_VERSION, `
<p>These Terms of Service ("<strong>Terms</strong>") are a binding agreement between OpenCard [LEGAL ENTITY NAME TO BE COMPLETED] ("<strong>OpenCard</strong>", "we", "us") and the organization or individual creating an account or using the Service ("<strong>Customer</strong>", "you"). By creating an account, clicking to accept, or using the Service, you agree to these Terms. If you are accepting on behalf of an organization, you represent that you have authority to bind that organization.</p>

<h2>1. The Service</h2>
<p>OpenCard provides a hosted platform for digital business cards, QR/NFC assets, campaign links, lead capture, and related analytics and integrations (the "<strong>Service</strong>"). We may improve or modify the Service over time; we will not materially reduce its core functionality during a paid subscription term without notice.</p>

<h2>2. Accounts and eligibility</h2>
<ul>
<li>You must provide accurate registration information and keep it current.</li>
<li>You are responsible for all activity under your account and for safeguarding credentials, API keys, and provisioning tokens. Notify us promptly of any suspected unauthorized access.</li>
<li>The Service is offered to businesses and individuals aged 18 or older. It is not directed to children.</li>
</ul>

<h2>3. Subscriptions, billing, and trials</h2>
<ul>
<li>Paid plans are billed in advance on a recurring basis at the prices and limits shown at purchase. Taxes are your responsibility unless stated otherwise.</li>
<li>Trials and demo periods convert to inactive status unless a paid plan is selected. We may adjust pricing with at least 30 days' notice, effective at your next renewal.</li>
<li>Fees are non-refundable except where required by law. You may cancel at any time; the Service remains available through the end of the paid period.</li>
<li>We may suspend the Service for non-payment after reasonable notice.</li>
</ul>

<h2>4. Your content and data</h2>
<ul>
<li>"<strong>Customer Data</strong>" means content and data you or your users submit to the Service, including brand assets, employee card information, and captured leads. You own Customer Data. You grant us a non-exclusive license to host, process, display, and transmit Customer Data solely to provide and support the Service.</li>
<li>You are responsible for the accuracy and legality of Customer Data, including having a lawful basis and any required consents to (a) publish employee information on cards, (b) provision employee data from your directory, and (c) collect and process leads and their contact information.</li>
<li>You will not submit data that infringes third-party rights or violates law. We may remove content that we reasonably believe violates these Terms or applicable law.</li>
</ul>

<h2>5. Acceptable use</h2>
<p>You will not, and will not permit others to: (a) use the Service to send spam or unlawful communications; (b) upload malicious code or attempt to breach, probe, or overload the Service; (c) misrepresent identity or impersonate others on cards or assets; (d) resell or provide the Service to third parties except as intended for your own organization; (e) use the Service to collect data about individuals unlawfully; (f) reverse engineer the Service except where such restriction is prohibited by law; or (g) use the Service in violation of applicable export, sanctions, or anti-spam laws.</p>

<h2>6. Privacy</h2>
<p>Our <a href="/privacy">Privacy Policy</a> describes how we collect and process personal data, including approximate (city-level) location derived from IP addresses on card views, QR scans, and link clicks. You are responsible for providing any notices to, and obtaining any consents from, your employees and your own customers that applicable law requires for your use of these features.</p>

<h2>7. Third-party services</h2>
<p>The Service interoperates with third-party products (for example identity providers, CRM systems, payment processing, and wallet platforms). Your use of those products is governed by their terms, and we are not responsible for third-party products or for data once transmitted to them at your direction.</p>

<h2>8. Intellectual property</h2>
<p>We own the Service and all related software, designs, and documentation. No rights are granted except as expressly stated. Feedback you provide may be used by us without obligation.</p>

<h2>9. Confidentiality</h2>
<p>Each party will protect the other's non-public information with at least reasonable care and use it only as needed to perform under these Terms, except where disclosure is required by law.</p>

<h2>10. Termination and suspension</h2>
<ul>
<li>Either party may terminate for material breach not cured within 30 days of notice. We may suspend immediately for security risks, unlawful use, or non-payment.</li>
<li>Upon termination you may export Customer Data using the Service's export tools for 30 days, after which we may delete it in the ordinary course. Sections that by their nature should survive (including 8, 9, 11–14) survive termination.</li>
</ul>

<h2>11. Disclaimers</h2>
<p class="cap">The Service is provided "as is" and "as available." To the maximum extent permitted by law, we disclaim all warranties, express or implied, including merchantability, fitness for a particular purpose, non-infringement, and any warranty that the Service will be uninterrupted, error-free, or that QR codes, links, analytics, or location estimates will be accurate or available. No advice or information obtained from us creates any warranty.</p>

<h2>12. Limitation of liability</h2>
<p class="cap">To the maximum extent permitted by law: (a) neither party is liable for indirect, incidental, special, consequential, or punitive damages, or lost profits, revenue, data, or goodwill; and (b) each party's total aggregate liability arising out of or related to these Terms is limited to the amounts paid by Customer to OpenCard for the Service in the twelve (12) months preceding the event giving rise to liability (or one hundred U.S. dollars ($100) if no such amounts were paid). These limits do not apply to Customer's payment obligations, either party's indemnification obligations, or liability that cannot be limited by law.</p>

<h2>13. Indemnification</h2>
<p>You will defend and indemnify OpenCard against third-party claims arising from (a) Customer Data, including claims by your employees or lead contacts relating to data you collected or published through the Service; (b) your use of the Service in violation of these Terms or applicable law; or (c) disputes between you and your customers or employees. We will defend and indemnify you against third-party claims that the Service, as provided by us and used as permitted, infringes a U.S. patent, copyright, or trademark, with customary exclusions and remedies (including modifying or refunding the Service).</p>

<h2>14. Dispute resolution — arbitration and class action waiver</h2>
<p class="cap">Please read this section carefully — it affects your legal rights.</p>
<ul>
<li>Any dispute arising out of or relating to these Terms or the Service will be resolved by <strong>binding individual arbitration</strong> administered by the American Arbitration Association under its Commercial Arbitration Rules, rather than in court, except that either party may (a) bring an individual claim in small-claims court or (b) seek injunctive relief for infringement or misuse of intellectual property or confidential information.</li>
<li><strong>Class action waiver:</strong> disputes must be brought on an individual basis only. Neither party may participate in a class, consolidated, or representative action, and the arbitrator may not consolidate claims.</li>
<li>The arbitration will be conducted in English, seated in [COUNTY, STATE], with judgment on the award enforceable in any court of competent jurisdiction. Each party bears its own fees except as the applicable rules provide otherwise.</li>
<li><strong>Opt-out:</strong> you may opt out of this arbitration agreement by emailing [CONTACT EMAIL] within 30 days of first accepting these Terms.</li>
</ul>

<h2>15. Governing law</h2>
<p>These Terms are governed by the laws of the State of [STATE], excluding its conflict-of-laws rules. For matters not subject to arbitration, the state and federal courts located in [COUNTY, STATE] have exclusive jurisdiction, and the parties consent to personal jurisdiction there.</p>

<h2>16. Changes to these Terms</h2>
<p>We may update these Terms. For material changes we will provide notice (for example by email or in-product) at least 14 days before they take effect; continued use after the effective date constitutes acceptance. The "Last updated" date above reflects the current version.</p>

<h2>17. General</h2>
<p>These Terms are the entire agreement regarding the Service and supersede prior agreements on the subject. If any provision is unenforceable, the remainder stays in effect. Failure to enforce a provision is not a waiver. You may not assign these Terms without our consent, except to a successor in a merger or asset sale; we may assign to an affiliate or successor. Notices to us go to [CONTACT EMAIL]; notices to you go to your account email. The parties are independent contractors. There are no third-party beneficiaries.</p>

<p style="margin-top:28px;color:#6b7280;font-size:13.5px">Questions about these Terms: [CONTACT EMAIL]</p>
`);
}

export function privacyPage(): string {
  return legalPage("Privacy Policy", PRIVACY_VERSION, `
<p>This Privacy Policy explains how OpenCard [LEGAL ENTITY NAME TO BE COMPLETED] ("OpenCard", "we") collects, uses, and shares personal data when you use our website and the OpenCard service (the "Service").</p>

<h2>1. Data we collect</h2>
<ul>
<li><strong>Account data</strong> — name, work email, password hash, organization details you provide at signup or in admin settings.</li>
<li><strong>Card and directory data</strong> — information your organization publishes on digital cards (names, titles, photos, contact details), including data provisioned automatically from your identity provider (e.g. Azure AD / Entra via SCIM) at your organization's direction.</li>
<li><strong>Leads</strong> — contact details and messages that visitors choose to submit through lead-capture forms on cards and asset pages.</li>
<li><strong>Usage and device data</strong> — when a card, QR code, or campaign link is viewed or scanned we log the event with timestamp, user-agent, IP address, and an <strong>approximate, city-level location derived from the IP address</strong> using an offline lookup. We do not request or collect precise GPS location.</li>
<li><strong>Cookies</strong> — we use strictly necessary cookies for sign-in sessions and security. We do not use advertising cookies.</li>
<li><strong>Billing data</strong> — payment is processed by Stripe; we store subscription status and plan, not full card numbers.</li>
</ul>

<h2>2. How we use data</h2>
<p>We use data to provide and secure the Service; render cards and assets; deliver analytics and attribution to the organization that owns the card or asset; route and sync leads at the organization's direction; bill for subscriptions; communicate about the Service; and comply with law. We do not sell personal data and we do not use Customer Data for advertising.</p>

<h2>3. Roles</h2>
<p>For account data and website visits, OpenCard is a data controller. For card data, leads, and scan analytics processed on behalf of a customer organization, OpenCard acts as a processor/service provider and the organization is the controller — questions or requests about that data should be directed to the organization whose card or page you interacted with, and we will assist them in responding.</p>

<h2>4. Sharing</h2>
<p>We share data with service providers strictly to run the Service: hosting infrastructure, Stripe (payments), and email delivery providers. We share data with third parties you or your organization connect (for example a CRM such as Salesforce or HubSpot, identity providers, or wallet platforms) at your direction. We may disclose data to comply with law or protect rights, and in connection with a merger or acquisition with notice.</p>

<h2>5. Retention and deletion</h2>
<p>Account data is retained while the account is active. Organizations control retention of their leads and analytics (including automatic pruning settings) and can export or delete their data using built-in tools. After account termination we delete Customer Data in the ordinary course following the export window described in the Terms.</p>

<h2>6. Security</h2>
<p>We use industry-standard safeguards including TLS in transit, hashed passwords, role-based access controls, tenant isolation, and audit logging. No system is perfectly secure; we will notify affected parties of a breach as required by law.</p>

<h2>7. Your rights</h2>
<p>Depending on your location, you may have rights to access, correct, export, delete, or restrict processing of your personal data. Contact us at [CONTACT EMAIL] (or the organization that controls the data, per Section 3). We honor applicable rights under GDPR, CCPA/CPRA, and similar laws, and we do not discriminate for exercising them.</p>

<h2>8. Children</h2>
<p>The Service is not directed to children under 16 and we do not knowingly collect their data. If you believe a child's data was submitted, contact us for deletion.</p>

<h2>9. International transfers</h2>
<p>Data may be processed in the countries where we or our providers operate. Where required, we use appropriate safeguards for cross-border transfers.</p>

<h2>10. Changes and contact</h2>
<p>We will post updates here and note the date above; material changes will be notified to account owners. Contact: [CONTACT EMAIL] · [POSTAL ADDRESS].</p>
`);
}
