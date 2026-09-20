import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signEmail,
  signEmployeeIdentity,
  signOidcContext,
  verifyEmail,
  verifyEmployeeIdentity,
  verifyOidcContext,
} from "./selfauth";

test("signed email session round-trips (and lowercases)", () => {
  const token = signEmail("Jane.Doe@Example.com", 1_000);
  assert.equal(verifyEmail(token, 1_001), "jane.doe@example.com");
  assert.equal(verifyEmail(token, 1_000 + 5 * 60 * 1000 + 1), null);
});

test("tampered or garbage session tokens are rejected", () => {
  const token = signEmail("admin@yourco.com");
  const [payload, sig] = token.split(".");
  // swap payload to a different email, keep old signature
  const forged = Buffer.from("evil@attacker.com").toString("base64url") + "." + sig;
  assert.equal(verifyEmail(forged), null);
  assert.equal(verifyEmail(payload + ".deadbeef"), null);
  assert.equal(verifyEmail("not-a-token"), null);
  assert.equal(verifyEmail(undefined), null);
});

test("employee identity is bound to its workspace", () => {
  const token = signEmployeeIdentity("Jane.Doe@Example.com", "org_acme", 1_000);
  assert.deepEqual(verifyEmployeeIdentity(token, 1_001), {
    email: "jane.doe@example.com",
    orgId: "org_acme",
  });
  assert.equal(verifyEmail(token), null);
  assert.equal(verifyEmployeeIdentity(signEmail("jane.doe@example.com", 1_000), 1_001), null);
  assert.equal(verifyEmployeeIdentity(token, 1_000 + 12 * 60 * 60 * 1000 + 1), null);
});

test("OIDC context is tenant-bound and expires", () => {
  const token = signOidcContext("org_acme", 1_000);
  assert.equal(verifyOidcContext(token, 1_001), "org_acme");
  assert.equal(verifyOidcContext(token, 1_000 + 10 * 60 * 1000 + 1), null);
  assert.equal(verifyOidcContext(`${token}x`, 1_001), null);
});
