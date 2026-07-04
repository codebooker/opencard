import { test } from "node:test";
import assert from "node:assert/strict";
import { mdToHtml } from "./md";

test("mdToHtml renders headings, code, bold, inline code", () => {
  const html = mdToHtml("# Title\n\nSome **bold** and `code`.\n\n```\ncurl -H \"X: <y>\"\n```");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<pre><code>curl -H &quot;X: &lt;y&gt;&quot;<\/code><\/pre>/);
});

test("mdToHtml renders tables and escapes cell content", () => {
  const html = mdToHtml("| A | B |\n|---|---|\n| `x` | <script> |");
  assert.match(html, /<table><tr><th>A<\/th><th>B<\/th><\/tr>/);
  assert.match(html, /<td><code>x<\/code><\/td>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("mdToHtml renders lists, blockquotes, links and hr", () => {
  const html = mdToHtml("- one\n- two\n\n> note here\n\n---\n\n[docs](/admin)");
  assert.match(html, /<ul>\n<li>one<\/li>\n<li>two<\/li>\n<\/ul>/);
  assert.match(html, /<blockquote>note here<\/blockquote>/);
  assert.match(html, /<hr \/>/);
  assert.match(html, /<a href="\/admin">docs<\/a>/);
});

test("mdToHtml merges paragraph lines and ignores javascript: links", () => {
  const html = mdToHtml("line one\nline two\n\n[bad](javascript:alert(1))");
  assert.match(html, /<p>line one line two<\/p>/);
  assert.doesNotMatch(html, /href="javascript:/);
});
