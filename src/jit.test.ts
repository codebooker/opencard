import { test } from "node:test";
import assert from "node:assert/strict";
import { mapSamlProfile } from "./jit";

test("mapSamlProfile reads friendly attribute names", () => {
  const c = mapSamlProfile(
    { givenName: "Maria", sn: "Lopez", title: "Sales Consultant", department: "Sales" },
    "Maria.Lopez@Acme.com"
  );
  assert.equal(c.email, "maria.lopez@acme.com");
  assert.equal(c.firstName, "Maria");
  assert.equal(c.lastName, "Lopez");
  assert.equal(c.title, "Sales Consultant");
  assert.equal(c.department, "Sales");
});

test("mapSamlProfile reads Entra claim URIs", () => {
  const c = mapSamlProfile(
    {
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname": "Devon",
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname": "King",
    },
    "devon@acme.com"
  );
  assert.equal(c.firstName, "Devon");
  assert.equal(c.lastName, "King");
});

test("mapSamlProfile falls back to displayName, then the email local part", () => {
  const c1 = mapSamlProfile({ displayName: "Ana Q Public" }, "ana@acme.com");
  assert.equal(c1.firstName, "Ana");
  assert.equal(c1.lastName, "Q Public");
  const c2 = mapSamlProfile({}, "solo@acme.com");
  assert.equal(c2.firstName, "solo");
  assert.equal(c2.lastName, "");
});

test("mapSamlProfile handles array-valued attributes (ADFS style)", () => {
  const c = mapSamlProfile({ "urn:oid:2.5.4.42": ["Kai"], "urn:oid:2.5.4.4": ["Ito"] }, "kai@acme.com");
  assert.equal(c.firstName, "Kai");
  assert.equal(c.lastName, "Ito");
});
