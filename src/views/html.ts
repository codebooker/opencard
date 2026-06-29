// Tiny HTML helpers — no template engine needed.

export function esc(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function page(opts: {
  title: string;
  body: string;
  head?: string;
  bodyClass?: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(opts.title)}</title>
<link rel="stylesheet" href="/styles.css" />
${opts.head || ""}
</head>
<body class="${opts.bodyClass || ""}">
${opts.body}
</body>
</html>`;
}
