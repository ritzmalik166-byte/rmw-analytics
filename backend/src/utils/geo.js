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
 * missing it is downloaded once in the background (free DB-IP Lite); until then lookups fall back to CDN headers.
 * Without any database every visitor's location was "Unknown", since this server isn't behind a geo-CDN.
 */
let downloadStarted = false;
async function getReader() {
  if (reader) return reader;
  if (readerLoading) return readerLoading;
  const dbPath = env.GEOIP_DB_PATH || DEFAULT_GEOIP_PATH;
  if (!fs.existsSync(dbPath)) {
    if (!env.GEOIP_DB_PATH && !downloadStarted && env.NODE_ENV !== 'test') {
      downloadStarted = true;
      downloadGeoip(dbPath, (m) => logger.info(m))
        .catch((err) => logger.warn({ err: err.message }, 'GeoIP auto-download failed; run `npm run geoip:update`'));
    }
    return null;
  }
  readerLoading = import('maxmind')
    .then((m) => m.default.open(dbPath, { watchForUpdates: true }))
    .then((r) => { reader = r; logger.info({ dbPath }, 'GeoIP database loaded'); return r; })
    .catch((err) => { logger.warn({ err: err.message }, 'GeoIP database unavailable; falling back to CDN headers'); readerLoading = null; return null; });
  return readerLoading;
}

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
  if (r && ip) {
    try {
      const g = r.get(ip.replace(/^::ffff:/, ''));
      if (g) {
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
