# Deployment

One public origin, for example `https://analytics.example.com`, serves everything:

| Path | Goes to |
|---|---|
| `/tracker.js`, `/api/v1/events`, `/api/v1/sites/*` | API (public, cross-origin, no cookies) |
| `/api/v1/*` | API (dashboard; cookie session, same origin) |
| `/api/v1/realtime/stream` | API, Server-Sent Events, **unbuffered** |
| `/docs/` | Static docs |
| everything else | Dashboard (Next.js) |

## Option A — Docker Compose

```bash
cp docker/.env.example docker/.env     # set PUBLIC_URL and the three secrets
docker compose -f docker/docker-compose.yml --env-file docker/.env up -d --build
docker compose -f docker/docker-compose.yml logs -f api worker
```

This starts MongoDB 7 (single-node replica set, auto-initiated), Redis 7, the API (migrations on start),
one worker, the dashboard and nginx on `HTTP_PORT` (8080). Put TLS in front, using a load balancer, Caddy, or
certbot with `infrastructure/nginx/analytics.conf`. Then open the site and create the first owner account.
Self-service sign-up closes automatically after the first user.

Scale the API horizontally with `docker compose up -d --scale api=3`. Redis keeps realtime presence, the live
feed and per-website quotas consistent across instances. Run one or more workers; a MongoDB lease lock ensures
each job runs on one instance at a time.

## Option B — VM with PM2

```bash
git clone … && cd analytics-platform
npm ci
cp apps/api/.env.example apps/api/.env       # production values, see below
npm run build:tracker
npm run build -w @rmw-analytics/dashboard
DOCS_BASE_PATH=/docs npm run build -w @rmw-analytics/docs && sudo cp -r apps/docs/out /var/www/analytics-docs
npm run migrate
pm2 start infrastructure/pm2/ecosystem.config.cjs && pm2 save && pm2 startup
sudo cp infrastructure/nginx/analytics.conf /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
npm run create-owner -w @rmw-analytics/api -- --email you@company.com --name "Your Name" --org "Your Org"   # password via OWNER_PASSWORD
```

## MongoDB

- Use **MongoDB Atlas** (M10+) or a 3-member replica set. Set `MONGODB_URI` with TLS and credentials, for example `mongodb+srv://user:pass@cluster/…`.
- Collections, JSON-schema validators and all indexes are created idempotently by `npm run migrate` (or `AUTO_MIGRATE=true` on API start).
- **Retention** uses TTL indexes on `expireAt`. Each document's expiry comes from its website's `retentionDays`; changes are re-applied by the worker.
- **High volume:** shard `events`, `page_views` and `sessions` on `{ websiteId: "hashed", ts: 1 }` (or `startedAt`). Dashboards read daily rollups (`agg_daily*`) for multi-day ranges, so raw-collection scans are limited to today, realtime, journeys, funnels and the explorer.
- **Backups:** Atlas continuous backup, or `mongodump` plus point-in-time oplog. Back up `PII_ENCRYPTION_KEY` separately; without it, lead data cannot be decrypted.

## Production environment checklist (`apps/api/.env`)

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` |
| `PUBLIC_API_URL`, `APP_URL`, `DASHBOARD_ORIGINS` | `https://analytics.example.com` |
| `SESSION_SECRET`, `PII_ENCRYPTION_KEY`, `IDENTITY_HASH_SECRET` | 32+ random bytes each, from a secrets manager |
| `COOKIE_SECURE` | `true` |
| `TRUST_PROXY` | the number of proxies in front of the API (nginx = 1; load balancer + nginx = 2) |
| `REDIS_URL` | required with more than one API instance |
| `RUN_JOBS_IN_PROCESS` | `false` on API instances; run `npm run worker` separately |
| `ALLOW_SIGNUP` | `false` |
| `GEOIP_DB_PATH` | path to `GeoLite2-City.mmdb` (free MaxMind licence). Otherwise CDN geo headers are used (Cloudflare: enable *Add visitor location headers*) |
| `SMTP_*` | for alert emails, invites and scheduled reports |

## Operations

- `GET /health` reports database latency; use it for load-balancer checks.
- Logs are JSON (pino) on stdout, with secrets and PII redacted. Ship them to your log stack.
- Ingestion, the tracker and SSE are excluded from access logs to keep volume down; errors are always logged.
- Rotate a website's server key from *Websites → Server-side API*. Rotate dashboard secrets by deploying new values. Changing `SESSION_SECRET` signs everyone out. **Never** change `PII_ENCRYPTION_KEY` without re-encrypting existing leads.
- The tracker is served with a 1-hour cache and `stale-while-revalidate`. A deploy reaches visitors within the hour.

## Security hardening

- Keep the API off the public internet except through nginx. Restrict MongoDB and Redis to the private network.
- Enable HSTS (already in `infrastructure/nginx/analytics.conf`).
- The dashboard sets `X-Frame-Options: DENY`; the API sets a restrictive CSP and helmet defaults.
- Review the audit log (*Settings → Audit log*) for `pii.viewed`, `report.exported` and `visitor.deleted`.
