import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { TENANT_TABLES } from "./tenant-tables";

test("every tenant-owned Prisma model is allowlisted and protected by a committed RLS policy", () => {
  const root = process.cwd();
  const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  const schemaModels = [...schema.matchAll(/model\s+(\w+)\s+\{([\s\S]*?)\n\}/g)]
    .filter(([, , body]) => /^\s*org\s+Org\s+@relation/m.test(body) && /^\s*orgId\s+String(?!\?)\b.*$/m.test(body))
    .map(([, name]) => name)
    .sort();

  assert.deepEqual([...TENANT_TABLES].sort(), schemaModels);

  const migrationsDir = path.join(root, "prisma/migrations");
  const migrationSql = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(migrationsDir, entry.name, "migration.sql"))
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");

  for (const table of TENANT_TABLES) {
    assert.match(migrationSql, new RegExp(`CREATE POLICY tenant_isolation ON "${table}"`), `${table} lacks RLS`);
  }
});
