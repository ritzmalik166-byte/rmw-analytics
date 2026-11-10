# RMW Analytics — Architecture & Implementation Plan

Universal website analytics and visitor intelligence: one `<script>` tag on any website sends
events to a central API; everything is viewed in one dashboard.

```
CREATE WEBSITE → GET SCRIPT → PASTE ON SITE → tracker.js → POST /api/v1/events
      → validate · enrich (UA, geo) · dedupe → MongoDB → rollups → dashboard (REST + SSE live)
```

Stack: **Node.js 20+ (plain JavaScript, ESM)**, **Express**, **MongoDB 7** (replica set), optional
**Redis** (realtime fan-out, distributed rate limits), **Next.js 15 (JavaScript)** + Tailwind +
Radix/shadcn primitives + Recharts for the dashboard. Visual design follows RMW-CRM: navy header with
saffron rule, white grouped sidebar, compact 13px density, hairline borders, minimal shadow.

---

## 1. Monorepo layout

```
analytics-platform/
├── apps/
│   ├── api/          Express API: ingestion, dashboard REST, SSE, workers (rollups, alerts, reports)
│   ├── dashboard/    Next.js dashboard (RMW-CRM design system)
│   └── docs/         Next.js static docs site (SDK + API reference)
├── packages/
│   ├── tracker/      tracker.js SDK (vanilla JS → esbuild IIFE, ~9 KB brotli / ~10 KB gzip)
│   ├── shared/       event names, zod schemas, PII redaction, channel/referrer classification
│   └── types/        JSDoc typedefs (editor IntelliSense without TypeScript)
├── database/         collection specs, indexes, JSON-schema validators, migration runner
├── docker/           Dockerfiles + docker-compose (mongo rs, redis, api, worker, dashboard, nginx)
├── infrastructure/   nginx config, PM2 ecosystem, production deployment guide
└── docs/             this file
```

npm workspaces; no build step for shared code (ESM source consumed directly; Next.js uses
`transpilePackages`). Only the tracker is bundled.

## 2. Components

| Component | Responsibility |
|---|---|
| **tracker.js** | Visitor/session IDs, auto events, SPA routing, batching queue, beacon/fetch transport, offline queue, consent, sampling, public API (`analytics.*`) |
| **Ingest API** `POST /api/v1/events` | Auth (site ID + Origin allowlist, or secret key/HMAC for server-side), validation, bot filter, rate limit, enrichment (UA → device, IP → geo then IP discarded), dedupe, bulk writes, realtime publish |
| **Dashboard API** `/api/v1/*` | Cookie-session auth, org/role RBAC, stats queries, visitor explorer, leads (PII decrypt by permission), funnels, alerts, reports/exports, website management, audit log |
| **Realtime** | Active visitors + live feed. Redis pub/sub + sorted sets when `REDIS_URL` is set; in-process fallback for single-instance. Delivered to the browser via **SSE** |
| **Worker** (`npm run worker`) | Daily rollups (every minute for today), alert evaluation, scheduled reports, maintenance. Mongo-based leader lock so only one instance runs each job |

## 3. Event schema

Wire format (tracker → API) is a **batch envelope**; shared context is sent once per batch:

```json
{
  "siteId": "site_8f2a91c3",
  "v": 1,
  "sentAt": 1794321000000,
  "ctx": { "vid": "v_8f92a13c4e7b11aa", "sid": "s_lx2k9a_72819", "lang": "en-IN", "tz": "Asia/Kolkata",
           "sw": 1920, "sh": 1080, "vw": 1440, "vh": 820, "online": true, "consent": "granted" },
  "events": [
    { "id": "e_…", "n": "page_view", "t": 1794320999000,
      "p": { "u": "https://x.com/properties?q=1", "pa": "/properties", "ti": "Properties", "r": "https://google.com/" },
      "pr": { } }
  ]
}
```

Stored (normalized) event document — matches the product spec structure:

```json
{
  "websiteId": "ObjectId", "siteId": "site_8f2a91c3", "eventId": "e_…",
  "visitorId": "v_8f92a13c4e7b11aa", "sessionId": "s_lx2k9a_72819",
  "name": "page_view", "ts": "2026-11-10T14:30:00Z", "receivedAt": "…",
  "page": { "url": "…", "path": "/properties", "title": "Properties", "referrer": "…" },
  "device": { "type": "desktop", "browser": "Chrome", "os": "Windows" },
  "geo": { "country": "IN", "region": "Delhi", "city": "Noida" },
  "channel": "organic_search",
  "props": {},
  "expireAt": "…retention…"
}
```

