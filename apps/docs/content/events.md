# Event reference

Every event has the same stored shape. Context such as device, location and channel is added server-side.

```json
{
  "siteId": "site_123",
  "visitorId": "v_8f92a13c4e7b11aa",
  "sessionId": "s_lx2k9a_72819",
  "event": "page_view",
  "timestamp": "2026-11-10T14:30:00Z",
  "page": { "url": "https://example.com/properties", "path": "/properties", "title": "Properties" },
  "device": { "type": "desktop", "browser": "Chrome", "os": "Windows" },
  "geo": { "country": "IN", "region": "Uttar Pradesh", "city": "Noida" },
  "channel": "organic_search",
  "properties": {}
}
```

## Automatic events

| Event | When | Properties |
|---|---|---|
| `session_start` | First event of a session (30-min inactivity rotates sessions) | `isNew` |
| `page_view` | Load and every SPA navigation | `nav` (`load` \| `spa`) |
| `route_change` | SPA navigation | `from`, `to` |
| `page_leave` | Navigating away, tab hidden, unload | `pvid`, `engaged` (ms), `delta` (ms), `scroll` (max %) |
| `scroll` | 25 / 50 / 75 / 90 / 100 % depth, once per view | `depth` |
| `click` | Interactive elements (links, buttons, `[data-track]`) | `tag`, `text`, `sel`, `href`, (`x`, `y` with heatmaps) |
| `outbound_click` | Link to another domain | `href`, `domain` |
| `file_download` | pdf, zip, docx, xlsx, csv, mp4, apk… | `href`, `ext` |
| `rage_click` | ≥ 3 clicks within 700 ms in a 30 px radius | as `click` |
| `dead_click` | Heatmaps only: click with no reaction within 1 s | as `click` |
| `video_play` / `video_pause` / `video_complete` | `<video>` / `<audio>` | `src`, `title`, `pct`, `dur` |
| `form_view` / `form_start` / `form_submit` / `form_error` | Form seen, first input, submit, validation error | `form`, `formName`, `dur`, `fieldCount`, `field` — never values |
| `search` | Search forms and `?q=`-style URLs | `query` (redacted), `category`, `filters`, `results`, `auto` |
| `js_error` | Uncaught errors and promise rejections (capped at 10 per page) | `msg`, `src`, `line`, `col` |

## Explicit events

| Call | Event |
|---|---|
| `analytics.track(name, props)` | any `name` matching `^[a-z0-9_.:-]{1,64}$` |
| `analytics.trackSearch(q, opts)` | `search` |
| `analytics.trackLead(fields, props)` | `lead` (needs *Lead capture*) |
| `analytics.identify({ customerId, traits })` | `identify` (needs *Identify users*) |
| `analytics.track('conversion', { goal, value, currency })` | `conversion` |

## Conversions and goals

A conversion is recorded for:

- every new lead (goal `lead`);
- every `conversion` event;
- any event or page view that matches a **goal** defined under *Websites → Goals*, for example event `file_download` or path `/thank-you`.

## Channels

Sessions are classified from UTM parameters, ad click IDs (`gclid`, `msclkid`, `fbclid`) and the referrer into:
Direct, Organic search, Paid search, Organic social, Paid social, Email, Referral, AI assistants (ChatGPT,
Perplexity, Gemini, Claude…), Display and Affiliate.

## Limits

Up to 50 events per request, a 64 KB body, 30 properties per event, and 500 characters per string property.
Timestamps must be within the last 24 hours (clock skew is corrected using `sentAt`).
