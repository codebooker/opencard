#!/bin/bash
# Double-click to launch the OpenCard preview with OrbStack/Docker.
cd "$(dirname "$0")" || exit 1

# Create .env from the example on first run.
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example (edit it to set real tokens)."
fi

echo "Building and starting OpenCard preview..."
echo "When it's up, open http://localhost:3000/admin"
echo "----------------------------------------------------"
docker compose up --build
