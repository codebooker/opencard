#!/usr/bin/env bash
# Local PostgreSQL + uploads backup for the Compose deployment.
# Optional offsite copy to Wasabi, R2, AWS S3 or another S3-compatible service.
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$APP_DIR/backups"
KEEP_LOCAL_DAYS="${KEEP_LOCAL_DAYS:-7}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if ! [[ "$KEEP_LOCAL_DAYS" =~ ^[0-9]+$ ]]; then
  echo "KEEP_LOCAL_DAYS must be a non-negative integer" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cd "$APP_DIR"

DB_FILE="$BACKUP_DIR/db-$STAMP.dump"
UPLOADS_FILE="$BACKUP_DIR/uploads-$STAMP.tar.gz"
DB_TEMP="$(mktemp "$BACKUP_DIR/.db-XXXXXX")"
UPLOADS_TEMP="$(mktemp "$BACKUP_DIR/.uploads-XXXXXX")"
trap 'rm -f -- "$DB_TEMP" "$UPLOADS_TEMP"' EXIT

echo "Creating database snapshot..."
docker compose exec -T db pg_dump -U opencard -Fc opencard > "$DB_TEMP"
echo "Archiving uploaded files..."
docker compose exec -T web tar -czf - -C /app/uploads . > "$UPLOADS_TEMP"

chmod 600 "$DB_TEMP" "$UPLOADS_TEMP"
mv -- "$DB_TEMP" "$DB_FILE"
mv -- "$UPLOADS_TEMP" "$UPLOADS_FILE"
echo "Local backup: $DB_FILE and $UPLOADS_FILE"

if [ -f "$APP_DIR/deploy/backup.env" ]; then
  # shellcheck disable=SC1091
  source "$APP_DIR/deploy/backup.env"
fi

if [ -n "${S3_BUCKET:-}" ]; then
  command -v rclone >/dev/null 2>&1 || { echo "Install rclone for offsite backups." >&2; exit 1; }
  [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ] || {
    echo "S3 credentials are required when S3_BUCKET is set." >&2; exit 1;
  }
  [[ "$S3_BUCKET" =~ ^[a-zA-Z0-9._-]+$ ]] || { echo "Invalid S3_BUCKET." >&2; exit 1; }

  export RCLONE_CONFIG_OFFSITE_TYPE=s3
  export RCLONE_CONFIG_OFFSITE_PROVIDER="${S3_ENDPOINT:+Other}"
  RCLONE_CONFIG_OFFSITE_PROVIDER="${RCLONE_CONFIG_OFFSITE_PROVIDER:-AWS}"
  export RCLONE_CONFIG_OFFSITE_PROVIDER
  export RCLONE_CONFIG_OFFSITE_ENDPOINT="${S3_ENDPOINT:-}"
  export RCLONE_CONFIG_OFFSITE_REGION="${S3_REGION:-}"
  export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID"
  export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_OFFSITE_ENV_AUTH=false
  export RCLONE_S3_NO_CHECK_BUCKET=true

  echo "Copying both files to S3 bucket $S3_BUCKET..."
  rclone copyto "$DB_FILE" "offsite:$S3_BUCKET/db/$(basename "$DB_FILE")" --no-traverse
  rclone copyto "$UPLOADS_FILE" "offsite:$S3_BUCKET/uploads/$(basename "$UPLOADS_FILE")" --no-traverse
  echo "Offsite backup complete."
fi

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime +"$KEEP_LOCAL_DAYS" -delete
echo "Backup complete."
