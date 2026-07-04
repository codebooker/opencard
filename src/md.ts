// Minimal markdown -> HTML for rendering our own docs (docs/API.md) as an
// admin page. Covers exactly what those files use: headings, fenced code,
// tables, blockquotes, lists, bold, inline code, links, hr. Input is OUR OWN
// repo content, but everything is HTML-escaped anyway.

const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string): string {
  let out = escHtml(s);
  out = out.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  // links: [text](url) — http(s) and site-relative only
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, `<a href="$2">$1</a>`);
  return out;
}

export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (/^```/.test(line)) {
      closeList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      out.push(`<pre><code>${escHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // table (header row + separator row)
    if (/^\|/.test(line) && /^\|?[\s:|-]+\|?$/.test(lines[i + 1] || "")) {
      closeList();
      const cells = (row: string) => row.replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) body.push(cells(lines[i++]));
      out.push(
        `<table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>` +
          body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") +
          `</table>`
      );
      continue;
    }

    // headings
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // hr
    if (/^---+\s*$/.test(line)) {
      closeList();
      out.push("<hr />");
      i++;
      continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      closeList();
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // list item
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
      i++;
      continue;
    }

    // blank
    if (!line.trim()) {
      closeList();
      i++;
      continue;
    }

    // paragraph (merge consecutive text lines)
    closeList();
    const buf: string[] = [line];
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|```|\||>|---|\s*[-*]\s)/.test(lines[i + 1])) {
      buf.push(lines[++i]);
    }
    out.push(`<p>${inline(buf.join(" "))}</p>`);
    i++;
  }
  closeList();
  return out.join("\n");
}
