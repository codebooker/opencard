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
        <p class="auth-foot">New here? <a href="/signup">Create an account</a></p>
        <details class="auth-breakglass">
          <summary>Break-glass token</summary>
          <form method="POST" action="/admin/login/token" style="margin-top:8px">
            <input name="token" type="password" placeholder="ADMIN_TOKEN" />
            <button class="btn secondary" type="submit" style="margin-top:8px">Use token</button>
          </form>
        </details>
      </div>
    </div>`,
  });
}

export function mfaPage(error?: string): string {
  return page({
    title: "Two-factor",
    head: OC_FAVICON,
    body: `<div class="login">
      <h1>Two-factor code</h1>
      <p class="muted">Enter the 6-digit code from your authenticator app.</p>
      ${error ? `<p style="color:#b91c1c">${esc(error)}</p>` : ""}
      <form method="POST" action="/admin/login/mfa">
        <input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="123456" autofocus />
        <p style="margin-top:12px"><button class="btn" type="submit">Verify</button></p>
      </form>
    </div>`,
  });
}

export function enrollPage(otpUri: string, secret: string, qr: string, error?: string): string {
  return page({
    title: "Set up two-factor",
    head: OC_FAVICON,
    body: `<div class="login" style="max-width:440px">
      <h1>Set up two-factor</h1>
      <p class="muted">Two-factor is required for admins. Scan this with Google Authenticator, 1Password, Authy, etc., then enter a code to confirm.</p>
      ${error ? `<p style="color:#b91c1c">${esc(error)}</p>` : ""}
      <p style="text-align:center"><img src="${esc(qr)}" alt="QR code" width="200" height="200" /></p>
      <p class="muted" style="text-align:center;word-break:break-all">Or enter the key manually: <code>${esc(secret)}</code></p>
      <form method="POST" action="/admin/login/enroll">
        <label>Confirmation code</label>
        <input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="123456" autofocus />
        <p style="margin-top:12px"><button class="btn" type="submit">Confirm &amp; sign in</button></p>
      </form>
    </div>`,
  });
}
