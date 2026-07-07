# OpenCard — Security, Privacy & Compliance

This document summarizes the technical controls OpenCard ships for data protection,
and the operational procedures (backup/restore) an operator must run. It is the
starting point for a SOC 2 / ISO 27001 readiness effort and for answering
GDPR/CCPA data-subject requests.

## Tenant isolation

- Every tenant-owned row carries an `orgId`; all reads and writes are scoped by
  the authenticated org (application layer).
- Postgres **Row-Level Security** policies key on `app.current_org_id` as a second
  layer. The app connects as a least-privilege role (`opencard_app`,
  `NOSUPERUSER NOBYPASSRLS`); migrations/seed run as the owner. RLS is active only
  when `APP_DB_PASSWORD` is set — **set it in production** so the database itself
  refuses cross-tenant rows.
- Platform staff who drill into a client are confined to that client's org
  (`seesAllOrgs` is false while acting).

## Audit logging

- Append-only `AuditLog` per org records sign-ins (success/MFA/token/failed),
  admin & staff changes, API-key/webhook/CRM changes, billing, SSO, SCIM, custom
  domains, brand deletion, and data export/erasure/retention.
- Viewable at **Admin → Audit** (org owner+), filterable by action, scoped per
  tenant.

## Data-subject rights (GDPR / CCPA)

Admin → **Data & privacy**:

- **Access / portability** — "Download data (JSON)" exports a full bundle of the
  org's records with secrets (tokens, Stripe/SCIM identifiers) stripped.
- **Erasure (a person)** — open a lead → **Erase lead** deletes it and its
  history. Audited.
- **Erasure (whole client)** — platform staff, while managing a client, can purge
  all of that client's operational data behind a typed name-match confirmation.
  Keeps the account shell + admin logins. Audited.

## Retention / data minimization

- Per-org **lead retention policy** (Admin → Data & privacy): auto-delete leads
  older than N days. Runs hourly and on demand. Blank/0 = keep indefinitely.
  Each prune is audited.

## Encryption

- **In transit:** TLS everywhere. Platform domains use Cloudflare edge + origin
  certs; client custom domains use on-demand Let's Encrypt.
- **At rest:** secrets are stored hashed where possible (admin passwords, API
  keys, SCIM tokens — only hashes persisted). Provider tokens (HubSpot) are stored
  to enable sync; encrypt the database volume at the infrastructure layer and
  rotate tokens per the customer's policy.
- **Never logged / never in URLs:** raw API keys and SCIM tokens are shown once
  and never written to logs or query strings.

## Backups & restore (operator procedure)

The database is the source of truth (Postgres in the `db` container; volume
`opencard_db_data`). Uploaded media lives in the `uploads` volume.

**Nightly logical backup (run on the VM):**

```
docker exec opencard-db-1 pg_dump -U opencard -Fc opencard > /opt/opencard/backups/opencard-$(date +%F).dump
# copy off-box (e.g. object storage) and keep >= 30 daily + weekly copies
```

**Restore (into a fresh db):**

```
docker exec -i opencard-db-1 pg_restore -U opencard -d opencard --clean --if-exists < opencard-YYYY-MM-DD.dump
```

- Test the restore on a scratch database **quarterly** and record the result.
- Also snapshot the `uploads` volume alongside each dump.
- Schema changes ship as reviewed Prisma migrations (`prisma migrate deploy`) in
  git — restores replay to a known schema version.

## Change management

- All changes go through git + reviewed migrations; deploys run through the
  GitOps pipeline (push → type-check gate → Portainer redeploy). No manual,
  unversioned production edits (the one host `Caddyfile` should be moved into the
  repo — see backlog).

## Readiness gaps to close before an audit

- Turn on DB-enforced RLS in production (`APP_DB_PASSWORD`).
- Automate off-box backups + a documented, tested restore runbook.
- Add dependency/vulnerability scanning to CI.
- Rotate shared secrets (`SESSION_SECRET`, `SCIM_TOKEN`, `APP_DB_PASSWORD`,
  origin-cert keys) and store them in a secrets manager. Admin access is
  per-user (no static token); deactivate departed staff accounts.
- Formalize an asset inventory, risk register, and access-review cadence.
