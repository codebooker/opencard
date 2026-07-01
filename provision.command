#!/bin/bash
# One-time VM setup: sync the project, install Docker/Portainer, configure the
# firewall, and generate the production .env. Double-click to run (from your Mac).
cd "$(dirname "$0")" || exit 1

CFG="deploy/deploy.config"
if [ ! -f "$CFG" ]; then
  echo "Missing $CFG."
  echo "Copy deploy/deploy.config.example to deploy/deploy.config and fill in your VM details."
  read -n1 -p "Press any key to close..."; exit 1
fi
# shellcheck disable=SC1090
source "$CFG"

RSH="ssh ${SSH_KEY:+-i $SSH_KEY} -o StrictHostKeyChecking=accept-new"
DEST="$VM_USER@$VM_HOST"

echo "==> Ensuring $APP_DIR exists on $DEST"
$RSH "$DEST" "mkdir -p '$APP_DIR'" || { echo "SSH failed — check VM_HOST/VM_USER/SSH_KEY."; read -n1; exit 1; }

echo "==> Syncing project to the VM (secrets and certs are preserved)"
rsync -az --delete -e "$RSH" \
  --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude '.test-build' \
  --exclude 'uploads' --exclude 'deploy/.env' --exclude 'deploy/certs' --exclude 'deploy/deploy.config' \
  ./ "$DEST:$APP_DIR/"

echo "==> Running bootstrap on the VM"
$RSH "$DEST" "cd '$APP_DIR' && APP_DIR='$APP_DIR' bash deploy/bootstrap.sh"

echo
echo "Provision finished. Add your Cloudflare origin cert + DNS, then run deploy.command."
read -n1 -p "Press any key to close..."
