// Public marketing landing page, served at the platform root (unregistered
// hosts). Self-contained: its own inline styles, no dependency on the admin
// stylesheet. The only external script is the UserWay accessibility widget.

import { userwayScript } from "./html";

const CSS = `
:root{
  --blue:#1F5BEA; --cyan:#18AEE0; --teal:#25D1B3;
  --ink:#0e1526; --body:#3d4557; --muted:#6b7280;
  --line:#e7eaf0; --wash:#f6f8fb; --paper:#ffffff;
  --grad:linear-gradient(100deg,var(--blue),var(--cyan) 55%,var(--teal));
  --radius:16px;
  --shadow:0 1px 2px rgba(14,21,38,.05),0 12px 32px -12px rgba(14,21,38,.12);
  --shadow-lg:0 2px 4px rgba(14,21,38,.06),0 32px 64px -24px rgba(31,91,234,.25);
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Helvetica,Arial,sans-serif;
  color:var(--body);background:var(--paper);
  -webkit-font-smoothing:antialiased;line-height:1.6;
}
h1,h2,h3{color:var(--ink);line-height:1.15;letter-spacing:-.02em;font-weight:750}
a{color:inherit;text-decoration:none}
img{display:block}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}

/* ---- nav ---- */
.nav{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.85);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.nav-in{display:flex;align-items:center;gap:28px;height:64px}
.nav-logo img{height:30px;width:auto}
.nav-links{display:flex;gap:26px;font-size:14.5px;font-weight:500;color:var(--muted)}
.nav-links a:hover{color:var(--ink)}
.nav-cta{margin-left:auto;display:flex;align-items:center;gap:16px;font-size:14.5px;font-weight:500}
.nav-cta .signin:hover{color:var(--ink)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:10px;font-weight:600;cursor:pointer;transition:all .15s ease;border:0}
.btn-primary{background:var(--grad);color:#fff;padding:10px 20px;font-size:14.5px;box-shadow:0 4px 14px -4px rgba(31,91,234,.5)}
.btn-primary:hover{filter:brightness(1.06);transform:translateY(-1px)}
.btn-ghost{padding:10px 20px;font-size:14.5px;color:var(--ink);border:1px solid var(--line);background:#fff}
.btn-ghost:hover{border-color:#c9d1de;background:var(--wash)}
.btn-lg{padding:14px 28px;font-size:16px;border-radius:12px}

/* ---- hero ---- */
.hero{position:relative;overflow:hidden;padding:88px 0 96px;
  background:
    radial-gradient(52rem 30rem at 82% -6rem,rgba(37,209,179,.14),transparent 60%),
    radial-gradient(48rem 30rem at 12% -8rem,rgba(31,91,234,.12),transparent 60%),
    var(--paper);}
.hero-in{display:grid;grid-template-columns:1.05fr .95fr;gap:64px;align-items:center}
.pill{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--blue);
  background:rgba(31,91,234,.08);border:1px solid rgba(31,91,234,.18);border-radius:999px;padding:6px 14px;margin-bottom:22px}
.pill .dot{width:7px;height:7px;border-radius:50%;background:var(--teal)}
.hero h1{font-size:clamp(36px,4.6vw,56px);margin-bottom:20px}
.hero h1 .grad{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p.lede{font-size:19px;color:var(--body);max-width:34em;margin-bottom:32px}
.hero-ctas{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:26px}
.hero-note{font-size:13.5px;color:var(--muted)}

/* phone mockup */
.stage{position:relative;display:flex;justify-content:center}
.phone{width:300px;background:#0e1526;border-radius:38px;padding:12px;box-shadow:var(--shadow-lg)}
.screen{background:#fff;border-radius:28px;overflow:hidden}
.card-hero{background:var(--grad);padding:26px 22px 44px;color:#fff;position:relative}
.card-hero .co{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;opacity:.85}
.avatar{width:74px;height:74px;border-radius:50%;background:#fff;border:3px solid #fff;position:absolute;left:22px;bottom:-37px;overflow:hidden;box-shadow:0 6px 16px rgba(14,21,38,.18)}
.avatar div{width:100%;height:100%;background:linear-gradient(135deg,#dbe4f8,#c3f2e8);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--blue);font-size:24px}
.card-body{padding:48px 22px 22px}
.card-body .nm{font-size:19px;font-weight:700;color:var(--ink)}
.card-body .tt{font-size:13px;color:var(--muted);margin-bottom:14px}
.chiprow{display:flex;gap:8px;margin-bottom:16px}
.chip{font-size:11px;font-weight:600;padding:5px 10px;border-radius:999px;background:var(--wash);border:1px solid var(--line);color:var(--body)}
.act{display:flex;gap:10px}
.act .a1{flex:1;text-align:center;font-size:13px;font-weight:600;padding:11px 0;border-radius:10px;background:var(--grad);color:#fff}
.act .a2{flex:1;text-align:center;font-size:13px;font-weight:600;padding:11px 0;border-radius:10px;border:1px solid var(--line);color:var(--ink)}
.float{position:absolute;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:12px 16px;font-size:12.5px}
.float b{display:block;color:var(--ink);font-size:13px}
.f1{top:-14px;right:-4px}
.f2{bottom:-18px;left:-10px}
.f1 .up{color:#0a9e7c;font-weight:700}
.qr{width:34px;height:34px;border-radius:8px;background:
  conic-gradient(var(--ink) 25%,transparent 0 50%,var(--ink) 0 75%,transparent 0);
  background-size:12px 12px;opacity:.9}

/* ---- verticals strip ---- */
.strip{border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--wash);padding:22px 0}
.strip-in{display:flex;align-items:center;justify-content:center;gap:14px 34px;flex-wrap:wrap;font-size:13.5px;font-weight:600;color:var(--muted)}
.strip-in span.lb{font-weight:500;color:#9aa1ad}

/* ---- sections ---- */
section.block{padding:96px 0}
.kicker{font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:12px}
h2.title{font-size:clamp(28px,3.4vw,40px);margin-bottom:14px;max-width:22em}
p.sub{font-size:17px;color:var(--body);max-width:38em;margin-bottom:52px}
.center{text-align:center}
.center h2.title,.center p.sub{margin-left:auto;margin-right:auto}

/* features */
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
.feat{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);padding:28px;transition:all .18s ease}
.feat:hover{box-shadow:var(--shadow);transform:translateY(-3px);border-color:#d8dfea}
.ico{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:18px;background:linear-gradient(135deg,rgba(31,91,234,.1),rgba(37,209,179,.12))}
.ico svg{width:22px;height:22px;stroke:var(--blue);fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.feat h3{font-size:17px;margin-bottom:8px}
.feat p{font-size:14.5px;color:var(--body)}

/* how it works */
.how{background:var(--wash);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;counter-reset:step}
.step{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:30px;position:relative}
.step .num{width:34px;height:34px;border-radius:10px;background:var(--grad);color:#fff;font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:center;margin-bottom:18px}
.step h3{font-size:17px;margin-bottom:8px}
.step p{font-size:14.5px}

/* integrations */
.intg{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.intg .it{display:flex;align-items:center;gap:14px;border:1px solid var(--line);border-radius:14px;padding:18px 20px;background:#fff;transition:all .15s ease}
.intg .it:hover{box-shadow:var(--shadow)}
.intg .it .lg{width:38px;height:38px;border-radius:10px;background:var(--wash);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;color:var(--blue);flex:none}
.intg .it b{display:block;font-size:14.5px;color:var(--ink)}
.intg .it span{font-size:12.5px;color:var(--muted)}

/* pricing */
.plans{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;align-items:stretch}
.plan{border:1px solid var(--line);border-radius:var(--radius);padding:26px;background:#fff;display:flex;flex-direction:column}
.plan.hot{border:2px solid transparent;background:
  linear-gradient(#fff,#fff) padding-box, var(--grad) border-box;box-shadow:var(--shadow-lg)}
.plan .pn{font-size:15px;font-weight:700;color:var(--ink)}
.plan .badge{float:right;font-size:11px;font-weight:700;color:#fff;background:var(--grad);border-radius:999px;padding:3px 10px}
.plan .pp{font-size:30px;font-weight:750;color:var(--ink);margin:10px 0 2px;letter-spacing:-.02em}
.plan .pp small{font-size:14px;font-weight:500;color:var(--muted)}
.plan .pd{font-size:13px;color:var(--muted);margin-bottom:18px}
.plan ul{list-style:none;font-size:13.5px;display:grid;gap:9px;margin-bottom:22px}
.plan li{padding-left:24px;position:relative}
.plan li::before{content:"";position:absolute;left:0;top:5px;width:14px;height:14px;border-radius:50%;
  background:linear-gradient(135deg,rgba(31,91,234,.15),rgba(37,209,179,.2))}
.plan li::after{content:"";position:absolute;left:4px;top:9px;width:6px;height:3.5px;border-left:1.8px solid var(--blue);border-bottom:1.8px solid var(--blue);transform:rotate(-45deg)}
.plan .btn{margin-top:auto;width:100%}

/* security band */
.sec{background:var(--ink);color:#c6cddc;border-radius:24px;padding:56px;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.sec h2{color:#fff;font-size:clamp(24px,3vw,34px);margin-bottom:14px}
.sec p{font-size:15.5px;max-width:32em}
.sec ul{list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:14px;font-size:14.5px}
.sec li{padding-left:26px;position:relative;color:#e7ebf4}
.sec li::before{content:"";position:absolute;left:0;top:5px;width:15px;height:15px;border-radius:50%;background:linear-gradient(135deg,var(--cyan),var(--teal))}
.sec li::after{content:"";position:absolute;left:4.5px;top:9.5px;width:6px;height:3.5px;border-left:1.8px solid #06121f;border-bottom:1.8px solid #06121f;transform:rotate(-45deg)}

/* final cta */
.cta{padding:110px 0;text-align:center;background:
  radial-gradient(40rem 22rem at 50% 120%,rgba(31,91,234,.10),transparent 65%)}
.cta h2{font-size:clamp(30px,3.8vw,44px);margin-bottom:16px}
.cta p{font-size:17px;color:var(--body);margin-bottom:34px}
.cta .row{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}

/* footer */
footer{border-top:1px solid var(--line);padding:36px 0;background:var(--wash)}
.foot{display:flex;align-items:center;gap:24px;font-size:13.5px;color:var(--muted);flex-wrap:wrap}
.foot img{height:24px;width:auto;opacity:.9}
.foot .sp{margin-left:auto;display:flex;gap:22px}
.foot a:hover{color:var(--ink)}

@media(max-width:960px){
  .hero-in{grid-template-columns:1fr;gap:56px}
  .grid3,.steps,.intg{grid-template-columns:1fr 1fr}
  .plans{grid-template-columns:1fr 1fr}
  .sec{grid-template-columns:1fr;padding:40px 28px}
  .nav-links{display:none}
}
@media(max-width:600px){
  .grid3,.steps,.intg,.plans{grid-template-columns:1fr}
  section.block{padding:64px 0}
  .hero{padding:56px 0 64px}
  .f2{left:0}.f1{right:0}
}
`;

