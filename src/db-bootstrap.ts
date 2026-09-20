/**
 * Idempotently provision the least-privilege runtime database role used to
 * enforce Row-Level Security. Runs at container boot (as the owner/superuser)
 * AFTER `prisma migrate deploy`, so all tenant tables already exist and can be
 * granted to the role.
 *
 * If APP_DB_PASSWORD is not set, this is a no-op: the app then connects as the
 * owner and RLS is inert (application-level scoping still applies). That keeps
 * local/dev setups working without the dedicated role.
 */
import { prisma, APP_DB_ROLE } from "./db";
import { TENANT_TABLES } from "./tenant-tables";

async function main() {
  const pw = process.env.APP_DB_PASSWORD;
  if (!pw) {
    console.log("db-bootstrap: APP_DB_PASSWORD not set; skipping RLS role (running without DB-enforced RLS).");
    return;
  }
  // The password is interpolated into DDL (CREATE/ALTER ROLE can't be
  // parameterized), so refuse anything that isn't a safe token to avoid SQL
  // injection. Generated passwords are hex; this is a guard, not a limitation.
  if (!/^[A-Za-z0-9_-]{16,}$/.test(pw)) {
    throw new Error("APP_DB_PASSWORD must be >=16 chars of [A-Za-z0-9_-] (it is interpolated into role DDL).");
  }

  const db = process.env.POSTGRES_DB || "opencard";
  if (!/^[A-Za-z0-9_-]+$/.test(db)) {
    throw new Error("POSTGRES_DB must contain only [A-Za-z0-9_-] (it is interpolated into role DDL).");
  }

  // Create the role if absent (LOGIN, but explicitly NOT superuser and NOT
  // allowed to bypass RLS), then (re)set its password and grants every boot so
  // the role stays consistent and picks up any newly created tables.
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_DB_ROLE}') THEN
        CREATE ROLE "${APP_DB_ROLE}" LOGIN;
      END IF;
    END
    $$;
  `);
  await prisma.$executeRawUnsafe(
    `ALTER ROLE "${APP_DB_ROLE}" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${pw}';`
  );

  // Start from no table/sequence access on every boot, then allow CRUD only on
  // the explicitly RLS-protected tenant tables. This prevents a new migration
  // from accidentally exposing auth, platform, or operational tables merely by
  // creating them. No DDL, ownership, TRUNCATE, REFERENCES, or TRIGGER grants.
  const tenantTableSql = TENANT_TABLES.map((table) => `"${table}"`).join(", ");
  for (const stmt of [
    `GRANT CONNECT ON DATABASE "${db}" TO "${APP_DB_ROLE}";`,
    `GRANT USAGE ON SCHEMA public TO "${APP_DB_ROLE}";`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${APP_DB_ROLE}";`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "${APP_DB_ROLE}";`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM "${APP_DB_ROLE}";`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM "${APP_DB_ROLE}";`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${tenantTableSql} TO "${APP_DB_ROLE}";`,
  ]) {
    await prisma.$executeRawUnsafe(stmt);
  }

  console.log(
    `db-bootstrap: role "${APP_DB_ROLE}" is provisioned for ${TENANT_TABLES.length} RLS-protected tenant tables.`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("db-bootstrap failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
