// Branded 404 page, served by the global notFound handler. Self-contained
// (inline styles) so it renders correctly on any route — marketing, cards,
// admin typos — without depending on any stylesheet.

import { userwayScript } from "./html";

export function notFoundPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Page not found — OpenCard</title>
<link rel="icon" type="image/svg+xml" href="/opencard-icon.svg" />
<style>
:root{--blue:#1F5BEA;--teal:#25D1B3;--ink:#0e1526;--muted:#6b7280;--line:#e7eaf0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
  background:
    radial-gradient(44rem 26rem at 80% -6rem,rgba(37,209,179,.12),transparent 60%),
    radial-gradient(40rem 26rem at 10% -8rem,rgba(31,91,234,.10),transparent 60%),#fff;
  color:#3d4557;-webkit-font-smoothing:antialiased;text-align:center}
.wrap{max-width:520px}
.logo{height:34px;margin:0 auto 40px;display:block}
.code{font-size:96px;font-weight:800;letter-spacing:-.04em;line-height:1;
  background:linear-gradient(100deg,var(--blue),#18AEE0 55%,var(--teal));
  -webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:14px}
h1{font-size:24px;color:var(--ink);letter-spacing:-.01em;margin-bottom:10px}
p{font-size:15.5px;line-height:1.6;margin-bottom:30px}
.row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;padding:11px 22px;border-radius:10px;font-size:14.5px;
  font-weight:600;text-decoration:none;transition:all .15s ease}
.b1{background:linear-gradient(100deg,var(--blue),#18AEE0 55%,var(--teal));color:#fff;
  box-shadow:0 4px 14px -4px rgba(31,91,234,.5)}
.b1:hover{filter:brightness(1.06)}
.b2{color:var(--ink);border:1px solid var(--line);background:#fff}
.b2:hover{background:#f6f8fb}
.foot{margin-top:44px;font-size:13px;color:var(--muted)}
.foot a{color:var(--muted)}
.foot a:hover{color:var(--ink)}
</style>
</head>
<body>
<main class="wrap">
  <a href="/"><img class="logo" src="/opencard-logo.svg" alt="OpenCard" /></a>
  <div class="code" aria-hidden="true">404</div>
  <h1>This page doesn't exist</h1>
  <p>The link may be mistyped, expired, or the card behind it may have been deactivated. If you scanned a QR code, ask the person who shared it for a fresh one.</p>
  <div class="row">
    <a class="btn b1" href="/">Go to homepage</a>
    <a class="btn b2" href="/admin/login">Sign in</a>
  </div>
  <p class="foot"><a href="https://status.opencard.id">Service status</a> &nbsp;·&nbsp; <a href="/terms">Terms</a> &nbsp;·&nbsp; <a href="/privacy">Privacy</a></p>
</main>
${userwayScript()}
</body>
</html>`;
}
