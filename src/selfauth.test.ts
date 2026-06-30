import { test } from "node:test";
import assert from "node:assert/strict";
import { signEmail, verifyEmail } from "./selfauth";

test("signed email session round-trips (and lowercases)", () => {
  const token = signEmail("Jane.Doe@Example.com");
  assert.equal(verifyEmail(token), "jane.doe@example.com");
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
