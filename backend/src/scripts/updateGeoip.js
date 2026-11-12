/**
 * Downloads the free DB-IP "IP to City Lite" database (MaxMind .mmdb format, CC BY 4.0, no account or key needed)
 * to data/geoip/dbip-city-lite.mmdb. DB-IP publishes a new file each month; run this monthly (e.g. cron) to refresh.
 *
 *   npm run geoip:update
 *
 * Attribution required by the licence: "IP Geolocation by DB-IP" (https://db-ip.com).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const DEFAULT_GEOIP_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/geoip/dbip-city-lite.mmdb');

function monthKey(offset) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - offset);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Fetch this month's file, falling back to last month's (the new file appears a day or two into the month). */
export async function downloadGeoip(dest = DEFAULT_GEOIP_PATH, log = console.log) {
  let lastErr;
  for (const offset of [0, 1]) {
    const url = `https://download.db-ip.com/free/dbip-city-lite-${monthKey(offset)}.mmdb.gz`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(600_000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.tmp`;
      // Streamed straight to disk: buffering the ~125 MB file in memory can get the process killed on a small droplet.
      await pipeline(Readable.fromWeb(res.body), createGunzip(), fs.createWriteStream(tmp));
      const size = fs.statSync(tmp).size;
      if (size < 10e6) { fs.rmSync(tmp, { force: true }); throw new Error(`file too small (${size} bytes)`); }
      fs.renameSync(tmp, dest); // atomic swap, so a running server never reads a half-written file
      log(`GeoIP database saved to ${dest} (${(size / 1e6).toFixed(1)} MB, ${monthKey(offset)})`);
      return dest;
    } catch (err) {
      lastErr = err;
      fs.rmSync(`${dest}.tmp`, { force: true });
    }
  }
  throw new Error(`Could not download the GeoIP database: ${lastErr?.message}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  downloadGeoip(process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_GEOIP_PATH)
    .catch((err) => { console.error(err.message); process.exitCode = 1; });
}
