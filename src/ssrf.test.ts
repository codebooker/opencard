import { test } from "node:test";
import assert from "node:assert/strict";
import { validateOutboundUrl, assertPublicUrl, safeFetch, OutboundRequestError } from "./ssrf";

test("validateOutboundUrl requires https", () => {
  assert.equal(validateOutboundUrl("http://example.com/hook").ok, false);
  assert.equal(validateOutboundUrl("ftp://example.com").ok, false);
  assert.equal(validateOutboundUrl("https://hooks.example.com/x").ok, true);
});

test("validateOutboundUrl rejects blank, long, and credentialed URLs", () => {
  assert.equal(validateOutboundUrl("").ok, false);
  assert.equal(validateOutboundUrl(null).ok, false);
  assert.equal(validateOutboundUrl("https://user:pass@example.com").ok, false);
  assert.equal(validateOutboundUrl("https://" + "a".repeat(3000) + ".com").ok, false);
});

test("validateOutboundUrl blocks localhost and metadata literals", () => {
  assert.equal(validateOutboundUrl("https://localhost/x").ok, false);
  assert.equal(validateOutboundUrl("https://metadata.google.internal/").ok, false);
});

test("validateOutboundUrl blocks private/loopback/link-local IP literals", () => {
  for (const u of [
    "https://127.0.0.1/x",
    "https://10.0.0.5/x",
    "https://192.168.1.1/x",
    "https://172.16.9.9/x",
    "https://169.254.169.254/latest/meta-data/", // AWS metadata
    "https://[::1]/x",
    "https://[fd00::1]/x",
  ]) {
    assert.equal(validateOutboundUrl(u).ok, false, u);
  }
});

test("validateOutboundUrl allows a normal public host", () => {
  assert.equal(validateOutboundUrl("https://hooks.slack.com/services/T/B/x").ok, true);
  assert.equal(validateOutboundUrl("https://8.8.8.8/x").ok, true); // public IP literal
});

test("assertPublicUrl rejects a hostname that resolves to loopback", async () => {
  // localhost resolves to 127.0.0.1 / ::1
  const r = await assertPublicUrl("https://localhost/x");
  assert.equal(r.ok, false);
});

test("assertPublicUrl passes a public IP literal without DNS", async () => {
  const r = await assertPublicUrl("https://8.8.8.8/hook");
  assert.equal(r.ok, true);
  assert.deepEqual(r.addresses, [{ address: "8.8.8.8", family: 4 }]);
});

test("safeFetch rejects an unsafe destination before opening a request", async () => {
  await assert.rejects(() => safeFetch("https://127.0.0.1/private"), OutboundRequestError);
});
