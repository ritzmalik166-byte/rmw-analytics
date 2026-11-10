import { build } from 'esbuild';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(here, 'dist/tracker.js');
// Budgets: brotli is what the API serves to modern browsers; gzip is the fallback.
const MAX_BROTLI = 9 * 1024;
const MAX_GZIP = 10 * 1024;

await build({
  entryPoints: [path.join(here, 'src/index.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2018',
  platform: 'browser',
  outfile,
  sourcemap: 'linked',
  legalComments: 'none',
  banner: { js: '/*! RMW Analytics tracker v1.0.0 */' },
});

const code = fs.readFileSync(outfile);
const gz = zlib.gzipSync(code, { level: 9 }).length;
const br = zlib.brotliCompressSync(code).length;
console.log(`dist/tracker.js  ${(code.length / 1024).toFixed(1)} KB raw · ${(gz / 1024).toFixed(2)} KB gzip · ${(br / 1024).toFixed(2)} KB brotli`);
if (br > MAX_BROTLI || gz > MAX_GZIP) {
  console.error(`tracker.js exceeds its size budget (brotli ≤ ${MAX_BROTLI / 1024} KB, gzip ≤ ${MAX_GZIP / 1024} KB)`);
  process.exit(1);
}
