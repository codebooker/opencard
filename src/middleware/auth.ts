import { Request, Response, NextFunction } from "express";
import { getAdmin, AdminPrincipal } from "../rbac";
import { page, esc } from "../views/html";

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

export function loginPage(error?: string): string {
  return page({
    title: "Admin sign in",
    body: `<div class="login">
      <h1>OpenCard admin</h1>
      ${error ? `<p style="color:#b91c1c">${esc(error)}</p>` : ""}
      <form method="POST" action="/admin/login">
        <label>Email</label><input name="email" type="email" autocomplete="username" autofocus />
        <label>Password</label><input name="password" type="password" autocomplete="current-password" />
        <p style="margin-top:12px"><button class="btn" type="submit">Sign in</button></p>
      </form>
      <p class="muted" style="text-align:center">— or —</p>
      <p><a class="btn secondary" href="/me/login" style="display:block;text-align:center">Sign in with your work account (SSO)</a></p>
      <details style="margin-top:14px"><summary class="muted">Super admin token (break-glass)</summary>
        <form method="POST" action="/admin/login/token" style="margin-top:8px">
          <input name="token" type="password" placeholder="ADMIN_TOKEN" />
          <p style="margin-top:8px"><button class="btn secondary" type="submit">Use token</button></p>
        </form>
      </details>
    </div>`,
  });
}

export function mfaPage(error?: string): string {
  return page({
    title: "Two-factor",
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
