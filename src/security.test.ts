import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  base32Encode,
  generateTotpSecret,
  currentTotp,
  verifyTotp,
} from "./security";

test("password hash round-trips and rejects wrong/empty", () => {
  const stored = hashPassword("correct horse battery staple");
  assert.ok(stored.startsWith("scrypt$"));
  assert.equal(verifyPassword("correct horse battery staple", stored), true);
  assert.equal(verifyPassword("wrong password", stored), false);
  assert.equal(verifyPassword("anything", null), false);
  assert.equal(verifyPassword("anything", "garbage"), false);
});

test("password hashes are salted (two hashes differ)", () => {
  assert.notEqual(hashPassword("same"), hashPassword("same"));
});

test("base32 encodes without padding chars", () => {
  const out = base32Encode(Buffer.from("hello world"));
  assert.match(out, /^[A-Z2-7]+$/);
});

test("TOTP verifies its own current code and rejects bad input", () => {
  const secret = generateTotpSecret();
  const code = currentTotp(secret);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotp(secret, code), true);
  assert.equal(verifyTotp(secret, "000000"), false);
  assert.equal(verifyTotp(secret, "abc"), false);
  assert.equal(verifyTotp(secret, ""), false);
});
