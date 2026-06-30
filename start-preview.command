#!/bin/bash
# Double-click to launch the OpenCard preview with OrbStack/Docker.
cd "$(dirname "$0")" || exit 1

# Create .env with local random secrets on first run.
if [ ! -f .env ]; then
  umask 077
  DB_PASSWORD="$(openssl rand -hex 24)"
  ADMIN_TOKEN="$(openssl rand -hex 32)"
  SCIM_TOKEN="$(openssl rand -hex 32)"
  SESSION_SECRET="$(openssl rand -hex 32)"
  cat > .env <<EOF
DATABASE_URL="postgresql://opencard:${DB_PASSWORD}@localhost:5432/opencard?schema=public"
BASE_URL="http://localhost:3000"
PORT="3000"
ADMIN_TOKEN="${ADMIN_TOKEN}"
SCIM_TOKEN="${SCIM_TOKEN}"
SESSION_SECRET="${SESSION_SECRET}"
DB_PASSWORD="${DB_PASSWORD}"
AZURE_TENANT_ID=""
AZURE_CLIENT_ID=""
AZURE_CLIENT_SECRET=""
SELF_SERVICE_DEV_LOGIN="0"
EOF
  echo "Created .env with random local preview secrets."
  echo "Admin token for this preview: ${ADMIN_TOKEN}"
fi

echo "Building and starting OpenCard preview..."
echo "When it's up, open http://localhost:3000/admin"
echo "----------------------------------------------------"
docker compose up --build
