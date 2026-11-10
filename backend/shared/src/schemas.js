import { z } from 'zod';
import { LIMITS, EVENT_NAME_RE, SITE_ID_RE, VISITOR_ID_RE, SESSION_ID_RE, EVENT_ID_RE } from './events.js';

const str = (max) => z.string().max(max);
const scalar = z.union([z.string().max(LIMITS.MAX_PROP_STRING * 4), z.number().finite(), z.boolean(), z.null()]);
const propValue = z.union([
  scalar,
  z.array(z.union([z.string().max(LIMITS.MAX_PROP_STRING), z.number().finite(), z.boolean()])).max(50),
  z.record(z.string().max(LIMITS.MAX_PROP_KEY), z.union([scalar, z.array(scalar).max(50)])),
]);

/** Compact page descriptor sent by the tracker. */
export const pageSchema = z.object({
  u: str(LIMITS.MAX_URL).optional(),         // url
  pa: str(LIMITS.MAX_URL).optional(),        // path
  ti: str(LIMITS.MAX_TITLE * 2).optional(),  // title
  r: str(LIMITS.MAX_URL).optional(),         // referrer
}).strict();

export const wireEventSchema = z.object({
  id: z.string().regex(EVENT_ID_RE),
  n: z.string().regex(EVENT_NAME_RE),
  t: z.number().int().positive(),
  p: pageSchema.optional(),
  pr: z.record(z.string().max(LIMITS.MAX_PROP_KEY), propValue).optional(),
}).strict();

export const contextSchema = z.object({
  vid: z.string().regex(VISITOR_ID_RE),
  sid: z.string().regex(SESSION_ID_RE),
  lang: str(35).optional(),
  tz: str(64).optional(),
  sw: z.number().int().min(0).max(20000).optional(),
  sh: z.number().int().min(0).max(20000).optional(),
  vw: z.number().int().min(0).max(20000).optional(),
  vh: z.number().int().min(0).max(20000).optional(),
  online: z.boolean().optional(),
  consent: z.enum(['granted', 'denied', 'unknown']).optional(),
  cookieless: z.boolean().optional(),
  ua: str(512).optional(), // honoured only for server-side (secret-key) ingestion
  ip: str(64).optional(),  // honoured only for server-side (secret-key) ingestion
}).strict();

/** Batch envelope: POST /api/v1/events */
export const batchSchema = z.object({
  siteId: z.string().regex(SITE_ID_RE),
  v: z.literal(1).optional(),
  sentAt: z.number().int().positive().optional(),
  ctx: contextSchema,
  events: z.array(wireEventSchema).min(1).max(LIMITS.MAX_EVENTS_PER_BATCH),
}).strict();

/** Per-website settings (also served to the tracker via the public config endpoint). */
export const websiteSettingsSchema = z.object({
  consentMode: z.enum(['none', 'opt-in', 'opt-out']).default('none'),
  respectDnt: z.boolean().default(true),
  cookieless: z.boolean().default(false),
  heatmaps: z.boolean().default(false),
  sampleRate: z.number().min(0.01).max(1).default(1),
  leadCapture: z.boolean().default(false),
  identify: z.boolean().default(false),
  autoSearch: z.boolean().default(true),
  autoForms: z.boolean().default(true),
  trackErrors: z.boolean().default(true),
  trackMedia: z.boolean().default(true),
  retentionDays: z.number().int().min(30).max(1825).default(395),
  excludePaths: z.array(z.string().max(200)).max(50).default([]),
  searchParams: z.array(z.string().max(40)).max(20).default([]),
  leadFields: z.array(z.string().max(40)).max(30).default(['name', 'email', 'phone', 'city', 'message']),
});

export const DEFAULT_WEBSITE_SETTINGS = Object.freeze(websiteSettingsSchema.parse({}));

/** Subset of settings that the public tracker config endpoint exposes. */
export const PUBLIC_SETTING_KEYS = ['consentMode', 'respectDnt', 'cookieless', 'heatmaps', 'sampleRate', 'autoSearch', 'autoForms', 'trackErrors', 'trackMedia', 'excludePaths', 'searchParams', 'leadCapture', 'leadFields', 'identify'];
