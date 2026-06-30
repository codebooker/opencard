import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHost } from "./host";

const PLATFORM = "opencard.id";

test("a platform subdomain resolves to its label", () => {
  assert.deepEqual(parseHost("acme.opencard.id", PLATFORM), { kind: "subdomain", label: "acme" });
  assert.deepEqual(parseHost("Acme.OpenCard.ID", PLATFORM), { kind: "subdomain", label: "acme" });
});

test("reserved labels under the platform domain are not tenants", () => {
  for (const h of ["www.opencard.id", "app.opencard.id", "admin.opencard.id", "api.opencard.id"]) {
    assert.equal(parseHost(h, PLATFORM), null, h);
  }
});

test("the platform apex itself is not a tenant", () => {
  assert.equal(parseHost("opencard.id", PLATFORM), null);
});

test("nested subdomains under the platform are rejected", () => {
  assert.equal(parseHost("a.b.opencard.id", PLATFORM), null);
});

test("a non-platform host is treated as a custom domain", () => {
  assert.deepEqual(parseHost("cards.acmecorp.com", PLATFORM), { kind: "custom", host: "cards.acmecorp.com" });
});

test("with no platform domain configured, hosts are custom-domain candidates", () => {
  assert.deepEqual(parseHost("localhost", ""), { kind: "custom", host: "localhost" });
});

test("empty host resolves to nothing", () => {
  assert.equal(parseHost("", PLATFORM), null);
  assert.equal(parseHost("   ", PLATFORM), null);
});
