import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { signBody, buildEnvelope, deliveryHeaders, truncate, pickHeaders } from "./webhook-core";

test("signBody matches a manual HMAC-SHA256 and is verifiable", () => {
  const secret = "whsec_test";
  const body = '{"event":"ping"}';
  const sig = signBody(secret, body);
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(sig, expected);
  // a receiver recomputing over the raw body gets the same value
  assert.equal(signBody(secret, body), sig);
  assert.notEqual(signBody("other", body), sig);
});

test("buildEnvelope is stable JSON with event/createdAt/data", () => {
  const at = new Date("2026-07-01T00:00:00.000Z");
  const body = buildEnvelope("lead.captured", { id: "l1" }, at);
  assert.equal(body, '{"event":"lead.captured","createdAt":"2026-07-01T00:00:00.000Z","data":{"id":"l1"}}');
  // identical inputs -> identical body -> identical signature (retry stability)
  assert.equal(buildEnvelope("lead.captured", { id: "l1" }, at), body);
});

test("deliveryHeaders carry event + signature", () => {
  const h = deliveryHeaders("card.created", "sha256=abc");
  assert.equal(h["X-OpenCard-Event"], "card.created");
  assert.equal(h["X-OpenCard-Signature"], "sha256=abc");
  assert.equal(h["Content-Type"], "application/json");
});

test("truncate caps long strings and leaves short ones", () => {
  assert.equal(truncate("hello", 10), "hello");
  const big = "x".repeat(100);
  const t = truncate(big, 10);
  assert.equal(t, "x".repeat(10) + "…[truncated]");
});

test("pickHeaders keeps a safe subset, case-insensitive, drops the rest", () => {
  const picked = pickHeaders([
    ["Content-Type", "application/json"],
    ["Set-Cookie", "secret=1"],
    ["CF-RAY", "abc"],
    ["X-Random", "nope"],
  ]);
  assert.deepEqual(picked, { "content-type": "application/json", "cf-ray": "abc" });
  assert.equal(picked["set-cookie"], undefined);
  assert.equal(picked["x-random"], undefined);
});
