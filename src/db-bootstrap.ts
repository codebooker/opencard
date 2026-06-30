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

  // Least-privilege grants: connect, use the schema, and CRUD on existing tables
  // and sequences. No DDL, no ownership. ALTER DEFAULT PRIVILEGES covers tables
  // created by future migrations.
  for (const stmt of [
    `GRANT CONNECT ON DATABASE "${db}" TO "${APP_DB_ROLE}";`,
    `GRANT USAGE ON SCHEMA public TO "${APP_DB_ROLE}";`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${APP_DB_ROLE}";`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${APP_DB_ROLE}";`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${APP_DB_ROLE}";`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${APP_DB_ROLE}";`,
  ]) {
    await prisma.$executeRawUnsafe(stmt);
  }

  console.log(`db-bootstrap: role "${APP_DB_ROLE}" is provisioned with least-privilege grants (RLS enforced).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("db-bootstrap failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
