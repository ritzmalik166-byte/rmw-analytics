#!/usr/bin/env bash
# Deploys the analytics backend on the droplet. Installed at /var/www/deploy-analytics.sh and run by
# .github/workflows/backend.yml over SSH. Safe to run by hand too.
set -euo pipefail

APP_DIR=/var/www/rmw-analytics
PM2_NAME=analytics-api
BRANCH=main

echo "==> Deploying RMW Analytics ($(date -u +%FT%TZ))"
cd "$APP_DIR"

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
echo "==> At commit $(git log -1 --format='%h %s')"

cd backend
[ -f .env ] || { echo "!! backend/.env is missing - aborting"; exit 1; }
npm ci --no-audit --no-fund
npm run build          # rebuilds tracker/dist (tracker.js served to websites)
# Database migrations run on API start (AUTO_MIGRATE=true).

pm2 restart "$PM2_NAME" --update-env
pm2 save

PORT=$(grep -E '^PORT=' .env | cut -d= -f2 | tr -d '"\r' || true)
PORT=${PORT:-4100}
for i in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null; then echo "==> Healthy on :${PORT}"; exit 0; fi
  sleep 2
done
echo "!! ${PM2_NAME} did not become healthy - last logs:"
pm2 logs "$PM2_NAME" --lines 40 --nostream
exit 1
