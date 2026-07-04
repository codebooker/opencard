import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBackupName, humanSize, ORG_CONTENT_TABLES } from "./backups";

test("parseBackupName accepts only expected shapes", () => {
  assert.deepEqual(parseBackupName("db-2026-07-04_0130.dump"), { kind: "db", manual: false });
  assert.deepEqual(parseBackupName("db-manual-2026-07-04-0210.dump"), { kind: "db", manual: true });
  assert.deepEqual(parseBackupName("uploads-2026-07-04_0130.tar.gz"), { kind: "uploads", manual: false });
  assert.equal(parseBackupName("../../etc/passwd"), null);
  assert.equal(parseBackupName("db-x.tar.gz"), null);
  assert.equal(parseBackupName("uploads-x.dump"), null);
  assert.equal(parseBackupName("notes.txt"), null);
});

test("humanSize formats", () => {
  assert.equal(humanSize(500), "500 B");
  assert.equal(humanSize(2048), "2.0 KB");
  assert.equal(humanSize(5 * 1024 * 1024), "5.0 MB");
});

test("restore table list excludes accounts, audit, and Org", () => {
  const t = ORG_CONTENT_TABLES as readonly string[];
  for (const banned of ["Org", "AdminUser", "AdminSession", "AuthToken", "AuditLog", "PlatformConfig"]) {
    assert.ok(!t.includes(banned), banned);
  }
  assert.ok(t.includes("Card") && t.includes("Lead") && t.includes("Brand"));
});
