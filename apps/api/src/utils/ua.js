import UAParser from 'ua-parser-js';
import { isbot } from 'isbot';

const cache = new Map();
const MAX_CACHE = 5000;

/**
 * Parse a user agent into the stored device shape. Results are memoised (UAs repeat heavily).
 * Screen width refines the device type for UAs that don't say (e.g. iPadOS reports desktop Safari).
 */
export function parseDevice(ua, { screenWidth, touch } = {}) {
  const key = `${ua}|${screenWidth || ''}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const r = new UAParser(ua || '').getResult();
  let type = r.device.type === 'mobile' ? 'mobile' : r.device.type === 'tablet' ? 'tablet' : r.device.type ? 'other' : 'desktop';
  if (type === 'desktop' && screenWidth) {
    if (screenWidth < 768) type = 'mobile';
    else if (screenWidth < 1100 && (touch || /Macintosh/.test(ua || '')) && /Safari/.test(ua || '') && !/Chrome/.test(ua || '')) type = 'tablet';
  }
  if (isBot(ua)) type = 'bot';
  const device = {
    type,
    browser: r.browser.name || 'Unknown',
    browserVersion: r.browser.major || null,
    os: r.os.name === 'Mac OS' ? 'macOS' : (r.os.name || 'Unknown'),
    osVersion: r.os.version || null,
    vendor: r.device.vendor || null,
    model: r.device.model || null,
  };
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, device);
  return device;
}

/** Crawlers, headless browsers, uptime monitors and empty UAs are not visitors. */
export function isBot(ua) {
  if (!ua || ua.length < 10) return true;
  return isbot(ua) || /HeadlessChrome|PhantomJS|Lighthouse|Pingdom|UptimeRobot|StatusCake|GTmetrix|Chrome-Lighthouse|PageSpeed/i.test(ua);
}
