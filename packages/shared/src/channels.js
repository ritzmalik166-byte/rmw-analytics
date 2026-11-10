/** Referrer / traffic channel classification (API ingestion + dashboard labels). */

const SEARCH_ENGINES = ['google.', 'bing.com', 'yahoo.', 'duckduckgo.com', 'baidu.com', 'yandex.', 'ecosia.org', 'search.brave.com', 'naver.com'];
const SOCIAL = ['facebook.com', 'fb.com', 'instagram.com', 't.co', 'twitter.com', 'x.com', 'linkedin.com', 'lnkd.in', 'youtube.com', 'youtu.be', 'pinterest.', 'reddit.com', 'quora.com', 'whatsapp.com', 'wa.me', 't.me', 'threads.net', 'snapchat.com', 'tiktok.com'];
const EMAIL = ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'mail.yahoo.com', 'mail.zoho.com'];
const AI = ['chatgpt.com', 'chat.openai.com', 'perplexity.ai', 'gemini.google.com', 'claude.ai', 'copilot.microsoft.com'];

export const CHANNELS = Object.freeze({
  direct: 'Direct',
  organic_search: 'Organic search',
  paid_search: 'Paid search',
  organic_social: 'Organic social',
  paid_social: 'Paid social',
  email: 'Email',
  referral: 'Referral',
  ai_assistant: 'AI assistants',
  display: 'Display',
  affiliate: 'Affiliate',
  internal: 'Internal',
});

const matches = (host, list) => list.some((d) => (d.endsWith('.') ? host.includes(d) : host === d || host.endsWith(`.${d}`)));

export function referrerHost(referrer) {
  if (!referrer) return null;
  try { return new URL(referrer).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
}

const SOCIAL_SOURCE = /facebook|instagram|meta|linkedin|twitter|youtube|whatsapp|pinterest|snapchat|tiktok|reddit|quora/;

/**
 * Classify a session's channel from its referrer, UTM params and ad click IDs.
 * @param {{referrer?: string, utm?: {source?: string, medium?: string}, host?: string, clickIds?: string[]}} input
 * @returns {keyof typeof CHANNELS}
 */
export function classifyChannel({ referrer, utm = {}, host, clickIds = [] } = {}) {
  const medium = String(utm.medium || '').toLowerCase();
  const source = String(utm.source || '').toLowerCase();
  const ref = referrerHost(referrer);
  const ownHost = host ? String(host).replace(/^www\./, '').toLowerCase() : null;

  if (clickIds.includes('gclid') || clickIds.includes('msclkid')) return 'paid_search';
  if (/^(cpc|ppc|paidsearch|paid_search|paid-search|sem)$/.test(medium)) return SOCIAL_SOURCE.test(source) ? 'paid_social' : 'paid_search';
  if (/paid.?social|social.?paid|^paid$|cpm/.test(medium) || (clickIds.includes('fbclid') && medium)) return 'paid_social';
  if (/display|banner|programmatic/.test(medium)) return 'display';
  if (/affiliate/.test(medium)) return 'affiliate';
  if (/e-?mail|newsletter/.test(medium) || /newsletter|mailchimp|sendgrid/.test(source)) return 'email';
  if (/^(social|sm|social-network|social-media|social_media)$/.test(medium)) return 'organic_social';
  if (/organic/.test(medium)) return 'organic_search';
  if (/referral/.test(medium)) return 'referral';

  if (!ref) {
    if (!source) return 'direct';
    if (SOCIAL_SOURCE.test(source)) return 'organic_social';
    if (/google|bing|yahoo|duckduckgo/.test(source)) return 'organic_search';
    return 'referral';
  }
  if (ownHost && (ref === ownHost || ref.endsWith(`.${ownHost}`) || ownHost.endsWith(`.${ref}`))) return 'internal';
  if (matches(ref, AI)) return 'ai_assistant';
  if (matches(ref, EMAIL)) return 'email';
  if (matches(ref, SEARCH_ENGINES)) return 'organic_search';
  if (matches(ref, SOCIAL)) return 'organic_social';
  return 'referral';
}

const KNOWN_SOURCES = [['google', 'Google'], ['bing', 'Bing'], ['yahoo', 'Yahoo'], ['duckduckgo', 'DuckDuckGo'], ['facebook', 'Facebook'], ['fb.com', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['lnkd.in', 'LinkedIn'], ['t.co', 'X (Twitter)'], ['twitter', 'X (Twitter)'], ['x.com', 'X (Twitter)'], ['youtube', 'YouTube'], ['whatsapp', 'WhatsApp'], ['wa.me', 'WhatsApp'], ['chatgpt', 'ChatGPT'], ['openai', 'ChatGPT'], ['perplexity', 'Perplexity'], ['gemini', 'Gemini'], ['claude.ai', 'Claude']];

/** Friendly source name ("google.co.in" → "Google"); UTM source wins when present. */
export function sourceName(refHost, utmSource) {
  if (utmSource) return String(utmSource).slice(0, 100);
  if (!refHost) return 'Direct';
  // Keys with a dot are exact domains; bare keys ("google") match any TLD ("google.co.in", "news.google.com").
  const hit = KNOWN_SOURCES.find(([k]) => (k.includes('.') ? refHost === k || refHost.endsWith(`.${k}`) : refHost.includes(`${k}.`)));
  return hit ? hit[1] : refHost;
}
