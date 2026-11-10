# Privacy & security

RMW Analytics is built for legitimate first-party website analytics. It does no covert tracking, no
fingerprinting and no identification of people across unrelated websites.

## What is collected

- A random, pseudonymous visitor ID (`v_…`) in first-party `localStorage`, or per tab only in cookieless mode. No cookies are set.
- Page URLs (with token, email and phone query parameters redacted), titles and referrers.
- Interactions: clicks on interactive elements, scroll depth, form *events* (not values), searches, media, errors.
- Screen and viewport size, language and timezone. Browser, OS and device type are derived from the User-Agent.
- Approximate country, region and city, derived from the IP at ingestion. **The IP address is never stored.**

## What is never collected

- Keystrokes or session recordings.
- Values of password, hidden or file inputs, or of OTP, CVV, card number, PIN, token, secret, Aadhaar, PAN or IBAN fields. This is enforced in the browser and again on the server.
- Form values in general, unless the website owner enables *Lead capture*, marks the form, and the field name is on the website's allowlist.
- Emails, phone numbers and card numbers inside click text, search queries or error messages. These are replaced with `[email]`, `[phone]` or `[number]`.

## Identity

`analytics.identify({ customerId })` links a logged-in customer's visitor IDs. It works only on websites where
*Identify users* is enabled, and only within the same organisation. The customer ID is stored as an HMAC (for
lookup) plus AES-256-GCM ciphertext (for authorised display).

## Controls per website

| Control | Effect |
|---|---|
| Consent mode | `none`; `opt-out`; `opt-in` (nothing is sent or stored until `analytics.consent('granted')`) |
| Do-Not-Track / GPC | On by default: such visitors are not tracked |
| Cookieless mode | No persistent identifiers |
| Sampling | Track only a share of visitors |
| Excluded paths | Never tracked, e.g. `/account/*` |
| Retention | Raw data deleted automatically after N days (MongoDB TTL); changing it re-applies to existing data |
| Lead field allowlist | The only fields that can ever be stored |

## Data-subject requests

Every visitor profile has **Export data** (JSON with everything stored, including decrypted lead fields) and
**Delete visitor** (erases events, sessions, page views, searches, form submissions, leads and conversions).
Both require admin rights and are written to the audit log.

## Security

- HTTPS everywhere (TLS terminated at nginx; HSTS recommended).
- Dashboard login uses bcrypt, an httpOnly `SameSite=Lax` `Secure` session cookie, server-side session revocation, CSRF origin checks and rate-limited login.
- Organisation roles and per-route permissions. Every query is scoped to the caller's organisation websites.
- Lead PII is encrypted with AES-256-GCM (`PII_ENCRYPTION_KEY`) and masked for roles without `leads:pii`.
- Secret keys and HMAC-signed server ingestion. Keys are stored hashed and can be rotated.
- Strict input validation with zod, request size limits, ingestion rate limits and per-website quotas, bot filtering, and a basic SSRF guard on alert webhooks.
- CSV/Excel exports neutralise formula injection.
- Audit log covering sign-ins, PII views, exports, deletions, settings, members and keys. Entries are kept for 2 years.
- Secrets come only from environment variables. Logs redact credentials and PII.
