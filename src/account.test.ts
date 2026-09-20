import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateRecoveryCodes,
  normalizeRecoveryCode,
  hashRecoveryCodes,
  recoveryCodeCount,
  newRawToken,
  sha256hex,
  TOKEN_TTL_MS,
} from "./account";

test("recovery codes: format, uniqueness, normalization", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 8);
  for (const c of codes) assert.match(c, /^[23456789abcdefghjkmnpqrstuvwxyz]{4}-[23456789abcdefghjkmnpqrstuvwxyz]{4}$/);
  assert.equal(new Set(codes).size, 8);
  // Dashes/spaces/case don't matter when redeeming.
  assert.equal(normalizeRecoveryCode(" K3MP - X7NE "), "k3mpx7ne");
  const hashed = hashRecoveryCodes(["k3mp-x7ne"]);
  assert.equal(hashed[0], sha256hex("k3mpx7ne"));
});

test("recoveryCodeCount handles junk", () => {
  assert.equal(recoveryCodeCount(["a", "b"]), 2);
  assert.equal(recoveryCodeCount(null), 0);
  assert.equal(recoveryCodeCount("x"), 0);
});

test("raw tokens are long, url-safe, and unique", () => {
  const a = newRawToken();
  const b = newRawToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test("token TTLs are sane", () => {
  assert.equal(TOKEN_TTL_MS.reset, 60 * 60 * 1000);
  assert.ok(TOKEN_TTL_MS.invite >= 24 * 60 * 60 * 1000);
  assert.deepEqual(Object.keys(TOKEN_TTL_MS).sort(), ["invite", "reset"]);
});
