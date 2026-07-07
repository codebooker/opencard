# Migrating OpenCard to a new Hetzner VM (restore from Wasabi)

This is the "the server died, rebuild from offsite backup" runbook — also the
right procedure for moving to the new CX33. It stands up a fresh box and
restores the database + uploads from the Wasabi backup, rather than copying the
old box directly, so it doubles as a real disaster-recovery drill.

Old box: `89.167.46.237`  →  New box: **CX33** (`<NEW_IP>`).

---

## 0. Before you start — the one thing you must not regenerate

`SESSION_SECRET` does two jobs: it signs admin/employee sessions **and** it is
the key that encrypts CRM tokens and webhook secrets at rest (SEC-06). If the
new box gets a *fresh* `SESSION_SECRET`, every sealed integration secret becomes
undecryptable and every session is invalidated. **Carry the old `deploy/.env`
over verbatim** (Step 3) — do not run a fresh secret generator on the new box.

Everything else in `.env` (`DB_PASSWORD`, `APP_DB_PASSWORD`) can technically be
new, but copying the whole file is simplest and safest.

---

## 1. Create the CX33 with cloud-init

In Hetzner Cloud Console → **Add Server**:

- Location: your current region, Image: **Ubuntu 24.04**, Type: **CX33**.
- **SSH Keys:** add your public key (so you can log in).
- **Cloud config:** paste the contents of `deploy/cloud-init.yaml`.
- Create. Give it ~2–3 min, then confirm bootstrap finished:

```bash
ssh root@<NEW_IP> 'cat /opt/opencard/.ready && docker --version && docker compose version'
```

## 2. Sync the app code to the new box

From your Mac, point deploy at the new IP and push the code (secrets/certs are
excluded by the deploy excludes, so this is safe to run before Step 3):

```bash
# edit deploy/deploy.config: VM_HOST="<NEW_IP>"
# then, from the project root:
rsync -az --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude '.test-build' \
  --exclude 'uploads' --exclude 'deploy/.env' --exclude 'deploy/certs' --exclude 'deploy/deploy.config' \
  --exclude 'deploy/backup.env' --exclude '/Caddyfile' --exclude '/certs' \
  ./ root@<NEW_IP>:/opt/opencard/
```

## 3. Carry over the host-managed secrets + certs from the OLD box

These live outside the repo and must be copied machine-to-machine:

```bash
# run from your Mac; streams old -> new without landing on your laptop
ssh root@89.167.46.237 'tar -czf - \
  -C /opt/opencard deploy/.env deploy/backup.env Caddyfile \
  -C /opt/opencard certs' \
| ssh root@<NEW_IP> 'tar -xzf - -C /opt/opencard'
```

That brings over: `deploy/.env` (incl. `SESSION_SECRET`), `deploy/backup.env`
(Wasabi creds + heartbeat), `Caddyfile`, and `certs/` (the Cloudflare origin
certs Caddy serves). Confirm on the new box:

```bash
ssh root@<NEW_IP> 'ls -l /opt/opencard/certs && grep -c SESSION_SECRET /opt/opencard/deploy/.env'
```

## 4. Pull the latest backup from Wasabi (on the new box)

```bash
ssh root@<NEW_IP>
cd /opt/opencard
set -a; . deploy/backup.env; set +a          # loads S3_* + AWS_* creds

# rclone talks to Wasabi with the same config the nightly backup uses
command -v rclone >/dev/null || { curl -fsSL https://rclone.org/install.sh | bash; }
export RCLONE_CONFIG_OFFSITE_TYPE=s3 RCLONE_CONFIG_OFFSITE_PROVIDER=Other \
  RCLONE_CONFIG_OFFSITE_ENDPOINT="$S3_ENDPOINT" \
  RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  RCLONE_S3_NO_CHECK_BUCKET=true

# newest db dump + matching uploads tarball
LATEST_DB=$(rclone lsf "offsite:$S3_BUCKET/db/" | sort | tail -1)
LATEST_UP=$(rclone lsf "offsite:$S3_BUCKET/uploads/" | sort | tail -1)
echo "restoring: $LATEST_DB  +  $LATEST_UP"
mkdir -p /opt/opencard/restore
rclone copy "offsite:$S3_BUCKET/db/$LATEST_DB"     /opt/opencard/restore/ --no-traverse
rclone copy "offsite:$S3_BUCKET/uploads/$LATEST_UP" /opt/opencard/restore/ --no-traverse
ls -lh /opt/opencard/restore/
```

Sanity-check the dump is a real PostgreSQL custom archive before trusting it —
the first five bytes are the `PGDMP` magic:

```bash
head -c5 /opt/opencard/restore/"$LATEST_DB"; echo   # -> PGDMP
```

## 5. Bring up Postgres only, then restore into it

```bash
DC="docker compose -f deploy/docker-compose.prod.yml"
$DC up -d db
# wait for it to accept connections
until $DC exec -T db pg_isready -U opencard >/dev/null 2>&1; do sleep 1; done

# restore the dump (matching pg_restore 16 lives inside the postgres:16 container)
cat /opt/opencard/restore/"$LATEST_DB" \
| $DC exec -T db pg_restore -U opencard -d opencard --clean --if-exists --no-owner

# quick integrity check
$DC exec -T db psql -U opencard -d opencard -c \
  "select (select count(*) from \"Org\") orgs, (select count(*) from \"Card\") cards, (select count(*) from \"Lead\") leads;"
```

Then restore uploads into the uploads volume:

```bash
UP_MNT=$(docker volume inspect opencard_uploads_data -f '{{.Mountpoint}}')
tar -xzf /opt/opencard/restore/"$LATEST_UP" -C "$UP_MNT"
ls "$UP_MNT" | head
```

## 6. Start the full stack + verify (still on the new box, before DNS)

```bash
cp deploy/Caddyfile Caddyfile               # host copy Caddy binds by abs path
$DC up -d --build
$DC ps
# app answers locally (and reports RLS enforced)
curl -s localhost:3000/healthz              # -> {"ok":true,"rlsEnforced":true}
```

Because Cloudflare still points at the old box, you can smoke-test the new one
by its IP with a Host header before cutting over:

```bash
curl -s -k -H 'Host: tapshare.cards' https://<NEW_IP>/c/<a-known-card-slug> -o /dev/null -w '%{http_code}\n'
```

## 7. Cut over DNS

In Cloudflare, change the A records for `opencard.id`, `*.opencard.id`,
`tapshare.cards`, `*.tapshare.cards` from `89.167.46.237` → `<NEW_IP>` (keep
them **proxied / orange cloud**, SSL/TLS **Full (strict)**). Propagation is
seconds-to-minutes since Cloudflare fronts it. Watch:

```bash
watch -n5 'curl -s https://opencard.id/healthz'
```

## 8. Re-point deploys, backups, and decommission the old box

- Update `deploy/deploy.config` `VM_HOST` to `<NEW_IP>` permanently (and the
  GitHub Actions self-hosted runner, if you use push-to-deploy — re-register it
  on the new box).
- Re-add the nightly backup cron on the new box (it was host cron, not in the
  repo):
  ```bash
  ssh root@<NEW_IP> 'crontab -l 2>/dev/null; echo "30 3 * * * cd /opt/opencard && bash deploy/backup.sh >> /var/log/opencard-backup.log 2>&1" | crontab -'
  ```
- Leave the OLD box running a few days as a fallback, then power it off /
  delete once the new box has taken a clean nightly backup of its own.

---

### Rollback

If anything looks wrong after Step 7, revert the Cloudflare A records to
`89.167.46.237`. The old box is untouched by this procedure, so rollback is
instant.
