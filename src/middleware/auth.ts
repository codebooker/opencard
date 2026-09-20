import { Request, Response, NextFunction } from "express";
import { getAdmin, AdminPrincipal } from "../rbac";
import { page, esc, OC_FAVICON } from "../views/html";
import { LoginBranding, brandLoginStyle } from "../branding";

// Resolve the current admin principal and attach it as req.admin, or redirect to login.
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const admin = await getAdmin(req);
    if (admin) {
      (req as any).admin = admin;
      return next();
    }
  } catch {
    /* fall through */
  }
  const wantsJson =
    req.path.startsWith("/api") || (req.headers.authorization || "").startsWith("Bearer ");
  if (wantsJson) return res.status(401).json({ error: "unauthorized" });
  return res.redirect("/admin/login");
}

export const reqAdmin = (req: Request): AdminPrincipal => (req as any).admin;

// 403 helper for scope/role violations.
export function forbidden(res: Response, msg = "You don't have permission to do that.") {
  return res.status(403).send(page({ title: "Forbidden", body: `<main class="card"><section class="ident"><h1>403</h1><p class="company">${esc(msg)}</p></section><a class="cta" href="/admin">Back to admin</a></main>` }));
}

export function loginPage(error?: string, info?: string, branding?: LoginBranding | null): string {
  const logo = branding?.logoUrl || "/opencard-logo.svg";
  const alt = branding?.name || "OpenCard";
  const sub = branding ? `Sign in to ${branding.name}` : "Sign in to your admin workspace";
  return page({
    title: branding ? `${branding.name} — sign in` : "Admin sign in",
    head: OC_FAVICON + (branding ? brandLoginStyle(branding) : ""),
    body: `<div class="auth">
      <div class="auth-card">
        <div class="auth-brand">
          <img src="${esc(logo)}" alt="${esc(alt)}" style="height:52px;max-height:52px;width:auto;max-width:230px;margin:0 auto 6px;display:block" />
          <p class="auth-sub">${esc(sub)}</p>
        </div>
        ${info ? `<p class="auth-banner">${esc(info)}</p>` : ""}
        ${error ? `<p class="auth-error">${esc(error)}</p>` : ""}
        <form method="POST" action="/admin/login" class="auth-form">
          <label>Email</label>
          <input name="email" type="email" autocomplete="username" placeholder="you@company.com" autofocus />
          <label>Password</label>
          <input name="password" type="password" autocomplete="current-password" placeholder="••••••••" />
          <button class="btn auth-submit" type="submit">Sign in</button>
        </form>
        <p class="auth-foot" style="margin-top:12px"><a href="/admin/forgot">Forgot your password?</a></p>
        ${
          branding
            ? `<div class="auth-divider"><span>or</span></div>
        <a class="btn secondary auth-sso" href="/me/login">Sign in with SSO</a>`
            : ""
        }
      </div>
    </div>`,
  });
}

// Shared minimal auth-card wrapper for the account-lifecycle pages.
function authCard(title: string, sub: string, inner: string, opts: { error?: string; info?: string } = {}): string {
  return page({
    title,
    head: OC_FAVICON,
    body: `<div class="auth">
      <div class="auth-card">
        <div class="auth-brand">
          <img src="/opencard-logo.svg" alt="OpenCard" style="height:44px;width:auto;margin:0 auto 6px;display:block" />
          <h1 style="font-size:20px">${esc(title)}</h1>
          <p class="auth-sub">${esc(sub)}</p>
        </div>
        ${opts.info ? `<p class="auth-banner">${esc(opts.info)}</p>` : ""}
        ${opts.error ? `<p class="auth-error">${esc(opts.error)}</p>` : ""}
        ${inner}
      </div>
    </div>`,
  });
}

export function forgotPage(opts: { sent?: boolean; error?: string } = {}): string {
  return authCard(
    "Reset your password",
    "Enter your account email and we'll send a reset link.",
    opts.sent
      ? `<p class="auth-banner">If an account exists for that address, a reset link is on its way. It expires in 1 hour.</p>
         <p class="auth-foot"><a href="/admin/login">Back to sign in</a></p>`
      : `<form method="POST" action="/admin/forgot" class="auth-form">
          <label>Email</label>
          <input name="email" type="email" autocomplete="username" placeholder="you@company.com" required autofocus />
          <button class="btn auth-submit" type="submit">Send reset link</button>
        </form>
        <p class="auth-foot"><a href="/admin/login">Back to sign in</a></p>`,
    { error: opts.error }
  );
}