// Minimal inline icon set (stroke style, inherits .ico svg rules).
const I = {
  brand: `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/></svg>`,
  qr: `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M20 20v.01M17 20v.01M20 17h.01"/></svg>`,
  lead: `<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>`,
  sync: `<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`,
  chart: `<svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>`,
  plug: `<svg viewBox="0 0 24 24"><path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0V7z"/><path d="M12 16v5"/></svg>`,
};

export function marketingPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>OpenCard — Brand-controlled digital business cards for multi-location teams</title>
<meta name="description" content="Digital business cards that stay on brand across every location. Auto-provision from your directory, capture leads with QR codes, and sync attribution to your CRM." />
<link rel="icon" type="image/svg+xml" href="/opencard-icon.svg" />
<style>${CSS}</style>
</head>
<body>

<nav class="nav">
  <div class="wrap nav-in">
    <a class="nav-logo" href="/"><img src="/opencard-logo.svg" alt="OpenCard" /></a>
    <div class="nav-links">
      <a href="#features">Features</a>
      <a href="#how">How it works</a>
      <a href="#integrations">Integrations</a>
      <a href="#pricing">Pricing</a>
    </div>
    <div class="nav-cta">
      <a class="signin" href="/admin/login">Sign in</a>
      <a class="btn btn-primary" href="/signup">Get started</a>
    </div>
  </div>
