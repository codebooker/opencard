# OpenCard

OpenCard is an open-source digital business card application for **one business per installation**. Host it on your own server, use your own domain, and keep the database and uploaded media under your control. [opencard.id](https://opencard.id) is the project website, not a hosted OpenCard account service.

There are no subscriptions, plan tiers, per-card limits, or public organization signup.

## What it does

- Digital business cards with contact download, QR codes, branded designs, and optional printable ID badges.
- Admin management for brands, locations, templates, people, cards, QR assets, leads, analytics, and audit history.
- Self-service card editing for cardholders, with field-level admin controls and Microsoft Entra OIDC or SAML sign-in.
- CSV and directory import, SCIM provisioning, API keys, webhooks, and CRM integrations.
- Local PostgreSQL/upload backups, with a script for Wasabi, Cloudflare R2, AWS S3, or other S3-compatible storage.

Some integrations require credentials from their respective providers; core card creation does not.

## Quick start with Docker

Requirements: Docker with Compose v2, and a hostname plus HTTPS reverse proxy for a public deployment.

1. Copy `.env.example` to `.env`.
2. Set `DB_PASSWORD`, `APP_DB_PASSWORD`, and `SESSION_SECRET` to **different** random values, each generated with `openssl rand -hex 32`. Set `COMPANY_NAME`.
3. Start the stack:

```sh
docker compose up -d --build
docker compose exec web node dist/scripts/make-admin.js you@example.com "Your Name"
```

The second command prints a one-time password. Open `http://localhost:3000/admin`, sign in, change that password, and create your first brand, location, and card. A new installation has no demo cards.

The default web port binds to localhost only. For a public site, use the included optional Caddy profile or your own HTTPS proxy; see [the deployment guide](deploy/README.md). Set `APP_URL` to your actual app origin so card links and authentication callbacks are correct. Set `SOURCE_URL` to your own repository if you publish a modified version.

The default route opens the admin dashboard. Employees use `/me` once SSO is configured. Public cards use `/c/<slug>`. There is no SaaS landing page inside the app.

## Backups

Owners can make a local snapshot and restore workspace content from Admin → Backups. For complete disaster recovery, run `bash deploy/backup.sh` on the host; it captures both PostgreSQL and uploaded files. Configure optional S3-compatible offsite copies in gitignored `deploy/backup.env`. See [backup and restore instructions](deploy/README.md#backups-and-offsite-copies).

## Existing databases

The single-workspace migration deliberately stops if it finds more than one organization. It does not merge or delete anyone's data. Back up the database and uploads before upgrading, then export/migrate each organization separately if needed. An existing one-company database keeps its content; legacy platform accounts are converted to local owners.

## Development

Node.js 24 and PostgreSQL 16 match the Docker images. Install dependencies with `npm ci`, create a local PostgreSQL database, set `DATABASE_URL` and `SESSION_SECRET`, apply migrations with `npx prisma migrate deploy`, then run `npm run dev`. For parity with production, use the least-privilege database role described in the deployment guide. `npm test` runs the unit suite; `npm run build` type-checks and compiles the app.

`SEED_DEMO=1 npm run seed` inserts sample data for a disposable development database. Never enable demo seeding on a production installation.

## License and contribution

OpenCard is licensed under [GNU AGPL-3.0-only](LICENSE). If you run a modified version for network users, point `SOURCE_URL` at the corresponding source. Contributions and issue reports are welcome through [GitHub](https://github.com/codebooker/opencard).
