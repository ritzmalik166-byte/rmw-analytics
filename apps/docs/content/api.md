# HTTP API

Base URL: `https://analytics.example.com`. Responses use the envelope
`{ "success": true, "data": … }` or `{ "success": false, "message": "…", "errorCode": "…" }`.

## Event ingestion — `POST /api/v1/events`

```json
{
  "siteId": "site_m673dne6y2ns",
  "v": 1,
  "sentAt": 1794321000000,
  "ctx": { "vid": "v_8f92a13c4e7b11aa", "sid": "s_lx2k9a_72819", "lang": "en-IN", "tz": "Asia/Kolkata", "sw": 1920, "sh": 1080 },
  "events": [
    { "id": "e_k2j3h4g5f6d7", "n": "page_view", "t": 1794320999000,
      "p": { "u": "https://example.com/properties", "pa": "/properties", "ti": "Properties", "r": "https://www.google.com/" },
      "pr": {} }
  ]
}
```

| Field | Rules |
|---|---|
| `ctx.vid` | `^v_[a-z0-9]{8,40}$` — pseudonymous visitor ID |
| `ctx.sid` | `^s_[a-z0-9_]{6,48}$` — one session per request |
| `events[].id` | `^e_[a-z0-9_]{6,48}$` — unique; retries with the same ID are deduplicated |
| `events[].n` | event name, `^[a-z0-9_.:-]{1,64}$` |
| `events[].t` | epoch ms |

Response `202 { accepted, duplicates, dropped }`. Bots and Do-Not-Track visitors get a normal 202 with `accepted: 0`.

### Browser requests

- Sent as `Content-Type: text/plain` with no custom headers, so there is no CORS preflight.
- Add `?z=1` for a gzip-compressed body.
- Accepted only from the website's domain, its subdomains and listed allowed origins (checked via `Origin`, or `Referer` as a fallback).

### Server-side requests

Use the secret key from *Websites → Server-side API*:

```bash
curl -X POST https://analytics.example.com/api/v1/events \
  -H "Authorization: Bearer sk_…" -H "Content-Type: application/json" \
  -d '{"siteId":"site_…","ctx":{"vid":"v_customer123ab","sid":"s_server_order1","ua":"…","ip":"203.0.113.9"},
       "events":[{"id":"e_order_10291","n":"conversion","t":1794321000000,"pr":{"goal":"booking","value":250000,"currency":"INR"}}]}'
```

Or sign the raw body (5-minute window):

```
X-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secretKey, "<t>.<raw body>")>
```

For server-side requests only, `ctx.ua` and `ctx.ip` are used for device and location. The IP is not stored.

### Abuse protection

- Per-IP rate limit: `INGEST_RATE_PER_IP_PER_MIN`, default 1200.
- Per-website events per minute: `INGEST_RATE_PER_SITE_PER_MIN`, shared through Redis when configured.
- Strict schema validation; unknown keys are rejected.
- Size caps on bodies and properties; time-window checks; bot filtering.

## Public site config — `GET /api/v1/sites/:siteId/config`

The tracker reads consent mode, enabled modules, sampling and excluded paths from here. Responses are cached for 5 minutes.

## Tracker — `GET /tracker.js`

Served with brotli or gzip, an ETag, and `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`.

## Dashboard API

The dashboard API is cookie-authenticated and same-origin. Writes require an allowed `Origin`. Select an
organisation with the `X-Org-Id` header. Analytics endpoints take `site=all|<websiteId>` and either
`range=today|24h|7d|30d|90d|12m` or `from`/`to` (`YYYY-MM-DD`).

| Area | Endpoints |
|---|---|
| Auth | `GET /auth/setup-status`, `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password`, `POST /auth/accept-invite` |
| Organisation | `GET/PATCH /org`, `GET /org/members`, `POST /org/invites`, `PATCH/DELETE /org/members/:userId`, `GET /org/audit-logs` |
| Websites | `GET/POST /websites`, `GET/PATCH/DELETE /websites/:id`, `GET /websites/:id/status`, `POST /websites/:id/keys` |
| Stats | `/stats/overview`, `/stats/timeseries`, `/stats/pages`, `/stats/dimension/:dim` (channel, source, referrer, utm_*, country, region, city, device, browser, os, screen, language, entry, event), `/stats/campaigns`, `/stats/events/:name`, `/stats/searches`, `/stats/forms`, `/stats/journeys` |
| Real-time | `GET /realtime`, `GET /realtime/stream` (Server-Sent Events: `snapshot`, `activity`, `presence`) |
| Explorer | `GET /visitors`, `GET /visitors/:websiteId/:visitorId`, `GET …/export`, `DELETE …`, `GET /sessions`, `GET /sessions/:websiteId/:sessionId` |
| Leads | `GET /leads`, `GET/PATCH /leads/:id` |
| Funnels & goals | `GET/POST /funnels`, `PATCH/DELETE /funnels/:id`, `GET /funnels/:id/report`, `POST /funnels/preview`, `GET/POST /goals`, `DELETE /goals/:id` |
| Heatmaps | `GET /heatmaps`, `GET /heatmaps/data?path=&device=` |
| Alerts | `GET/POST /alerts`, `PATCH/DELETE /alerts/:id`, `GET /alerts/events`, `POST /alerts/events/read` |
| Reports | `GET /reports`, `GET /reports/:type?format=csv\|xlsx\|json`, `GET/POST /reports/schedules`, `DELETE /reports/schedules/:id` |

## Roles

| Permission | owner | admin | analyst | viewer |
|---|:-:|:-:|:-:|:-:|
| Analytics dashboards | ✓ | ✓ | ✓ | ✓ |
| Visitor & session explorer | ✓ | ✓ | ✓ | |
| Leads (masked contact details) | ✓ | ✓ | ✓ | |
| Lead PII, lead export, visitor export/erasure | ✓ | ✓ | | |
| Websites, keys, goals, alerts, members | ✓ | ✓ | | |
| Organisation settings | ✓ | | | |
