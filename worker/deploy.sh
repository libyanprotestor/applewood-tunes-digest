#!/usr/bin/env bash
# One-command deploy for the delivery worker on a fresh Ubuntu VPS.
# Usage:  bash deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Missing .env — copy .env.example to .env and fill it in first." >&2
  exit 1
fi

if [ ! -f transporter.tar.gz ]; then
  echo "Missing transporter.tar.gz — download Apple's iTMSTransporter for Linux and place it here." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
fi

echo "Building image..."
docker build -t delivery-worker .

echo "Restarting container..."
docker rm -f delivery-worker >/dev/null 2>&1 || true
docker run -d --restart=always --env-file .env --name delivery-worker delivery-worker

echo
echo "Worker is running. Follow the logs with:"
echo "  docker logs -f delivery-worker"
