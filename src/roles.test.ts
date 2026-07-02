import { test } from "node:test";
import assert from "node:assert/strict";
import { roleFlags, ROLE_LABELS, Role } from "./roles";

test("platform roles span all orgs", () => {
  for (const r of ["platform_owner", "super_admin"] as Role[]) {
    assert.deepEqual(roleFlags(r), { platform: true, global: true, super: true, staffAdmin: true }, r);
  }
});

test("org_owner is org-global and super but not platform", () => {
  assert.deepEqual(roleFlags("org_owner"), { platform: false, global: true, super: true, staffAdmin: false });
});

test("org admins are global within their org but not super", () => {
  for (const r of ["org_admin", "general_admin"] as Role[]) {
    assert.deepEqual(roleFlags(r), { platform: false, global: true, super: false, staffAdmin: false }, r);
  }
});

test("scoped roles are neither platform, global, nor super", () => {
  for (const r of ["brand_admin", "location_admin"] as Role[]) {
    assert.deepEqual(roleFlags(r), { platform: false, global: false, super: false, staffAdmin: false }, r);
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

import { assignableStaffRoles, canManageStaffTarget, isPlatformRole, roleFlags as rf } from "./roles";

test("platform tiers all count as platform, only owner/admin are staffAdmin", () => {
  assert.equal(rf("platform_owner").staffAdmin, true);
  assert.equal(rf("platform_admin").staffAdmin, true);
  assert.equal(rf("platform_staff").staffAdmin, false);
  assert.equal(rf("platform_staff").platform, true); // still cross-client
  assert.equal(rf("platform_staff").super, true); // full run of client workspaces
  assert.equal(rf("org_owner").staffAdmin, false);
});

test("assignableStaffRoles: owner grants any, admin can't grant owner", () => {
  assert.deepEqual(assignableStaffRoles("platform_owner"), ["platform_owner", "platform_admin", "platform_staff"]);
  assert.deepEqual(assignableStaffRoles("platform_admin"), ["platform_admin", "platform_staff"]);
  assert.deepEqual(assignableStaffRoles("platform_staff"), []);
  assert.deepEqual(assignableStaffRoles("org_owner"), []);
});

test("canManageStaffTarget: admins can't touch owners; staff can't manage anyone", () => {
  assert.equal(canManageStaffTarget("platform_owner", "platform_owner"), true);
  assert.equal(canManageStaffTarget("platform_admin", "platform_staff"), true);
  assert.equal(canManageStaffTarget("platform_admin", "platform_owner"), false); // can't modify owner
  assert.equal(canManageStaffTarget("platform_staff", "platform_staff"), false); // not a staff-admin
});

test("isPlatformRole covers the tiers + legacy super_admin", () => {
  assert.equal(isPlatformRole("platform_staff"), true);
  assert.equal(isPlatformRole("super_admin"), true);
  assert.equal(isPlatformRole("org_owner"), false);
});
