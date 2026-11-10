import { listWebsites } from '../services/websiteService.js';
import { notFound } from '../utils/errors.js';
import { resolveRange, DEFAULT_TZ } from '../utils/dates.js';

/**
 * Resolve `?site=all|<websiteId>` into the websites the caller may see (always within their org),
 * plus the date range in the organisation's reporting timezone.
 * Sets req.scope = { websites, websiteIds, single, tz, range }.
 */
export async function resolveScope(req, _res, next) {
  try {
    const websites = await listWebsites(req.org._id);
    const site = String(req.query.site || 'all');
    let selected = websites;
    if (site !== 'all') {
      selected = websites.filter((w) => String(w._id) === site || w.siteId === site);
      if (!selected.length) throw notFound('Website not found');
    }
    const tz = req.org.settings?.timezone || DEFAULT_TZ;
    req.scope = {
      allWebsites: websites,
      allWebsiteIds: websites.map((w) => w._id),
      websites: selected,
      websiteIds: selected.map((w) => w._id),
      single: site !== 'all' ? selected[0] : null,
      tz,
      range: resolveRange(req.query, tz),
    };
    next();
  } catch (err) {
    next(err);
  }
}