**Event catalogue** (`packages/shared/src/events.js`):
`session_start, page_view, route_change, page_leave (engagement: active ms, max scroll), click,
scroll (25/50/75/90/100), outbound_click, file_download, video_play, video_pause, video_complete,
form_view, form_start, form_submit, form_error, search, js_error, rage_click, dead_click,
visibility_hidden, identify, lead, conversion` + any custom name matching `^[a-z0-9_.:-]{1,64}$`.

Limits: ≤ 50 events/batch, ≤ 64 KB body, ≤ 30 props/event, prop strings ≤ 500 chars, timestamps within
`[-24h, +5min]` of server time.

## 4. Data model (MongoDB)

All analytics documents carry `websiteId` first in every index (tenant isolation + selectivity) and an
`expireAt` date driving a **TTL index**, so each website's retention (`settings.retentionDays`) is
enforced by Mongo itself without batch deletes.

| Collection | Key fields | Indexes |
|---|---|---|
| `organizations` | name, slug, settings | slug ↑ unique |
| `users` | email, passwordHash, fullName, isActive | email unique |
| `memberships` | orgId, userId, role (`owner/admin/analyst/viewer`) | {orgId,userId} unique |
| `auth_sessions` | tokenHash, userId, expiresAt | tokenHash unique, expiresAt TTL |
| `websites` | siteId, orgId, name, code, domain, allowedOrigins, settings, lastEventAt | siteId unique, orgId |
| `tracking_keys` | websiteId, kind (`secret`), prefix, hash, revokedAt, lastUsedAt | hash unique |
| `visitors` | websiteId, visitorId, firstSeen, lastSeen, first{…attribution}, last{device,geo}, counts{}, identityId | {websiteId,visitorId} unique; {websiteId,lastSeen}; identityId |
| `sessions` | websiteId, sessionId, visitorId, startedAt, lastSeenAt, durationMs, activeMs, pageviews, events, entryPath, exitPath, referrer, channel, utm{}, device{}, geo{}, isNew, converted | {websiteId,sessionId} unique; {websiteId,startedAt}; {websiteId,visitorId,startedAt}; {websiteId,lastSeenAt} |
| `events` (raw) | see §3 | {websiteId,eventId} unique (dedupe); {websiteId,ts}; {websiteId,name,ts}; {websiteId,visitorId,ts}; {websiteId,sessionId,ts}; expireAt TTL |
| `page_views` | websiteId, pageviewId, ts, sessionId, visitorId, path, title, engagedMs, maxScroll | {websiteId,pageviewId} unique; {websiteId,ts}; {websiteId,path,ts} |
| `searches` | websiteId, ts, query, normalized, category, filters, path, visitorId, sessionId | {websiteId,ts}; {websiteId,normalized,ts} |
| `forms` | websiteId, formKey, name, path, counts{views,starts,submits,errors} | {websiteId,formKey} unique |
| `form_submissions` | websiteId, formKey, ts, fieldNames, fieldsEnc (allowlisted only), leadId | {websiteId,ts} |
| `leads` | websiteId, orgId, ts, pii (AES-256-GCM), emailHash, phoneTail, city, attribution{channel,referrer,utm,landingPage,lastSearch}, status | {websiteId,ts}; {orgId,ts}; emailHash |
| `conversions` | websiteId, ts, goal, value, currency, visitorId, sessionId | {websiteId,ts}; {websiteId,goal,ts} |
| `campaigns` | websiteId, source, medium, campaign, firstSeen, lastSeen, sessions, conversions | {websiteId,source,medium,campaign} unique |
| `funnels` | orgId, websiteId?, name, steps[{type:event\|path, match, label}], windowHours | orgId |
| `visitor_identities` | orgId, externalHash (HMAC), externalEnc, traitsEnc, links[{websiteId,visitorId,at}] | {orgId,externalHash} unique |
| `heatmap_points` | websiteId, path, ts, kind (click/rage/dead), x (‰ of width), y (px), vwBucket, selector | {websiteId,path,ts} |
| `agg_daily` | websiteId, day, visitors, newVisitors, sessions, pageviews, bounces, durationMs, events, searches, formSubmits, leads, conversions, errors | {websiteId,day} unique |
| `agg_daily_pages` | websiteId, day, path, pageviews, visitors, entries, exits, engagedMs | {websiteId,day,path} unique |
| `agg_daily_dims` | websiteId, day, dim, value, sessions, visitors, pageviews, conversions | {websiteId,day,dim,value} unique |
| `alerts` / `alert_events` | rule definition / fired history | orgId |
| `audit_logs` | orgId, userId, action, target, meta, ts | {orgId,ts} |
| `report_schedules` | orgId, websiteId, frequency, recipients | orgId |
| `job_locks` | _id job name, owner, until | — |

