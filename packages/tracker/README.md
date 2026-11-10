# tracker.js

Lightweight first-party analytics SDK. One `<script>` tag sends page views, engagement, clicks, searches, form interactions,
media, errors and (opt-in) leads to the RMW Analytics API.

**Size:** ~23 KB minified · **8.9 KB brotli** (served to modern browsers) · 9.8 KB gzip. Async/deferred, no dependencies,
no render blocking, passive delegated listeners, batched network calls.

## Install

```html
<script defer src="https://analytics.example.com/tracker.js" data-site-id="SITE_ID"></script>
```

The API origin is taken from the script URL. Single-page apps (React, Next.js, Vue, Angular) need nothing extra:
History API navigations are tracked automatically.

Optional pre-load stub, so calls made before the script loads are queued and replayed:

```html
<script>
  window.analytics = window.analytics || { q: [] };
  ['track','trackSearch','trackForm','trackLead','identify','page','consent'].forEach(function (m) {
    window.analytics[m] = window.analytics[m] || function () { window.analytics.q.push([m, [].slice.call(arguments)]); };
  });
</script>
```

The tracker is always available as `window.rmwAnalytics`. `window.analytics` is set too, unless another library
(for example Segment) already owns it.

### Script attributes

| Attribute | Meaning |
|---|---|
| `data-site-id` | **Required.** Site ID from the dashboard (`site_…`). |
| `data-api` | API origin when it differs from the script's origin. |
| `data-sample-rate` | `0.01`–`1`. Applied per visitor, so sampled sessions stay complete. The stricter of this and the site setting applies. |
| `data-cookieless` | Never write to `localStorage`. IDs live in `sessionStorage` (per tab). |
| `data-consent` | `opt-in` · `opt-out` · `none` (overrides a weaker site setting). |
| `data-auto` | Disable modules: `no-clicks,no-forms,no-search,no-media,no-errors,no-heatmaps`. |
| `data-search-params` | Extra URL parameters that carry a search query, e.g. `loc,keyword2`. |
| `data-debug="true"` | Log every event to the console. |

### Form and element attributes

| Attribute | Where | Meaning |
|---|---|---|
| `data-analytics-lead` | `<form>` | Allow lead capture for this form. Also requires *Lead capture* to be enabled on the site. |
| `data-analytics-fields="name,email,phone,city"` | `<form>` | The only fields whose values may be sent. They are also intersected with the site's allowlist. |
| `data-analytics-mask="phone"` | `<form>` | Mask these values before sending (`********21`). |
| `data-analytics-form="enquiry"` | `<form>` | Stable form key or name for reports. |
| `data-analytics-ignore` | `<form>` | Do not track this form at all. |
| `data-track="event_name"` + `data-track-*` | any element | Clicking it sends a custom event. `data-track-project-id="9"` becomes `{ projectId: "9" }`. |

## API

```js
// Custom events and conversions
analytics.track('property_view', { propertyId: '123' });
analytics.track('lead_created', { source: 'property_page' });
analytics.track('conversion', { goal: 'site_visit_booked', value: 25000, currency: 'INR' });

// Site search
analytics.trackSearch('3 BHK Noida');
analytics.trackSearch('3 BHK Noida', { category: 'residential', filters: { budget: '1-2Cr' }, results: 42 });

// Explicit lead capture for a form rendered by your framework
analytics.trackForm('#enquiry', { fields: ['name', 'email', 'phone', 'city'], mask: ['phone'] });
// …or send lead fields yourself (only when Lead capture is enabled for the site)
analytics.trackLead({ name: 'Rahul Sharma', email: 'rahul@example.com', phone: '9876543221' }, { source: 'callback_widget' });

// Link authenticated activity (only when Identify is enabled for the site)
analytics.identify({ customerId: 'CUS_10291', traits: { plan: 'gold' } });

// Consent and privacy controls
analytics.consent('granted');   // or 'denied'
analytics.optOut();             // persistent; analytics.optIn() reverses it
analytics.reset();              // new visitor ID, e.g. on logout

analytics.page();               // manual page view (rarely needed)
analytics.getVisitorId(); analytics.getSessionId();
analytics.debug(true);
```

## What is collected automatically

`session_start`, `page_view` (+ `route_change` in SPAs), `page_leave` (active time, scroll depth), `scroll` milestones
(25/50/75/90/100 %), `click` (interactive elements only), `outbound_click`, `file_download`, `rage_click`,
`video_play` / `video_pause` / `video_complete`, `form_view` / `form_start` / `form_submit` / `form_error`
(no values), `search` (search forms and `?q=`-style URLs) and `js_error`.

With heatmaps enabled for the site, clicks also carry `x` (‰ of page width) and `y` (px from the top). Clicks on
non-interactive elements and `dead_click` are recorded too.

Context sent once per batch: anonymous visitor and session IDs, language, timezone, screen and viewport size,
online state and consent state. Browser, OS, device and approximate location are derived server-side from the
User-Agent and IP. The IP address is never stored.

## Privacy behaviour

- **No fingerprinting.** Identity is a random first-party ID (`v_…`). Sessions (`s_…`) rotate after 30 minutes of inactivity.
- **No values by default.** Form events never include what was typed. Lead capture is opt-in at three levels: the site setting, the form attribute or `trackForm`, and the field allowlist.
- **Sensitive fields are always skipped:** passwords, hidden and file inputs, OTP, CVV/card, PIN, tokens, Aadhaar/PAN, and `cc-*` autocomplete fields. The API re-checks all of this.
- **Redaction:** emails, phone and card numbers are scrubbed from click text, search queries and error messages. Token/email query parameters are removed from URLs.
- **Do-Not-Track / Global Privacy Control** disables tracking when the site honours it (the default).
- **Consent modes:** in `opt-in` mode nothing is sent or stored until `analytics.consent('granted')`. `denied` clears the queue.
- **Cookieless mode** keeps IDs per tab only.
- **Excluded paths** (site setting) are never sent.

## Delivery

Events are batched and sent every 5 s, at 20 events, or immediately for form submits, leads, conversions,
downloads and outbound clicks. Requests are `text/plain` JSON with no custom headers, so there is no CORS preflight.
Large batches are gzip-compressed (`?z=1`) when `CompressionStream` is available. Page unloads use
`navigator.sendBeacon`.

Failures are retried with exponential backoff (5xx/429/network). Offline batches are kept in `localStorage`
(up to 200 events) and replayed when the browser comes back online. Each request carries exactly one visitor session.

## Develop

```bash
npm run build -w @rmw-analytics/tracker   # dist/tracker.js (+ size report, fails over budget)
npm test  -w @rmw-analytics/tracker       # node:test + jsdom
```

`demo/index.html` exercises every feature against a local API (`http://localhost:4100`). Set its `data-site-id`
to a site whose allowed origins include the page's origin.
