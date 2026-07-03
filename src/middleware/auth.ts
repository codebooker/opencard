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
        ${
          branding
            ? `<div class="auth-divider"><span>or</span></div>
        <a class="btn secondary auth-sso" href="/me/login">Sign in with SSO</a>`
            : ""
        }
        ${
          branding
            ? ""
            : `<p class="auth-foot">New here? <a href="/signup">Create an account</a></p>
        <details class="auth-breakglass">
          <summary>Break-glass token</summary>
          <form method="POST" action="/admin/login/token" style="margin-top:8px">
            <input name="token" type="password" placeholder="ADMIN_TOKEN" />
            <button class="btn secondary" type="submit" style="margin-top:8px">Use token</button>
          </form>
        </details>`
        }
      </div>
    </div>`,
  });
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
          <input class="auth-code" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="••••••" autocomplete="one-time-code" autofocus />
          <button class="btn auth-submit" type="submit">Verify</button>
        </form>
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
