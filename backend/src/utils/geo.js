import { env } from '../config/env.js';
import fs from 'node:fs';
import { logger } from '../config/logger.js';
import { DEFAULT_GEOIP_PATH, downloadGeoip } from '../scripts/updateGeoip.js';

/**
 * Approximate location for a request. The IP address is only used here, transiently, and never stored.
 * Sources (first hit wins): MaxMind GeoLite2 database (GEOIP_DB_PATH) → CDN headers (Cloudflare, Vercel,
 * CloudFront, App Engine). Returns nulls when nothing is known.
 */
let reader = null;
let readerLoading = null;

/**
 * Uses GEOIP_DB_PATH if set, else the bundled default (data/geoip/dbip-city-lite.mmdb). If the default file is
 * missing it is downloaded in the background (free DB-IP Lite), retried every 15 min on failure; until then lookups
 * fall back to CDN headers. Without any database every visitor's location was "Unknown", since this server isn't
 * behind a geo-CDN. Status is exposed on /health so a deploy can be checked from outside.
 */
const RETRY_MS = 15 * 60_000;
const status = { state: 'idle', error: null, since: null, lookups: 0, hits: 0 };
let downloading = null;
let lastAttempt = 0;

const setState = (state, error = null) => Object.assign(status, { state, error, since: new Date().toISOString() });

function startDownload(dbPath) {
  if (downloading || Date.now() - lastAttempt < RETRY_MS) return;
  lastAttempt = Date.now();
  setState('downloading');
  logger.info({ dbPath }, 'GeoIP database missing; downloading DB-IP City Lite');
  downloading = downloadGeoip(dbPath, (m) => logger.info(m))
    .then(() => { setState('downloaded'); return getReader(); })
    .catch((err) => { setState('download_failed', err.message); logger.warn({ err: err.message }, 'GeoIP auto-download failed; run `npm run geoip:update`'); })
    .finally(() => { downloading = null; });
}

async function getReader() {
  if (reader) return reader;
  if (readerLoading) return readerLoading;
  const dbPath = env.GEOIP_DB_PATH || DEFAULT_GEOIP_PATH;
  if (!fs.existsSync(dbPath)) {
    if (env.GEOIP_DB_PATH) setState('missing', `GEOIP_DB_PATH not found: ${dbPath}`);
    else if (env.NODE_ENV !== 'test') startDownload(dbPath);
    return null;
  }
  readerLoading = import('maxmind')
    // Non-persistent watcher: still reloads an updated database, but never keeps the process alive on its own
    // (a persistent fs watcher stopped `npm test` and graceful shutdowns from exiting).
    .then((m) => m.default.open(dbPath, { watchForUpdates: true, watchForUpdatesNonPersistent: true }))
    .then((r) => { reader = r; setState('loaded'); logger.info({ dbPath }, 'GeoIP database loaded'); return r; })
    .catch((err) => { setState('load_failed', err.message); logger.warn({ err: err.message }, 'GeoIP database unavailable; falling back to CDN headers'); readerLoading = null; return null; });
  return readerLoading;
}

/** Load (or start downloading) the database at boot rather than on the first visitor. */
export function warmGeo() { getReader().catch(() => {}); }

export function geoStatus() { return { ...status }; }

const h = (req, name) => {
  const v = req.get(name);
  return v && v !== 'XX' && v !== 'T1' ? decodeURIComponent(String(v)).slice(0, 80) : null;
};

function fromHeaders(req) {
  const country = h(req, 'cf-ipcountry') || h(req, 'x-vercel-ip-country') || h(req, 'cloudfront-viewer-country') || h(req, 'x-appengine-country') || h(req, 'x-country-code');
  const region = h(req, 'cf-region') || h(req, 'x-vercel-ip-country-region') || h(req, 'cloudfront-viewer-country-region-name') || h(req, 'x-appengine-region');
  const city = h(req, 'cf-ipcity') || h(req, 'x-vercel-ip-city') || h(req, 'cloudfront-viewer-city') || h(req, 'x-appengine-city');
  return { country: country ? country.toUpperCase().slice(0, 2) : null, region, city };
}

export async function lookupGeo(req, ip) {
  const r = await getReader();
  status.lookups++;
  if (r && ip) {
    try {
      const g = r.get(ip.replace(/^::ffff:/, ''));
      if (g) {
        status.hits++;
        return {
          country: g.country?.iso_code || null,
          region: g.subdivisions?.[0]?.names?.en || null,
          city: g.city?.names?.en || null,
        };
      }
    } catch { /* fall through to headers */ }
  }
  return fromHeaders(req);
}
