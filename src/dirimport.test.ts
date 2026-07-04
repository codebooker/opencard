import { test } from "node:test";
import assert from "node:assert/strict";
import { mapGraphUser } from "./dirimport";

test("mapGraphUser maps a full Graph user", () => {
  const c = mapGraphUser({
    displayName: "Maria Lopez",
    givenName: "Maria",
    surname: "Lopez",
    mail: "Maria.Lopez@Acme.com",
    userPrincipalName: "maria.lopez@acme.com",
    jobTitle: "Sales Consultant",
    department: "Sales",
    officeLocation: "DT01",
    businessPhones: ["+1 555 0100"],
    mobilePhone: "+1 555 0101",
    accountEnabled: true,
  })!;
  assert.equal(c.email, "maria.lopez@acme.com"); // lowercased
  assert.equal(c.firstName, "Maria");
  assert.equal(c.lastName, "Lopez");
  assert.equal(c.title, "Sales Consultant");
  assert.equal(c.locationHint, "DT01");
  assert.deepEqual(c.phones, [
    { label: "Work", value: "+1 555 0100" },
    { label: "Mobile", value: "+1 555 0101" },
  ]);
  assert.equal(c.enabled, true);
});

test("mapGraphUser falls back to UPN and display-name splitting", () => {
  const c = mapGraphUser({ displayName: "Devon King Jr", userPrincipalName: "devon@acme.com" })!;
  assert.equal(c.email, "devon@acme.com");
  assert.equal(c.firstName, "Devon");
  assert.equal(c.lastName, "King Jr");
});

test("mapGraphUser rejects users without a usable email", () => {
  assert.equal(mapGraphUser({ displayName: "Room 12 Projector" }), null);
  assert.equal(mapGraphUser({ mail: "not-an-email" }), null);
});

test("disabled accounts are flagged, not dropped", () => {
  const c = mapGraphUser({ mail: "gone@acme.com", accountEnabled: false })!;
  assert.equal(c.enabled, false);
});
