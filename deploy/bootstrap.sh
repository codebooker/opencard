#!/usr/bin/env bash
# Prepare a blank Ubuntu VM for OpenCard. Run ON the VM (as root). Idempotent.
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/opencard}"

echo "==> Installing Docker (if needed)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> Firewall (ufw): allow SSH, HTTP, HTTPS"
if ! command -v ufw >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y ufw
fi
ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow 80/tcp  >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
yes | ufw enable  >/dev/null 2>&1 || true

echo "==> Directories"
mkdir -p "$APP_DIR/deploy/certs"

ENV="$APP_DIR/deploy/.env"
if [ ! -f "$ENV" ]; then
  echo "==> Generating $ENV with random secrets"
  umask 077
  gen() { openssl rand -hex "$1"; }
  cat > "$ENV" <<EOF
# ---- OpenCard production environment ----
APP_URL="https://opencard.id"
CARD_URL="https://tapshare.cards"
PLATFORM_DOMAIN="opencard.id"
SIGNUPS_ENABLED="1"
SEED_DEMO="0"

DB_PASSWORD="$(gen 24)"
APP_DB_PASSWORD="$(gen 24)"
ADMIN_TOKEN="$(gen 32)"
SCIM_TOKEN="$(gen 32)"
SESSION_SECRET="$(gen 32)"

# ---- Stripe (fill in when ready; leave blank to run without checkout) ----
STRIPE_SECRET_KEY=""
STRIPE_PUBLISHABLE_KEY=""
STRIPE_WEBHOOK_SECRET=""
STRIPE_PRICE_TEAM=""
STRIPE_PRICE_DEALER_GROUP=""
STRIPE_PRICE_ENTERPRISE=""

# ---- Azure AD / Entra SSO (optional) ----
AZURE_TENANT_ID=""
AZURE_CLIENT_ID=""
AZURE_CLIENT_SECRET=""
EOF
  echo "    Admin break-glass token (save this): $(grep '^ADMIN_TOKEN' "$ENV" | cut -d'\"' -f2)"
else
  echo "==> $ENV already exists — leaving it untouched"
fi

cat <<NEXT

Bootstrap complete. Next steps:
  1) Create a Cloudflare Origin Certificate covering:
       opencard.id, *.opencard.id, tapshare.cards, *.tapshare.cards
     Save the cert to $APP_DIR/deploy/certs/origin.pem and the key to origin.key
  2) In Cloudflare DNS, point opencard.id and tapshare.cards (and the wildcards)
     at this server's IP, proxied (orange cloud). SSL/TLS mode: Full (strict).
  3) Deploy: double-click deploy.command on your Mac, or on the VM run:
       cd $APP_DIR && docker compose -f deploy/docker-compose.prod.yml up -d --build
NEXT
