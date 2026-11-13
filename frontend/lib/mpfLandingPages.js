/**
 * My Property Fact project landing pages, taken from the MPF code (my-property-fact/src/app).
 * `prefix: true` = the page has sub-pages (e.g. /landing-pages/eldeco-wow/<slug>), counted together.
 * Add a line here when MPF launches a new landing page.
 */
export const MPF_LANDING_PAGES = [
  { name: 'Eldeco Terra & Sol', path: '/Eldeco-terra&sol', note: 'Main project page · Sector 80 Gurugram' },
  { name: 'Eldeco Terra & Sol (ads)', path: '/lp/Eldeco-terra&sol', note: 'Ads landing page' },
  { name: 'Eldeco 7 Peaks', path: '/eldeco-7-peaks', note: 'Omicron 1A, Greater Noida' },
  { name: 'Eldeco 7 Peaks (ads)', path: '/lp/eldeco-7-peaks', note: 'Ads landing page' },
  { name: 'Eldeco 7 Peaks (old)', path: '/landing-pages/eldeco-7-peaks', prefix: true },
  { name: 'Eldeco Echoes of Eden', path: '/eldeco-echoes-of-eden', note: 'Sector 22D' },
  { name: 'Eldeco Echoes of Eden (ads)', path: '/lp/eldeco-echoes-of-eden', note: 'Ads landing page' },
  { name: 'Eldeco La Vida Bella', path: '/lavidabella' },
  { name: 'Eldeco La Vida Bella 2', path: '/landing-pages/eldeco-la-vida-bella2' },
  { name: 'Eldeco La Vida Bella 3', path: '/landing-pages/eldeco-la-vida-bella3' },
  { name: 'Eldeco Camelot', path: '/landing-pages/eldeco-camelot', prefix: true },
  { name: 'Eldeco WOW', path: '/landing-pages/eldeco-wow', prefix: true },
  { name: 'Eldeco Whispers of Wonder', path: '/landing-pages/eldeco-whispers-of-wonder' },
  { name: 'Brook Fusion', path: '/landing-pages/brook-fusion' },
  { name: 'Dholera', path: '/landing-pages/dholera' },
  { name: 'Onyx', path: '/landing-pages/onyx' },
  { name: 'Sikka Kimaya', path: '/landing-pages/sikka-kimaya' },
  { name: 'Subh Anandam', path: '/subh-anandam/landing-page' },
];

const norm = (p) => String(p || '').toLowerCase().replace(/\/+$/, '') || '/';
const isThankYou = (p) => /\/(thank-?you|thanks)(\/|$)/i.test(p);

/** Rows of /stats/pages that belong to this landing page (thank-you pages left out). */
export function rowsFor(lp, rows) {
  const base = norm(lp.path);
  return (rows || []).filter((r) => {
    const p = norm(r.path);
    if (isThankYou(p)) return false;
    return p === base || (lp.prefix && p.startsWith(`${base}/`));
  });
}

/** Thank-you page views = form submissions that reached the thank-you page. */
export function thankYouViews(lp, rows) {
  const base = norm(lp.path);
  return (rows || []).filter((r) => norm(r.path).startsWith(`${base}/`) && isThankYou(r.path)).reduce((s, r) => s + (r.pageviews || 0), 0);
}
export const isMpfSite = (w) => Boolean(w) && /\bmpf\b|property\s*fact/i.test(`${w.code} ${w.name}`);
