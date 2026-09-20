import { test } from "node:test";
import assert from "node:assert/strict";
import { roleFlags, ROLE_LABELS, Role, isPlatformRole } from "./roles";

test("single-workspace owners can manage their org", () => {
  assert.deepEqual(roleFlags("org_owner"), { platform: false, global: true, super: true, staffAdmin: false });
});

test("legacy platform roles cannot acquire cross-workspace powers", () => {
  for (const role of ["platform_owner", "platform_admin", "platform_staff", "super_admin"] as Role[]) {
    const flags = roleFlags(role);
    assert.equal(flags.platform, false);
    assert.equal(flags.global, true);
    assert.equal(flags.super, true);
    assert.equal(isPlatformRole(role), true);
  }
});

test("org admins and scoped admins retain appropriate permissions", () => {
  assert.deepEqual(roleFlags("org_admin"), { platform: false, global: true, super: false, staffAdmin: false });
  for (const role of ["brand_admin", "location_admin"] as Role[]) {
    assert.deepEqual(roleFlags(role), { platform: false, global: false, super: false, staffAdmin: false });
  }
});

test("every role has a label", () => {
  for (const role of ["org_owner", "org_admin", "brand_admin", "location_admin"] as Role[]) assert.ok(ROLE_LABELS[role]);
});
