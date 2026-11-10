# Getting started

```
CREATE WEBSITE → GET TRACKING SCRIPT → PASTE ONE SCRIPT → VISITORS GENERATE EVENTS
      → CENTRAL API → MONGODB → REAL-TIME DASHBOARD → JOURNEYS · SEARCH · FORMS · LEADS → INSIGHTS
```

## 1. Create a website

In the dashboard open **Websites → Add website**. Enter a name (for example *My Property Fact*), the domain
(`mypropertyfact.in`) and a short code (`MPF`) for the website switcher. Each website gets:

| Field | Example | Purpose |
|---|---|---|
| `siteId` | `site_m673dne6y2ns` | Public ID used in the snippet |
| `siteName` / `code` | My Property Fact / MPF | Labels in the dashboard |
| `domain` | mypropertyfact.in | Events are accepted only from this domain, its subdomains and any extra allowed origins |
| tracking key | `sk_…` (optional) | Secret key for server-side events. Never put it in browser code |
| settings | consent mode, lead capture, heatmaps… | Per-website behaviour |

## 2. Copy the tracking script

```html
<script
  defer
  src="https://analytics.example.com/tracker.js"
  data-site-id="SITE_ID">
</script>
```

The **Install** dialog has a one-click copy button and framework notes.

## 3. Install it

Paste the tag before `</head>` on every page.

- **Next.js (App Router):** `import Script from 'next/script'` and add
  `<Script src="https://analytics.example.com/tracker.js" data-site-id="SITE_ID" strategy="afterInteractive" />` to `app/layout.js`.
- **React / Vue / Angular / plain HTML:** add the tag to `index.html`. Route changes are detected through the History API.
- **WordPress:** use a header-scripts plugin, or add it to `header.php`.

## 4. Verify the installation

Click **Verify installation** in the Install dialog and open your site in another tab. The status turns to
**● Tracking active** with *Last event: a few seconds ago* and a running *Events today* count.

## 5. Go further

```js
analytics.track('property_view', { propertyId: '123' });          // custom event
analytics.trackSearch('3 BHK Noida');                            // site search
analytics.identify({ customerId: 'CUS_123' });                   // logged-in users (enable "Identify users")
analytics.track('lead_created', { source: 'property_page' });    // conversion-style custom event
analytics.track('conversion', { goal: 'booking', value: 250000, currency: 'INR' });
```

To capture enquiry forms as **leads**:

1. Enable **Lead capture** in *Websites → Settings*.
2. Check the allowlisted field names, for example `name, email, phone, city`.
3. Mark the form:

```html
<form data-analytics-lead data-analytics-fields="name,email,phone,city" data-analytics-mask="phone"> … </form>
```

Passwords, OTPs, card numbers, CVV, tokens and similar fields are never captured, even if listed.

## Local development

```bash
npm install
npm run dev:mongo          # local MongoDB replica set (no install needed), port 27017
cp apps/api/.env.example apps/api/.env   # then set the three secrets
npm run build:tracker
npm run dev:api            # http://localhost:4100  (serves /tracker.js and /api/v1)
npm run seed               # optional demo data: demo@rmw.local / DemoPass12345
npm run dev:dashboard      # http://localhost:3100
```
