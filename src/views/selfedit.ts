import { esc, page, OC_FAVICON } from "./html";
import { LoginBranding, brandLoginStyle } from "../branding";
import {
  photoField,
  labeledRowsField,
  socialsField,
  editorScripts,
  SELF_FIELDS,
  PHONE_LABELS,
  EMAIL_LABELS,
  WEB_LABELS,
} from "./widgets";

// A branded employee sign-in card (mirrors the admin `.auth` layout). Shows the
// client's logo + palette when the request came in on a registered client domain.
function authLogin(title: string, inner: string, branding?: LoginBranding | null): string {
  const logo = branding?.logoUrl || "/opencard-logo.svg";
  const alt = branding?.name || "OpenCard";
  const sub = branding ? `Sign in to ${branding.name}` : "Sign in to your workspace";
  return page({
    title: branding ? `${branding.name} — sign in` : title,
    head: OC_FAVICON + (branding ? brandLoginStyle(branding) : ""),
    body: `<div class="auth"><div class="auth-card">
      <div class="auth-brand">
        <img src="${esc(logo)}" alt="${esc(alt)}" style="height:52px;max-height:52px;width:auto;max-width:230px;margin:0 auto 6px;display:block" />
        <p class="auth-sub">${esc(sub)}</p>
      </div>
      ${inner}
    </div></div>`,
  });
}

function shell(title: string, body: string): string {
  return page({
    title,
    body: `<header class="site-head">
      <div class="site-head-in">
        <span class="site-title">My card</span>
        <div class="site-actions">
          <a class="btn secondary" href="/me/logout">Sign out</a>
        </div>
      </div>
    </header>
    <main class="admin" style="max-width:820px">
      ${body}
    </main>`,
    noUserway: true,
  });
}

export function notConfiguredPage(message: string, branding?: LoginBranding | null): string {
  return authLogin("Self-service", `<p class="muted" style="text-align:center">${esc(message)}</p>`, branding);
}

export function devLoginPage(branding?: LoginBranding | null): string {
  return authLogin(
    "Sign in",
    `<form class="auth-form" method="POST" action="/me/devlogin">
      <p class="muted">Developer sign-in (no SSO configured). Enter the email that matches your card's owner email.</p>
      <label>Email</label><input name="email" type="email" placeholder="you@yourco.com" required autofocus />
      <button class="btn auth-submit" type="submit">Sign in</button>
    </form>`,
    branding
  );
}

export function samlLoginPage(branding?: LoginBranding | null): string {
  return authLogin(
    "Sign in",
    `<p class="muted" style="text-align:center">Use your organization's identity provider to continue.</p>
     <a class="btn auth-submit" href="/me/saml/login" style="display:block;text-align:center;box-sizing:border-box">Sign in with SSO</a>`,
    branding
  );
}

export function noCardPage(email: string): string {
  return shell(
    "No card",
    `<p>We couldn't find a card assigned to <strong>${esc(
      email
    )}</strong>. Ask your admin to set this as the owner email on your card.</p>
     <p><a class="btn secondary" href="/me/logout">Sign out</a></p>`
  );
}

export function selfEditPage(
  card: any,
  allowed: Set<string>,
  email: string,
  saved: boolean,
  signatureBlockHtml = ""
): string {
  const fullName = [card.prefix, card.firstName, card.lastName].filter(Boolean).join(" ");
  const can = (k: string) => allowed.has(k);

  const sections: string[] = [];

  if (can("name")) {
    sections.push(`<div class="grid2">
      <div><label>Prefix</label><input name="prefix" value="${esc(card.prefix)}" placeholder="Mr./Dr." /></div>
      <div><label>Pronouns</label><input name="pronouns" value="${esc(card.pronouns)}" placeholder="he/him" /></div>
    </div>
    <div class="grid2">
      <div><label>First name</label><input name="firstName" value="${esc(card.firstName)}" required /></div>
      <div><label>Last name</label><input name="lastName" value="${esc(card.lastName)}" required /></div>
    </div>`);
  } else if (can("pronouns")) {
    sections.push(`<label>Pronouns</label><input name="pronouns" value="${esc(card.pronouns)}" placeholder="he/him" />`);
  }
  if (can("title")) sections.push(`<label>Job title</label><input name="title" value="${esc(card.title)}" />`);
  if (can("department"))
    sections.push(`<label>Department</label><input name="department" value="${esc(card.department)}" />`);
  if (can("bio")) sections.push(`<label>Bio</label><textarea name="bio" rows="2">${esc(card.bio)}</textarea>`);
  if (can("photo")) sections.push(photoField(card.photoUrl));
  if (can("phones"))
    sections.push(labeledRowsField({ name: "phones", title: "Phones", placeholder: "+1 555 123 4567", options: PHONE_LABELS, items: card.phones }));
  if (can("emails"))
    sections.push(labeledRowsField({ name: "emails", title: "Emails", placeholder: "you@company.com", options: EMAIL_LABELS, items: card.emails }));
  if (can("websites"))
    sections.push(labeledRowsField({ name: "websites", title: "Websites", placeholder: "https://...", options: WEB_LABELS, items: card.websites }));
  if (can("socials")) sections.push(socialsField(card.socials));

  const allowedLabels = SELF_FIELDS.filter(([k]) => allowed.has(k)).map(([, l]) => l);

  const body = `
  <div class="stat" style="margin-bottom:16px">
    <div class="topbar" style="margin-bottom:0">
      <div style="flex-direction:column;align-items:flex-start;gap:2px">
        <strong style="font-size:16px">${esc(fullName)}</strong>
        <span class="muted">${esc(card.location?.brand?.name || "")} · signed in as ${esc(email)}</span>
      </div>
      <a class="btn secondary" href="/c/${esc(card.slug)}" target="_blank">View public card</a>
    </div>
    <p class="muted" style="margin:10px 0 0">You can edit: ${esc(
      allowedLabels.join(", ") || "(nothing — ask your admin)"
    )}.</p>
  </div>
  ${saved ? `<p class="auth-banner">✓ Saved.</p>` : ""}
  <form class="editor" method="POST" action="/me" enctype="multipart/form-data">
    ${sections.join("\n")}
    <p style="margin-top:16px"><button class="btn" type="submit">Save my card</button>
    <a class="btn secondary" href="/c/${esc(card.slug)}" target="_blank">Preview</a></p>
  </form>
  ${signatureBlockHtml ? `<h3 style="margin-top:20px">Email signature</h3>${signatureBlockHtml}` : ""}
  ${editorScripts()}`;
  return shell("My card", body);
}
