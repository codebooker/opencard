import { test } from "node:test";
import assert from "node:assert/strict";
import { mapGraphUser, filterByDepartment, onlySelected } from "./dirimport";
import * as secretbox from "./secretbox";

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

test("filterByDepartment matches case-insensitive substrings", () => {
  const users = [
    { mail: "a@x.com", department: "IT" },
    { mail: "b@x.com", department: "Service & Parts" },
    { mail: "c@x.com", department: null },
    { mail: "d@x.com" },
  ];
  assert.equal(filterByDepartment(users, "it").length, 1);
  assert.equal(filterByDepartment(users, "service").length, 1);
  assert.equal(filterByDepartment(users, "PARTS").length, 1);
  assert.equal(filterByDepartment(users, "").length, 4); // blank = no filter
  assert.equal(filterByDepartment(users, "hr").length, 0);
});

test("onlySelected keeps only ticked create rows", () => {
  const row = (email: string, status: "create" | "exists" | "disabled") =>
    ({ email, status, firstName: "", lastName: "", title: null, department: null, locationHint: null, phones: [], enabled: true, location: { id: "l", name: "L" } } as any);
  const rows = [row("a@x.com", "create"), row("b@x.com", "create"), row("c@x.com", "exists")];
  const out = onlySelected(rows, ["B@X.com ", "c@x.com", "ghost@x.com"]);
  // b selected (case/space-insensitive); c is "exists" so never re-created;
  // ghost isn't in the plan at all.
  assert.deepEqual(out.map((r) => r.email), ["b@x.com"]);
});

test("secretbox seals and opens; tampering returns null", () => {
  const sealed = secretbox.seal("o2F8Q~super-secret");
  assert.notEqual(sealed, "o2F8Q~super-secret");
  assert.equal(secretbox.open(sealed), "o2F8Q~super-secret");
  assert.equal(secretbox.open("v1:" + Buffer.from("garbage-garbage-garbage-garbage").toString("base64")), null);
  assert.equal(secretbox.open("plaintext-leftover"), null);
});
