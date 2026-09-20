# Self-host OpenCard with Docker Compose

This stack runs one company workspace: PostgreSQL, the OpenCard app, and an optional Caddy HTTPS proxy. There is no public signup, subscription service, or card limit.

## First boot

1. Install Docker Engine/Desktop with Compose v2 and clone this repository.
2. Copy `.env.example` to `.env`. Set **three different random values** for `DB_PASSWORD`, `APP_DB_PASSWORD`, and `SESSION_SECRET` (for example, run `openssl rand -hex 32` three times). Set `COMPANY_NAME`.
3. Run `docker compose up -d --build`. The container applies committed migrations, provisions the least-privilege database role, creates the one workspace, and starts the app. Check `docker compose ps` and `docker compose logs web`.
4. Create your first owner account with `docker compose exec web node dist/scripts/make-admin.js you@example.com "Your Name"`. The command prints a one-time password. Sign in at `http://localhost:3000/admin` and change it.
5. Create a brand, location, and card. Configure employee sign-in under Integrations if you want people to edit their own cards.

The web port binds to `127.0.0.1` by default. To serve users on your network, put a reverse proxy in front of it or deliberately change `BIND_ADDRESS`. Do not expose an HTTP login to the public internet.

## HTTPS with included Caddy

Point a hostname you control (for example `cards.example.com`) at the server. Set `APP_DOMAIN=cards.example.com`, `APP_URL=https://cards.example.com`, and `TRUST_PROXY_HOPS=1` in `.env`. Open ports 80 and 443, then run:

```sh
docker compose --profile proxy up -d --build
```

Caddy manages certificates. Card links use `APP_URL` unless you set `CARD_URL` for a separate card-serving host. Additional branded login domains are configured in Admin → Domains and must resolve to the same server. Set `TENANTS_CNAME_TARGET` if the default `APP_URL` hostname is not the right CNAME target; set `SERVER_IPS` to any public A-record IPs you also want the verifier to accept.

If you already operate a proxy, leave the Caddy profile off, proxy to `127.0.0.1:3000`, set `APP_URL` to the actual HTTPS origin, and set `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops.

## Backups and offsite copies

The database lives in the `db_data` Docker volume; uploaded images live in `uploads_data`. Neither is part of Git. Manual snapshots and workspace-content restores are available to owners under Admin → Backups. The snapshot files are stored in the gitignored `./backups` directory. To have a manual snapshot copied offsite when an owner clicks **Create backup now**, set `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optionally `S3_ENDPOINT`/`S3_REGION` in `.env`, then recreate the web container. The Backups page shows whether an offsite destination is configured; it never displays credentials.

For a **complete** recoverable backup (database plus uploads), run `bash deploy/backup.sh` on the Docker host. Schedule that command with your host's cron or systemd timer. The script keeps seven days of local copies by default (`KEEP_LOCAL_DAYS` in `deploy/backup.env`).

To copy each run offsite, install `rclone` on the host, copy `deploy/backup.env.example` to gitignored `deploy/backup.env`, and fill in `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and (for Wasabi, R2, or another S3-compatible provider) `S3_ENDPOINT`. `S3_REGION` is optional. The script uploads to `db/` and `uploads/` in the named bucket; it never deletes remote objects. Test a complete restore before relying on the backup.

For disaster recovery, start with a fresh PostgreSQL/Uploads volume and the matching application version. Restore the `db-*.dump` with `pg_restore` and extract the matching `uploads-*.tar.gz` into the uploads volume **before** starting the app; then let migrations run. Do not restore a dump over a live database or delete existing volumes without first making another backup. Keep a secure copy of the original `SESSION_SECRET`: it is also used to decrypt integration credentials.

## Upgrading from an older OpenCard database

The single-workspace migration refuses to run if more than one organization exists. It does not delete or merge client data. Export each company separately and plan a deliberate migration before upgrading that database. Single-company databases retain their cards and users; legacy platform admin roles are converted to local owners. Take a database and uploads backup before upgrading.

## Operational notes

- `SEED_DEMO=0` is the default. Set it to `1` only for a disposable demo instance.
- `SELF_SERVICE_DEV_LOGIN=1` enables email-only cardholder impersonation when `SEED_DEMO=1`. Use both only on an isolated disposable install; never on a reachable production host.
- SMTP is optional, but password-reset and invitation emails need working SMTP settings.
- `SOURCE_URL` should point to the actual source of a modified instance, consistent with the AGPL-3.0 license.
- Keep `.env`, `deploy/backup.env`, dumps, and uploads out of public repositories.
