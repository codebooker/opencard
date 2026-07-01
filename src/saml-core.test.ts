import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalHost,
  samlSpIssuer,
  samlAcsUrl,
  normalizeCert,
  samlReady,
  emailFromSamlProfile,
} from "./saml-core";

const PLATFORM = "opencard.id";
const FALLBACK = "localhost:3000";

test("canonicalHost prefers custom domain", () => {
  assert.equal(
    canonicalHost({ subdomain: "acme", customDomain: "cards.acme.com" }, PLATFORM, FALLBACK),
    "cards.acme.com"
  );
});

test("canonicalHost uses subdomain under platform domain", () => {
  assert.equal(
    canonicalHost({ subdomain: "Acme", customDomain: null }, PLATFORM, FALLBACK),
    "acme.opencard.id"
  );
});

test("canonicalHost falls back to base host when no address + no platform", () => {
  assert.equal(canonicalHost({ subdomain: null, customDomain: null }, "", FALLBACK), "localhost:3000");
});

test("canonicalHost falls back when subdomain set but no platform domain", () => {
  // Without a platform domain we can't build the subdomain host, so fall back.
  assert.equal(canonicalHost({ subdomain: "acme", customDomain: null }, "", FALLBACK), "localhost:3000");
});

test("canonicalHost returns null when nothing resolves", () => {
  assert.equal(canonicalHost({ subdomain: null, customDomain: null }, "", ""), null);
});

test("SP issuer + ACS derive from host", () => {
  assert.equal(samlSpIssuer("acme.opencard.id"), "https://acme.opencard.id/saml/metadata");
  assert.equal(samlAcsUrl("acme.opencard.id"), "https://acme.opencard.id/me/saml/acs");
});

test("normalizeCert wraps bare base64 and preserves PEM", () => {
  const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
  assert.equal(normalizeCert(pem), pem);
  const wrapped = normalizeCert("MIIBm4IIabc");
  assert.ok(wrapped.startsWith("-----BEGIN CERTIFICATE-----"));
  assert.ok(wrapped.includes("MIIBm4IIabc"));
  assert.ok(wrapped.trimEnd().endsWith("-----END CERTIFICATE-----"));
});

test("samlReady requires enabled + entryPoint + cert", () => {
  assert.equal(samlReady({ enabled: true, entryPoint: "https://idp", idpCert: "x" }), true);
  assert.equal(samlReady({ enabled: false, entryPoint: "https://idp", idpCert: "x" }), false);
  assert.equal(samlReady({ enabled: true, entryPoint: null, idpCert: "x" }), false);
  assert.equal(samlReady({ enabled: true, entryPoint: "https://idp", idpCert: null }), false);
});

test("emailFromSamlProfile reads common attributes + lowercases", () => {
  assert.equal(emailFromSamlProfile({ email: "Jane@Acme.com" }), "jane@acme.com");
  assert.equal(emailFromSamlProfile({ mail: "j@acme.com" }), "j@acme.com");
  assert.equal(
    emailFromSamlProfile({ "urn:oid:0.9.2342.19200300.100.1.3": "oid@acme.com" }),
    "oid@acme.com"
  );
  assert.equal(emailFromSamlProfile({ nameID: "nid@acme.com" }), "nid@acme.com");
  assert.equal(emailFromSamlProfile({ nameID: "not-an-email" }), null);
  assert.equal(emailFromSamlProfile({}), null);
});
