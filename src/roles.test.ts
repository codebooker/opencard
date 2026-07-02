import { test } from "node:test";
import assert from "node:assert/strict";
import { roleFlags, ROLE_LABELS, Role } from "./roles";

test("platform roles span all orgs", () => {
  for (const r of ["platform_owner", "super_admin"] as Role[]) {
    assert.deepEqual(roleFlags(r), { platform: true, global: true, super: true }, r);
  }
});

test("org_owner is org-global and super but not platform", () => {
  assert.deepEqual(roleFlags("org_owner"), { platform: false, global: true, super: true });
});

test("org admins are global within their org but not super", () => {
  for (const r of ["org_admin", "general_admin"] as Role[]) {
    assert.deepEqual(roleFlags(r), { platform: false, global: true, super: false }, r);
  }
});

test("scoped roles are neither platform, global, nor super", () => {
  for (const r of ["brand_admin", "location_admin"] as Role[]) {
    assert.deepEqual(roleFlags(r), { platform: false, global: false, super: false }, r);
  }
});

test("every role has a human label", () => {
  for (const r of [
    "platform_owner",
    "org_owner",
    "org_admin",
    "super_admin",
    "general_admin",
    "brand_admin",
    "location_admin",
  ] as Role[]) {
    assert.ok(ROLE_LABELS[r] && ROLE_LABELS[r].length > 0, r);
  }
});

import { isConsole, showsBilling } from "./roles";

test("isConsole: only platform admins without a selected client", () => {
  assert.equal(isConsole({ platform: true, actingOrgId: null }), true);
  assert.equal(isConsole({ platform: true, actingOrgId: "org1" }), false); // managing a client
  assert.equal(isConsole({ platform: false, actingOrgId: null }), false); // a client user
});

test("showsBilling: clients always, platform only while managing a client", () => {
  assert.equal(showsBilling({ platform: false, actingOrgId: null }), true); // client
  assert.equal(showsBilling({ platform: true, actingOrgId: null }), false); // console — no billing
  assert.equal(showsBilling({ platform: true, actingOrgId: "org1" }), true); // managing client's plan
});
