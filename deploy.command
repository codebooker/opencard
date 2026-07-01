#!/bin/bash
# Deploy the latest code to the VM: sync, build, and (re)start the containers.
# Double-click to run (from your Mac). Run provision.command once first.
cd "$(dirname "$0")" || exit 1

CFG="deploy/deploy.config"
if [ ! -f "$CFG" ]; then
  echo "Missing $CFG. Run provision.command first (and copy deploy/deploy.config.example)."
  read -n1 -p "Press any key to close..."; exit 1
fi
# shellcheck disable=SC1090
source "$CFG"

RSH="ssh ${SSH_KEY:+-i $SSH_KEY} -o StrictHostKeyChecking=accept-new"
DEST="$VM_USER@$VM_HOST"
COMPOSE="docker compose -f deploy/docker-compose.prod.yml"

echo "==> Syncing project to $DEST:$APP_DIR"
$RSH "$DEST" "mkdir -p '$APP_DIR'" || { echo "SSH failed — check deploy.config."; read -n1; exit 1; }
rsync -az --delete -e "$RSH" \
  --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude '.test-build' \
  --exclude 'uploads' --exclude 'deploy/.env' --exclude 'deploy/certs' --exclude 'deploy/deploy.config' \
  ./ "$DEST:$APP_DIR/"

echo "==> Building & starting containers (this can take a minute)"
$RSH "$DEST" "cd '$APP_DIR' && $COMPOSE up -d --build && echo '--- status ---' && $COMPOSE ps"

echo
echo "Deploy complete. App: https://opencard.id  Cards: https://tapshare.cards"
read -n1 -p "Press any key to close..."
