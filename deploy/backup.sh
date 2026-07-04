#!/usr/bin/env bash
# Nightly OpenCard backup: Postgres logical dump + uploads volume tarball.
# Local retention + optional S3-compatible offsite copy (Wasabi/R2/S3).
#
# Offsite: create /opt/opencard/deploy/backup.env with:
#   S3_ENDPOINT="https://s3.us-east-1.wasabisys.com"
#   S3_BUCKET="opencard-backups"
#   AWS_ACCESS_KEY_ID="..."
#   AWS_SECRET_ACCESS_KEY="..."
# Uploads use rclone (auto-installed on first run when backup.env exists).
set -euo pipefail

APP_DIR="/opt/opencard"
BACKUP_DIR="$APP_DIR/backups"
KEEP_LOCAL_DAYS=7
KEEP_REMOTE_DAYS=30
STAMP="$(date +%F_%H%M)"
LOG_PREFIX="[backup $STAMP]"

mkdir -p "$BACKUP_DIR"
cd "$APP_DIR"

echo "$LOG_PREFIX dumping postgres"
docker exec opencard-db-1 pg_dump -U opencard -Fc opencard > "$BACKUP_DIR/db-$STAMP.dump"

echo "$LOG_PREFIX archiving uploads volume"
UPLOADS_PATH="$(docker volume inspect opencard_uploads_data -f '{{.Mountpoint}}' 2>/dev/null || true)"
if [ -n "$UPLOADS_PATH" ] && [ -d "$UPLOADS_PATH" ]; then
  tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$UPLOADS_PATH" .
else
  echo "$LOG_PREFIX uploads volume not found — skipping"
fi

echo "$LOG_PREFIX pruning local copies older than $KEEP_LOCAL_DAYS days"
find "$BACKUP_DIR" -type f \( -name 'db-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime +"$KEEP_LOCAL_DAYS" -delete

# ---- optional offsite copy ----
ENV_FILE="$APP_DIR/deploy/backup.env"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  if [ -n "${S3_ENDPOINT:-}" ] && [ -n "${S3_BUCKET:-}" ]; then
    if ! command -v rclone >/dev/null 2>&1; then
      echo "$LOG_PREFIX installing rclone"
      curl -fsSL https://rclone.org/install.sh | bash >/dev/null
    fi
    export RCLONE_CONFIG_OFFSITE_TYPE=s3
    export RCLONE_CONFIG_OFFSITE_PROVIDER=Other
    export RCLONE_CONFIG_OFFSITE_ENDPOINT="$S3_ENDPOINT"
    export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}"
    export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"
    # The scoped key may not HeadBucket/CreateBucket — just upload.
    export RCLONE_S3_NO_CHECK_BUCKET=true
    echo "$LOG_PREFIX uploading to $S3_BUCKET"
    rclone copy "$BACKUP_DIR/db-$STAMP.dump" "offsite:$S3_BUCKET/db/" --no-traverse
    [ -f "$BACKUP_DIR/uploads-$STAMP.tar.gz" ] && rclone copy "$BACKUP_DIR/uploads-$STAMP.tar.gz" "offsite:$S3_BUCKET/uploads/" --no-traverse
    echo "$LOG_PREFIX pruning remote copies older than $KEEP_REMOTE_DAYS days"
    # Only touch the folders this script owns — never the rest of the bucket.
    rclone delete "offsite:$S3_BUCKET/db" --min-age "${KEEP_REMOTE_DAYS}d" || true
    rclone delete "offsite:$S3_BUCKET/uploads" --min-age "${KEEP_REMOTE_DAYS}d" || true
  fi
else
  echo "$LOG_PREFIX no backup.env — local backup only (offsite disabled)"
fi

echo "$LOG_PREFIX done: $(ls -lh "$BACKUP_DIR" | grep "$STAMP" | awk '{print $9, "("$5")"}' | tr '\n' ' ')"