**Raw vs aggregated.** Raw `events` are the source of truth (journeys, visitor explorer, custom
event queries). `agg_daily*` are recomputed idempotently by the worker (`$group` + `$merge`) for today
and yesterday every minute; dashboards read rollups for multi-day ranges and raw/sessions for
"today"/realtime. Unique visitors across a range always come from `sessions` (exact distinct), never by
summing daily uniques.

**Scale.** Writes are `bulkWrite(ordered:false)`; the unique `eventId` index makes retries idempotent.
For very high volume: shard `events`/`page_views` on `{websiteId: 1, ts: 1}` (hashed `websiteId` prefix
to avoid hot shards), and move cold data via TTL + optional Atlas Online Archive.

## 5. API endpoints

Envelope: `{ success, data, message?, errorCode? }` (same as RMW-CRM).

**Public / ingestion**
- `GET  /tracker.js` — the SDK (immutable cache via ETag; `Cache-Control: public, max-age=3600`)
- `POST /api/v1/events` — batch ingest. Browser: `text/plain` JSON (no CORS preflight), `?z=1` = gzip body.
  Server-to-server: `Authorization: Bearer sk_…` or `X-Signature: t=…,v1=HMAC_SHA256(secret, t.body)`.
- `GET  /api/v1/sites/:siteId/config` — public tracker config (consent mode, heatmaps, sampling…)
- `GET  /health`

**Auth & org** — `POST /auth/register` (if `ALLOW_SIGNUP`), `POST /auth/login`, `POST /auth/logout`,
`GET /auth/me`, `GET/POST/PATCH/DELETE /org/members`, `GET /org/audit-logs`

**Websites** — `GET/POST /websites`, `GET/PATCH/DELETE /websites/:id`, `GET /websites/:id/status`
(installation check), `POST /websites/:id/keys` (rotate secret key)

**Analytics** (all take `site=all|<websiteId>&from&to`) —
`/stats/overview`, `/stats/timeseries`, `/stats/pages`, `/stats/sources`, `/stats/campaigns`,
`/stats/geo`, `/stats/devices?dim=device|browser|os`, `/stats/events`, `/stats/searches`, `/stats/forms`,
`/stats/journeys`, `/realtime`, `/realtime/stream` (SSE), `/heatmaps`, `/heatmaps/data?path=`

**Explorer** — `GET /visitors`, `GET /visitors/:websiteId/:visitorId` (profile + journey),
`DELETE /visitors/:websiteId/:visitorId` (erasure), `GET /visitors/:websiteId/:visitorId/export`,
`GET /sessions`, `GET /sessions/:websiteId/:sessionId`

**Leads & conversion** — `GET /leads`, `GET /leads/:id`, `PATCH /leads/:id`, `GET/POST/PATCH/DELETE /funnels`,
`GET /funnels/:id/report`, `GET/POST/PATCH/DELETE /goals`

**Ops** — `GET/POST/PATCH/DELETE /alerts`, `GET /alerts/events`, `GET /reports/:type?format=csv|xlsx`,
`GET/POST/DELETE /reports/schedules`

## 6. SDK architecture (`packages/tracker`)

