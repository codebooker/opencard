import { test } from "node:test";
import assert from "node:assert/strict";
import { canAdd, orgHasFeature, withOrgLimit } from "./entitlements";

test("self-hosted resources are uncapped", async () => {
  for (const resource of ["brands", "locations", "cards", "admins", "apiKeys", "customDomains"] as const) {
    assert.equal(await canAdd("org_local", resource), true);
    assert.equal(await withOrgLimit("org_local", resource, async () => 42), 42);
  }
});

test("all product features are available", async () => {
  for (const feature of ["selfService", "api", "sso", "scim", "customDomains", "crmSync", "auditLogs"] as const) {
    assert.equal(await orgHasFeature("org_local", feature), true);
  }
});