</nav>

<header class="hero">
  <div class="wrap hero-in">
    <div>
      <span class="pill"><span class="dot"></span>Built for multi-location teams</span>
      <h1>Every employee on brand.<br/><span class="grad">Every handshake tracked.</span></h1>
      <p class="lede">OpenCard gives your whole organization digital business cards that inherit each brand and location's identity — provisioned automatically from your directory, with QR lead capture and attribution your managers can actually use.</p>
      <div class="hero-ctas">
        <a class="btn btn-primary btn-lg" href="/signup">Get started</a>
        <a class="btn btn-ghost btn-lg" href="#how">See how it works</a>
      </div>
      <p class="hero-note">Plans from $4.99/mo &nbsp;·&nbsp; SSO &amp; SCIM ready &nbsp;·&nbsp; Cancel anytime</p>
    </div>
    <div class="stage">
      <div class="phone">
        <div class="screen">
          <div class="card-hero">
            <div class="co">Meridian Group · Downtown</div>
            <div class="avatar"><div>JC</div></div>
          </div>
          <div class="card-body">
            <div class="nm">James Chen</div>
            <div class="tt">Senior Sales Advisor</div>
            <div class="chiprow"><span class="chip">Call</span><span class="chip">Email</span><span class="chip">vCard</span></div>
            <div class="act"><span class="a1">Save contact</span><span class="a2">Send info</span></div>
          </div>
        </div>
      </div>
      <div class="float f1"><b>238 scans this week</b><span class="up">↑ 24%</span> vs last week</div>
      <div class="float f2" style="display:flex;gap:12px;align-items:center"><span class="qr"></span><span><b>New lead captured</b>routed to CRM</span></div>
    </div>
  </div>