```
src/
  index.js        bootstrap: read data-* attrs, fetch site config, wire modules, expose window.analytics
  core/ids.js     visitor ID (localStorage, falls back to memory in cookieless mode), session ID (30-min idle)
  core/queue.js   in-memory batch queue → flush every 5s / 20 events / pagehide; retry with backoff;
                  localStorage offline queue (≤ 200 events); dedupe by event id
  core/transport.js  sendBeacon (unload) · fetch keepalive (normal) · optional gzip via CompressionStream
  core/consent.js consent modes: none | opt-in | opt-out; honours DNT/GPC when site enables it
  auto/pageviews.js  History API patch (pushState/replaceState/popstate/hashchange) → page_view + route_change
  auto/engagement.js active time (visible + interacted within 30s), scroll milestones, page_leave
  auto/clicks.js  interactive-element clicks, outbound, downloads, rage/dead clicks, heatmap points (opt-in)
  auto/forms.js   form_view/start/submit/error — never values; allowlisted capture via trackForm/data-attrs
  auto/search.js  search inputs/forms + URL params (?q, ?s, ?search, ?query, ?keyword)
  auto/media.js   <video>/<audio> play/pause/complete (capture-phase listeners)
  auto/errors.js  window.onerror / unhandledrejection (rate-capped)
  util/redact.js  sensitive field detection + email/phone/card redaction in free text
```

All listeners are passive & delegated at `document` (no per-element binding); work is deferred with
`requestIdleCallback`. Script tag uses `defer`; the snippet works with or without `async`.

**Public API**: `analytics.track(name, props)`, `analytics.trackSearch(query, {category, filters, results})`,
`analytics.trackForm(formOrSelector, {fields, mask})`, `analytics.trackLead(fields, props)`,
`analytics.identify({customerId, traits})`, `analytics.consent('granted'|'denied')`, `analytics.page()`,
`analytics.reset()`, `analytics.optOut()`. Calls made before the script loads are queued via a stub
(`window.analytics = window.analytics || {q: []}`).

**Sampling** is per visitor (hash of visitor ID vs `sampleRate`) so sampled sessions stay complete.

## 7. AuthN / AuthZ

- Dashboard: email + bcrypt password → opaque 256-bit session token in an `httpOnly; SameSite=Lax;
  Secure` cookie; only its SHA-256 is stored (`auth_sessions`, TTL). CSRF: Origin check on writes.
- Roles per organization: **owner** (everything incl. billing/members), **admin** (websites, alerts,
  settings, PII), **analyst** (all analytics, leads with masked PII), **viewer** (analytics read only).
  Permission matrix in `apps/api/src/config/rbac.js`; every query is scoped to the caller's org websites.
- Tracker: `siteId` is public; requests are accepted only from the site's `allowedOrigins` (+ domain and
  subdomains). Server-to-server ingestion uses a **secret key** (`sk_…`, stored hashed) or an HMAC
  signature with a 5-minute timestamp window.

## 8. Privacy & security

- IP addresses are used transiently for geo + rate limiting and **never stored**.
- No fingerprinting: identity = random first-party ID; cookieless mode = per-tab session-only ID.
- Cross-site correlation only through `identify()` on sites with `settings.identify = true` within the
  same organization; external IDs stored as HMAC + AES-GCM ciphertext.
- Sensitive fields (password, OTP, CVV, card, token, secret, PIN, Aadhaar/PAN, SSN, IBAN) are blocked in
  the SDK **and** re-checked server side; free text is scrubbed of emails/phones/card numbers except in
  explicitly allowlisted lead fields.
- Lead PII encrypted with AES-256-GCM (`PII_ENCRYPTION_KEY`); masked (`********21`) for roles without `leads:pii`.
- Retention per site via TTL; visitor erasure + export endpoints; consent modes; DNT/GPC switch;
  audit log for every admin action, PII view and export; helmet, CORS allowlists, rate limits, payload caps.

## 9. Dashboard information architecture

Header: brand · **website switcher** (All websites / MPF / RMW / CT / …) · live dot · user menu.
Page header: title + **date range** (Today, 7d, 30d, 90d, custom) + export. Filters live in the URL.

```
Overview · Real-time
AUDIENCE     Visitors · Sessions · Geography · Devices · Browsers
BEHAVIOUR    Pages · Events · Searches · User journeys · Heatmaps
ACQUISITION  Traffic sources · Campaigns
CONVERSION   Forms · Leads · Funnels
MANAGE       Websites · Alerts · Reports · Settings (members, privacy, audit log)
```

## 10. Implementation order

1. Monorepo, shared package (events, schemas, PII, channels), database specs + migration runner
2. API core: config, db, auth, RBAC, websites + keys, ingestion pipeline, realtime (SSE)
3. Tracker SDK + tests + build
4. Stats/explorer/leads/funnels/heatmap/alerts/reports endpoints + worker
5. Dashboard (shell, overview, realtime, every section, website onboarding)
6. Docs app, Docker, deployment guide, seed/demo data
