import { test } from "node:test";
import assert from "node:assert/strict";
import { hasScope, sanitizeScopes, isApiScope, API_SCOPES } from "./api-scopes";

test("empty or absent grant means full access (back-compat)", () => {
  assert.equal(hasScope([], "cards:write"), true);
  assert.equal(hasScope(null, "leads:read"), true);
  assert.equal(hasScope(undefined, "analytics:read"), true);
});

test("a scoped key only allows its granted actions", () => {
  const granted = ["cards:read", "leads:read"];
  assert.equal(hasScope(granted, "cards:read"), true);
  assert.equal(hasScope(granted, "leads:read"), true);
  assert.equal(hasScope(granted, "cards:write"), false);
  assert.equal(hasScope(granted, "brands:read"), false);
});

test("sanitizeScopes keeps only valid, de-duplicated scopes", () => {
  assert.deepEqual(sanitizeScopes(["cards:read", "cards:read", "bogus", 5, "leads:read"]), ["cards:read", "leads:read"]);
  assert.deepEqual(sanitizeScopes("cards:write"), ["cards:write"]);
  assert.deepEqual(sanitizeScopes(null), []);
  assert.deepEqual(sanitizeScopes(undefined), []);
});

test("isApiScope validates against the known set", () => {
  assert.equal(isApiScope("cards:read"), true);
  assert.equal(isApiScope("cards:delete"), false);
  assert.equal(isApiScope(42), false);
});

test("every scope has a label", async () => {
  const { SCOPE_LABELS } = await import("./api-scopes");
  for (const s of API_SCOPES) assert.ok(SCOPE_LABELS[s]?.length > 0, s);
});
