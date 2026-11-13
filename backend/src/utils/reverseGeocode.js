import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Exact visitor location from device GPS (sent by the tracker only when the visitor allowed location).
 * Same approach as My Property Fact's lead tracking (src/lib/reverseGeocode.js): Google Geocoding when
 * GOOGLE_MAPS_GEOCODING_API_KEY is set, otherwise OpenStreetMap Nominatim.
 *
 * IP databases only resolve to the ISP's hub (e.g. a Noida visitor shows up as "Gharoli"), so GPS wins whenever present.
 * Results are cached per ~110 m cell; Nominatim calls are serialised to its 1 request/second policy.
 */

const CACHE_MAX = 5000;
const CACHE_TTL_MS = 7 * 24 * 3600_000;
const WAIT_MS = 2500;          // max time an ingest request waits; slower lookups still fill the cache
const FETCH_TIMEOUT_MS = 8000;
const MAX_ACCURACY_M = 5000;   // coarser than this is no better than IP

const cache = new Map();       // key -> { at, value }
const inflight = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return undefined; }
  cache.delete(key); cache.set(key, hit); // LRU bump
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

const pick = (components, type, short = false) => {
  const c = components.find((item) => item.types?.includes(type));
  return (short ? c?.short_name : c?.long_name) || c?.long_name || null;
};

export function parseGoogleResult(result) {
  const c = result?.address_components ?? [];
  return {
    locality: pick(c, 'sublocality_level_1') || pick(c, 'sublocality') || pick(c, 'neighborhood'),
    city: pick(c, 'locality') || pick(c, 'administrative_area_level_2'),
    region: pick(c, 'administrative_area_level_1'),
    pincode: pick(c, 'postal_code'),
    country: (pick(c, 'country', true) || '').toUpperCase().slice(0, 2) || null,
    address: typeof result?.formatted_address === 'string' ? result.formatted_address.slice(0, 300) : null,
    provider: 'google',
  };
}

export function parseNominatimResult(data) {
  const a = data?.address ?? {};
  return {
    // Indian cities often tag sectors/urban villages as village/hamlet inside a city (e.g. "Barola, Noida").
    locality: a.suburb || a.neighbourhood || a.residential || a.quarter || a.city_district || a.hamlet
      || ((a.city || a.town) && a.village) || null,
    city: a.city || a.town || a.village || a.county || a.state_district || null,
    region: a.state || null,
    pincode: a.postcode || null,
    country: a.country_code ? String(a.country_code).toUpperCase().slice(0, 2) : null,
    address: typeof data?.display_name === 'string' ? data.display_name.slice(0, 300) : null,
    provider: 'nominatim',
  };
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  return res.json();
}

async function viaGoogle(lat, lon, key) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('latlng', `${lat},${lon}`);
  url.searchParams.set('key', key);
  url.searchParams.set('language', 'en');
  const data = await fetchJson(url);
  if (data?.status !== 'OK' || !data.results?.[0]) return null;
  return parseGoogleResult(data.results[0]);
}

let nominatimChain = Promise.resolve();
function viaNominatim(lat, lon) {
  // Serialise with >=1.1 s spacing (Nominatim usage policy).
  const run = nominatimChain.then(async () => {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    url.searchParams.set('format', 'json');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('zoom', '16');
    url.searchParams.set('accept-language', 'en');
    const data = await fetchJson(url, { 'User-Agent': 'RMW-Analytics/1.0 (visitor-geo)' });
    return data?.address ? parseNominatimResult(data) : null;
  });
  nominatimChain = run.catch(() => null).then(() => new Promise((r) => setTimeout(r, 1100)));
  return run;
}

async function resolve(lat, lon) {
  const key = env.GOOGLE_MAPS_GEOCODING_API_KEY;
  if (key) {
    try {
      const g = await viaGoogle(lat, lon, key);
      if (g?.city || g?.locality) return g;
    } catch (err) { logger.warn({ err: err.message }, 'Google reverse geocode failed'); }
  }
  return viaNominatim(lat, lon);
}

/**
 * @returns {Promise<null | {country, region, city, locality, pincode, address, lat, lon, accuracy, source:'gps', provider}>}
 */
export async function preciseGeo(lat, lon, accuracy) {
  if (!env.REVERSE_GEOCODE_ENABLED || env.NODE_ENV === 'test') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;
  if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_M) return null;

  const cell = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const finish = (place) => place && { ...place, lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)), accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null, source: 'gps' };

  const cached = cacheGet(cell);
  if (cached !== undefined) return finish(cached);

  let job = inflight.get(cell);
  if (!job) {
    job = resolve(Number(lat.toFixed(4)), Number(lon.toFixed(4)))
      .catch((err) => { logger.warn({ err: err.message }, 'Reverse geocode failed'); return null; })
      .then((place) => { cacheSet(cell, place); return place; })
      .finally(() => inflight.delete(cell));
    inflight.set(cell, job);
  }
  const place = await Promise.race([job, new Promise((r) => setTimeout(() => r(null), WAIT_MS))]);
  return finish(place);
}