</header>

<div class="strip">
  <div class="wrap strip-in">
    <span class="lb">Made for teams like</span>
    <span>Dealer groups</span><span>Franchises</span><span>Real estate brokerages</span>
    <span>Insurance agencies</span><span>Clinics</span><span>Field sales</span>
  </div>
</div>

<section class="block" id="features">
  <div class="wrap">
    <div class="kicker">Features</div>
    <h2 class="title">The card is the front door. The system behind it is the point.</h2>
    <p class="sub">Brand governance, automatic provisioning, and lead attribution — everything a distributed organization needs beyond a pretty card.</p>
    <div class="grid3">
      <div class="feat"><div class="ico">${I.brand}</div>
        <h3>Brand-controlled design</h3>
        <p>Logos, colors, and layouts cascade from brand → location → card. Central teams set the rules; every card stays on brand without anyone policing it.</p></div>
      <div class="feat"><div class="ico">${I.sync}</div>
        <h3>Automatic provisioning</h3>
        <p>Connect Azure AD / Entra via SCIM and cards create themselves when employees join — and deactivate the day they leave. Turnover handled.</p></div>
      <div class="feat"><div class="ico">${I.qr}</div>
        <h3>QR, vCard &amp; wallet sharing</h3>
        <p>Every card ships with a QR code, one-tap Add to Contacts, email signatures, and wallet passes. Share anywhere a customer can point a camera.</p></div>
      <div class="feat"><div class="ico">${I.lead}</div>
        <h3>Two-way lead capture</h3>
        <p>Visitors don't just take a contact — they leave one. Capture forms turn scans into named leads with full source context attached.</p></div>
      <div class="feat"><div class="ico">${I.chart}</div>
        <h3>Attribution &amp; analytics</h3>
        <p>Views, saves, clicks, and leads rolled up by person, location, campaign, and source. Managers finally see which handshakes turn into business.</p></div>
      <div class="feat"><div class="ico">${I.plug}</div>
        <h3>CRM sync, API &amp; webhooks</h3>
        <p>Push leads to Salesforce or HubSpot, subscribe to webhook events, or build on the REST API. Your data flows where your team already works.</p></div>
    </div>
  </div>
</section>

<section class="block how" id="how">
  <div class="wrap">
    <div class="center">
      <div class="kicker">How it works</div>
      <h2 class="title">Live in an afternoon, not a quarter</h2>
      <p class="sub">Three steps from zero to every employee carrying a tracked, on-brand card.</p>
    </div>
    <div class="steps">
      <div class="step"><div class="num">1</div>
        <h3>Set up brands &amp; locations</h3>
        <p>Add each brand and location with its logo, colors, and layout. Design defaults cascade down, so you configure once — not per card.</p></div>
      <div class="step"><div class="num">2</div>
        <h3>Connect your directory</h3>
        <p>Point Azure AD / Entra provisioning at OpenCard's SCIM endpoint. Employees are matched to the right location and their cards appear automatically.</p></div>
      <div class="step"><div class="num">3</div>
        <h3>Share, capture, measure</h3>
        <p>Teams share via QR, NFC, and email signatures. Every scan and lead lands in your analytics — and flows on to your CRM.</p></div>
    </div>
  </div>
</section>

