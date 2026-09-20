#!/bin/bash
# Double-click to launch the OpenCard preview with OrbStack/Docker.
cd "$(dirname "$0")" || exit 1

# Create .env with local random secrets on first run.
if [ ! -f .env ]; then
  umask 077
  DB_PASSWORD="$(openssl rand -hex 24)"
  SESSION_SECRET="$(openssl rand -hex 32)"
  APP_DB_PASSWORD="$(openssl rand -hex 24)"
  cat > .env <<EOF
DB_PASSWORD="${DB_PASSWORD}"
APP_DB_PASSWORD="${APP_DB_PASSWORD}"
SESSION_SECRET="${SESSION_SECRET}"
COMPANY_NAME="Preview Company"
APP_URL="http://localhost:3000"
PORT="3000"
SEED_DEMO="0"
EOF
  echo "Created .env with random local preview secrets."
fi

# Upgrade path: existing .env created before RLS needs an app-role password.
if [ -f .env ] && ! grep -q '^APP_DB_PASSWORD=' .env; then
  umask 077
  echo "APP_DB_PASSWORD=\"$(openssl rand -hex 24)\"" >> .env
  echo "Added APP_DB_PASSWORD to .env (enables database-enforced tenant isolation)."
fi
echo "Building and starting OpenCard preview..."
echo "When it's up, open http://localhost:3000/admin"
echo "In another terminal, run: docker compose exec web node dist/scripts/make-admin.js you@example.com"
echo "----------------------------------------------------"
docker compose up --build
