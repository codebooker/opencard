import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { Client } from "pg";
import { prisma } from "./db";
import { CLIENT_RESTORE_LOCK, withExclusiveAdvisoryLock } from "./joblock";

// Owner backup & restore. Backups live in BACKUP_DIR, which the Compose stack
// mounts from the host. An optional S3-compatible target copies both files.
// Content restore stages a dump in a scratch database and swaps workspace rows
// in one transaction. Full disaster recovery also requires the uploads archive.

export const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), "backups");

export type BackupFile = {
  name: string;
  kind: "db" | "uploads";
  manual: boolean;
  size: number;
  mtime: Date;
};

const SAFE_NAME = /^(db|uploads)-[A-Za-z0-9_.-]+\.(dump|tar\.gz)$/;

export function parseBackupName(name: string): { kind: "db" | "uploads"; manual: boolean } | null {
  if (!SAFE_NAME.test(name)) return null;
  const kind = name.startsWith("db-") ? "db" : "uploads";
  if (kind === "db" && !name.endsWith(".dump")) return null;
  if (kind === "uploads" && !name.endsWith(".tar.gz")) return null;
  return { kind, manual: name.includes("-manual-") };
}

export function listBackups(): BackupFile[] {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(BACKUP_DIR);
  } catch {
    return [];
  }
  const out: BackupFile[] = [];
  for (const name of entries) {
    const parsed = parseBackupName(name);
    if (!parsed) continue;
    try {
      const st = fs.statSync(path.join(BACKUP_DIR, name));
      out.push({ name, kind: parsed.kind, manual: parsed.manual, size: st.size, mtime: st.mtime });
    } catch {
      /* raced deletion */
    }
  }
  return out.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