<section class="block" id="integrations">
  <div class="wrap">
    <div class="center">
      <div class="kicker">Integrations</div>
      <h2 class="title">Plays nicely with your stack</h2>
      <p class="sub">Identity, CRM, and everything in between — no rip-and-replace required.</p>
    </div>
    <div class="intg">
      <div class="it"><span class="lg">Az</span><span><b>Azure AD / Entra</b><span>SCIM 2.0 auto-provisioning</span></span></div>
      <div class="it"><span class="lg">SA</span><span><b>SAML SSO</b><span>Bring your identity provider</span></span></div>
      <div class="it"><span class="lg">Sf</span><span><b>Salesforce</b><span>Lead sync to your org</span></span></div>
      <div class="it"><span class="lg">Hs</span><span><b>HubSpot</b><span>Contacts &amp; lead routing</span></span></div>
      <div class="it"><span class="lg">{}</span><span><b>REST API</b><span>Full CRUD, scoped API keys</span></span></div>
      <div class="it"><span class="lg">⇄</span><span><b>Webhooks</b><span>Signed events, retries built in</span></span></div>
    </div>
  </div>
</section>

<section class="block how" id="pricing">
  <div class="wrap">
    <div class="center">
      <div class="kicker">Pricing</div>
      <h2 class="title">Simple plans that scale with your team</h2>
      <p class="sub">Start with a single card. Upgrade when you need more locations, integrations, or enterprise controls.</p>
    </div>
    <div class="plans">
      <div class="plan">
        <div class="pn">Individual</div>
        <div class="pp">$4.99<small>/mo</small></div>
        <div class="pd">One card for one person</div>
        <ul><li>1 card</li><li>QR code &amp; vCard</li><li>Lead capture</li><li>Card analytics</li></ul>
        <a class="btn btn-ghost" href="/signup">Get started</a>
      </div>
      <div class="plan">
        <div class="pn">Team</div>
        <div class="pp">$49<small>/mo</small></div>
        <div class="pd">For growing multi-location teams</div>
        <ul><li>250 cards, 10 locations</li><li>Employee self-service</li><li>Email signatures</li><li>CSV export &amp; API</li></ul>
        <a class="btn btn-ghost" href="/signup">Get started</a>
      </div>
      <div class="plan hot">
        <div class="pn">Multi Location Brand<span class="badge">Popular</span></div>
        <div class="pp">$199<small>/mo</small></div>
        <div class="pd">For multi-brand, multi-location organizations</div>
        <ul><li>5,000 cards, 100 locations</li><li>SSO &amp; SCIM provisioning</li><li>CRM sync &amp; webhooks</li><li>Custom domains &amp; advanced analytics</li></ul>
        <a class="btn btn-primary" href="/signup">Get started</a>
      </div>
      <div class="plan">
        <div class="pn">Enterprise</div>
        <div class="pp">Custom</div>
        <div class="pd">For enterprise scale &amp; compliance</div>
        <ul><li>Unlimited scale</li><li>Audit logs &amp; retention controls</li><li>Custom contracts &amp; SLAs</li><li>Priority support</li></ul>
        <a class="btn btn-ghost" href="/signup">Talk to us</a>
      </div>
    </div>
  </div>
</section>

<section class="block">
  <div class="wrap">
    <div class="sec">
      <div>
        <div class="kicker" style="color:#7fd8c4;-webkit-text-fill-color:#7fd8c4">Enterprise-ready</div>
        <h2>Security your IT team can say yes to</h2>
        <p>OpenCard was built for organizations — identity, isolation, and auditability are core features, not add-ons.</p>
      </div>
      <ul>
        <li>SAML SSO &amp; SCIM 2.0</li>
        <li>Role-based access control</li>
        <li>Audit logs</li>
        <li>Tenant isolation</li>
        <li>Data export &amp; retention</li>
        <li>Automated backups</li>
      </ul>
    </div>
  </div>
</section>

<section class="cta">
  <div class="wrap">
    <h2>Put your whole team on brand today</h2>
    <p>Plans from $4.99/month. Set up your first brand in minutes.</p>
    <div class="row">
      <a class="btn btn-primary btn-lg" href="/signup">Create your account</a>
      <a class="btn btn-ghost btn-lg" href="/admin/login">Sign in</a>
    </div>
  </div>
</section>

<footer>
  <div class="wrap foot">
    <img src="/opencard-logo.svg" alt="OpenCard" />
    <span>© ${new Date().getFullYear()} OpenCard. Digital business cards for multi-location teams.</span>
    <span class="sp">
      <a href="#features">Features</a>
      <a href="#pricing">Pricing</a>
      <a href="https://status.opencard.id">Status</a>
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
      <a href="/signup">Sign up</a>
      <a href="/admin/login">Sign in</a>
    </span>
  </div>
</footer>

${userwayScript()}
</body>
</html>`;
}
