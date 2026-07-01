import { esc, page } from "./html";
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

function shell(title: string, body: string): string {
  return page({
    title,
    body: `<div class="admin"><div class="topbar">
      <h1>My card</h1>
      <a class="btn secondary" href="/me/logout">Sign out</a>
    </div>${body}</div>`,
  });
}

export function notConfiguredPage(message: string): string {
  return shell("Self-service", `<p class="muted">${esc(message)}</p>`);
}

export function devLoginPage(): string {
  return shell(
    "Sign in",
    `<form class="editor" method="POST" action="/me/devlogin" style="max-width:420px">
      <p class="muted">Developer sign-in (no SSO configured). Enter the email that matches your card's owner email.</p>
      <label>Email</label><input name="email" type="email" placeholder="you@yourco.com" required autofocus />
      <p style="margin-top:14px"><button class="btn" type="submit">Sign in</button></p>
    </form>`
  );
}

export function samlLoginPage(): string {
  return shell(
    "Sign in",
    `<div class="stat" style="max-width:420px">
      <h2>Work account sign in</h2>
      <p class="muted">Use your organization's SAML identity provider to continue.</p>
      <p style="margin-top:14px"><a class="btn" href="/me/saml/login">Sign in with SAML</a></p>
    </div>`
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
  signature = ""
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
    <strong>${esc(fullName)}</strong> · ${esc(card.location?.brand?.name || "")}
    &nbsp;·&nbsp; <a href="/c/${esc(card.slug)}" target="_blank">view public card</a>
    <p class="muted" style="margin:6px 0 0">Signed in as ${esc(email)}. You can edit: ${esc(
      allowedLabels.join(", ") || "(nothing — ask your admin)"
    )}.</p>
  </div>
  ${saved ? `<p style="color:#166534">✓ Saved.</p>` : ""}
  <form class="editor" method="POST" action="/me" enctype="multipart/form-data">
    ${sections.join("\n")}
    <p style="margin-top:16px"><button class="btn" type="submit">Save my card</button>
    <a class="btn secondary" href="/c/${esc(card.slug)}" target="_blank">Preview</a></p>
  </form>
  ${
    signature
      ? `<div class="stat" style="margin-top:20px">
    <strong>Email signature</strong>
    <p class="muted" style="margin:4px 0 8px">Copy this into your email client's signature settings.</p>
    <pre id="sig" style="white-space:pre-wrap;word-break:break-word;background:#f6f8fa;border:1px solid #e5e7eb;padding:10px;border-radius:6px;font:inherit">${esc(
      signature
    )}</pre>
    <button type="button" class="btn secondary" onclick="navigator.clipboard.writeText(document.getElementById('sig').innerText).then(function(){this.textContent='Copied';}.bind(this))">Copy signature</button>
  </div>`
      : ""
  }
  ${editorScripts()}`;
  return shell("My card", body);
}