// libpq rejects Prisma's ?schema=... URI parameter — strip the query string.
function pgUrl(dbName?: string): string {
  const u = new URL(process.env.DATABASE_URL || "");
  u.search = "";
  if (dbName) u.pathname = `/${dbName}`;
  return u.toString();
}

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], env: env || process.env });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(0, 400)}`))));
    p.on("error", reject);
  });
}

export function offsiteConfigured(): boolean {
  return !!process.env.S3_BUCKET;
}

async function copyOffsite(name: string, kind: "db" | "uploads"): Promise<void> {
  const bucket = process.env.S3_BUCKET || "";
  const access = process.env.AWS_ACCESS_KEY_ID || "";
  const secret = process.env.AWS_SECRET_ACCESS_KEY || "";
  if (!/^[a-zA-Z0-9._-]+$/.test(bucket) || !access || !secret) {
    throw new Error("Offsite backup settings are incomplete. Check S3_BUCKET and S3 credentials.");
  }
  const endpoint = process.env.S3_ENDPOINT || "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    RCLONE_CONFIG_OFFSITE_TYPE: "s3",
    RCLONE_CONFIG_OFFSITE_PROVIDER: endpoint ? "Other" : "AWS",
    RCLONE_CONFIG_OFFSITE_ENDPOINT: endpoint,
    RCLONE_CONFIG_OFFSITE_REGION: process.env.S3_REGION || "",
    RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID: access,
    RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY: secret,
    RCLONE_CONFIG_OFFSITE_ENV_AUTH: "false",
  };
  await run("rclone", ["copyto", path.join(BACKUP_DIR, name), `offsite:${bucket}/${kind}/${name}`, "--no-traverse"], env);
}

// On-demand backup: DB dump + uploads tarball. Files are kept locally even if
// an offsite copy fails, so an owner can retry without losing the snapshot.
export async function runManualBackup(uploadDir: string): Promise<{ db: string; uploads: string; offsite: boolean }> {
  if (!fs.existsSync(uploadDir)) throw new Error("Uploads directory is missing; refusing an incomplete backup.");
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(BACKUP_DIR, 0o700);
  const stamp = new Date().toISOString().replace(/\D/g, "") + crypto.randomBytes(3).toString("hex");
  const dbFile = `db-manual-${stamp}.dump`;
  const upFile = `uploads-manual-${stamp}.tar.gz`;
  const dbPath = path.join(BACKUP_DIR, dbFile);
  const uploadsPath = path.join(BACKUP_DIR, upFile);
  // Reserve both targets as owner-only files before pg_dump/tar opens them.
  const reserved: string[] = [];
  try {
    for (const target of [dbPath, uploadsPath]) {
      fs.closeSync(fs.openSync(target, "wx", 0o600));
      reserved.push(target);
    }
    await run("pg_dump", ["-Fc", "-f", dbPath, "-d", pgUrl()]);
    await run("tar", ["-czf", uploadsPath, "-C", uploadDir, "."]);
  } catch (error) {
    for (const target of reserved) fs.unlinkSync(target);
    throw error;
  }
  if (offsiteConfigured()) {
    await copyOffsite(dbFile, "db");
    await copyOffsite(upFile, "uploads");
  }
  return { db: dbFile, uploads: upFile, offsite: offsiteConfigured() };
}

// Content tables owned by an org, parent-first. Deliberately NOT restored:
// Org (workspace settings stay current), AdminUser/AdminSession/AuthToken
// (never resurrect old credentials), AuditLog (history is append-only).
export const ORG_CONTENT_TABLES = [
  "Brand",
  "Location",
  "Department",
  "Template",
  "Card",
  "User",
  "Event",
  "Asset",
  "Campaign",
  "Lead",
  "LeadEvent",
  "AnalyticsEvent",
  "TenantDomain",
  "ApiKey",
  "WebhookEndpoint",
  "WebhookDelivery",
  "SamlConfig",
  "CrmIntegration",
  "CrmSyncLog",
] as const;

const BATCH = 500;

// Restore one org's content to the state captured in `dumpName`. All other
// orgs' rows are untouched; the whole live-side swap is one transaction.
export async function restoreClientToBackup(
  orgId: string,
  dumpName: string
): Promise<{ tables: number; rows: number }> {
  const parsed = parseBackupName(dumpName);
  if (!parsed || parsed.kind !== "db") throw new Error("Not a database backup file.");
  const dumpPath = path.join(BACKUP_DIR, dumpName);
  if (!fs.existsSync(dumpPath)) throw new Error("Backup file not found.");

  const stageDb = `restore_stage_${Date.now().toString(36)}`;
  const admin = new Client({ connectionString: pgUrl() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${stageDb}"`);
  } finally {
    await admin.end();
  }

  const live = new Client({ connectionString: pgUrl() });
  const stage = new Client({ connectionString: pgUrl(stageDb) });
  let rows = 0;
  try {
    await run("pg_restore", ["--no-owner", "-d", pgUrl(stageDb), dumpPath]);
    await live.connect();
    await stage.connect();

    // The org must exist in the backup — otherwise this would just erase it.
    const inDump = await stage.query(`SELECT 1 FROM "Org" WHERE id = $1`, [orgId]);
    if (inDump.rowCount === 0) throw new Error("This workspace does not exist in the selected backup.");

    // Live columns per table, so dumps from older schema versions still load
    // (columns added since the dump fall back to their defaults).
    const liveCols = new Map<string, Map<string, string>>();
    for (const t of ORG_CONTENT_TABLES) {
      const r = await live.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
        [t]
      );
      liveCols.set(t, new Map(r.rows.map((x) => [x.column_name, x.data_type])));
    }

    await live.query("BEGIN");
    // Superuser session: skip FK/trigger enforcement during the swap (order-
    // independent, self-referencing FKs like Lead.duplicateOfId included).
    await live.query("SET session_replication_role = replica");

    for (const t of [...ORG_CONTENT_TABLES].reverse()) {
      await live.query(`DELETE FROM "${t}" WHERE "orgId" = $1`, [orgId]);
    }
    for (const t of ORG_CONTENT_TABLES) {
      const src = await stage.query(`SELECT * FROM "${t}" WHERE "orgId" = $1`, [orgId]);
      if (!src.rowCount) continue;
      const colTypes = liveCols.get(t)!;
      const cols = Object.keys(src.rows[0]).filter((c) => colTypes.has(c));
      const colSql = cols.map((c) => `"${c}"`).join(",");
      // node-postgres turns JS arrays into Postgres array literals — JSON
      // columns must be re-stringified explicitly or arrays arrive as '{...}'.
      const coerce = (c: string, v: unknown) => {
        const dt = colTypes.get(c);
        if ((dt === "json" || dt === "jsonb") && v !== null && v !== undefined) return JSON.stringify(v);
        return v;
      };
      for (let i = 0; i < src.rows.length; i += BATCH) {
        const chunk = src.rows.slice(i, i + BATCH);
        const params: unknown[] = [];
        const tuples = chunk
          .map((row, ri) => `(${cols.map((c, ci) => { params.push(coerce(c, row[c])); return `$${ri * cols.length + ci + 1}`; }).join(",")})`)
          .join(",");
        await live.query(`INSERT INTO "${t}" (${colSql}) VALUES ${tuples}`, params);
      }
      rows += src.rowCount;
    }

    await live.query("SET session_replication_role = DEFAULT");
    await live.query("COMMIT");
  } catch (e) {
    try {
      await live.query("ROLLBACK");
    } catch {
      /* not in tx */
    }
    throw e;
  } finally {
    await live.end().catch(() => {});
    await stage.end().catch(() => {});
    const admin2 = new Client({ connectionString: pgUrl() });
    await admin2.connect();
    await admin2.query(`DROP DATABASE IF EXISTS "${stageDb}" WITH (FORCE)`).catch(() => {});
    await admin2.end().catch(() => {});
  }
  return { tables: ORG_CONTENT_TABLES.length, rows };
}

// For display.
export function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Guard across app instances: an in-memory boolean cannot protect a
// destructive restore when multiple web processes share the database.
export async function withRestoreLock<T>(fn: () => Promise<T>): Promise<T> {
  return withExclusiveAdvisoryLock(
    CLIENT_RESTORE_LOCK,
    fn,
    "Another restore is already running — try again in a minute."
  );
}

export { prisma };