export function resetPage(token: string, error?: string): string {
  return authCard(
    "Choose a new password",
    "Your other sessions will be signed out.",
    `<form method="POST" action="/admin/reset" class="auth-form">
      <input type="hidden" name="token" value="${esc(token)}" />
      <label>New password</label>
      <input name="password" type="password" autocomplete="new-password" minlength="8" required autofocus />
      <label>Confirm new password</label>
      <input name="password2" type="password" autocomplete="new-password" minlength="8" required />
      <button class="btn auth-submit" type="submit">Set password</button>
    </form>`,
    { error }
  );
}

export function invitePage(token: string, email: string, error?: string): string {
  return authCard(
    "Set up your account",
    `You've been invited as ${email}. Choose a password to finish.`,
    `<form method="POST" action="/admin/invite" class="auth-form">
      <input type="hidden" name="token" value="${esc(token)}" />
      <label>Password</label>
      <input name="password" type="password" autocomplete="new-password" minlength="8" required autofocus />
      <label>Confirm password</label>
      <input name="password2" type="password" autocomplete="new-password" minlength="8" required />
      <button class="btn auth-submit" type="submit">Create my account</button>
    </form>`,
    { error }
  );
}

export function authNoticePage(title: string, message: string, cta: { href: string; label: string }): string {
  return authCard(title, message, `<a class="btn auth-submit auth-sso" href="${esc(cta.href)}">${esc(cta.label)}</a>`);
}

export function mfaPage(error?: string): string {
  return page({
    title: "Two-factor",
    head: OC_FAVICON,
    body: `<div class="auth">
      <div class="auth-card">
        <div class="auth-brand">
          <img src="/opencard-logo.svg" alt="OpenCard" style="height:44px;width:auto;margin:0 auto 6px;display:block" />
          <h1 style="font-size:20px">Two-factor code</h1>
          <p class="auth-sub">Enter the 6-digit code from your authenticator app.</p>
        </div>
        ${error ? `<p class="auth-error">${esc(error)}</p>` : ""}
        <form method="POST" action="/admin/login/mfa" class="auth-form">
          <label for="mfa-code">Authenticator or recovery code</label>
          <input id="mfa-code" class="auth-code" name="code" maxlength="12" placeholder="••••••" autocomplete="one-time-code" autofocus />
          <button class="btn auth-submit" type="submit">Verify</button>
        </form>
        <p class="auth-foot" style="margin-top:12px;font-size:13px">Lost your device? Enter one of your recovery codes instead.</p>
      </div>
    </div>`,
  });
}

export function enrollPage(otpUri: string, secret: string, qr: string, error?: string): string {
  return page({
    title: "Set up two-factor",
    head: OC_FAVICON,
    body: `<div class="auth">
      <div class="auth-card" style="max-width:440px">
        <div class="auth-brand">
          <img src="/opencard-logo.svg" alt="OpenCard" style="height:44px;width:auto;margin:0 auto 6px;display:block" />
          <h1 style="font-size:20px">Set up two-factor</h1>
          <p class="auth-sub">Two-factor is required for admins. Scan this with Google Authenticator, 1Password, Authy, etc., then enter a code to confirm.</p>
        </div>
        ${error ? `<p class="auth-error">${esc(error)}</p>` : ""}
        <div class="auth-qr"><img src="${esc(qr)}" alt="QR code" width="180" height="180" /></div>
        <p class="muted" style="text-align:center;word-break:break-all;margin:8px 0 0">Or enter the key manually: <code>${esc(secret)}</code></p>
        <form method="POST" action="/admin/login/enroll" class="auth-form">
          <label>Confirmation code</label>
          <input class="auth-code" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="••••••" autocomplete="one-time-code" autofocus />
          <button class="btn auth-submit" type="submit">Confirm &amp; sign in</button>
        </form>
      </div>
    </div>`,
  });
}
