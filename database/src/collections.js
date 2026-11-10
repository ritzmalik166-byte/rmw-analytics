/**
 * Collection catalogue: names, indexes and (light) JSON-schema validators.
 *
 * Conventions
 * - Every analytics document starts its indexes with `websiteId` (tenant isolation + selectivity).
 * - `expireAt` + TTL index enforces each website's retention policy inside MongoDB.
 * - Raw data (events, page_views, searches…) is kept separate from rollups (agg_*).
 */

export const C = Object.freeze({
  organizations: 'organizations',
  users: 'users',
  memberships: 'memberships',
  authSessions: 'auth_sessions',
  invites: 'invites',
  websites: 'websites',
  trackingKeys: 'tracking_keys',
  visitors: 'visitors',
  sessions: 'sessions',
  events: 'events',
  pageViews: 'page_views',
  searches: 'searches',
  forms: 'forms',
  formSubmissions: 'form_submissions',
  leads: 'leads',
  conversions: 'conversions',
  goals: 'goals',
  campaigns: 'campaigns',
  funnels: 'funnels',
  identities: 'visitor_identities',
  heatmapPoints: 'heatmap_points',
  aggDaily: 'agg_daily',
  aggDailyPages: 'agg_daily_pages',
  aggDailyDims: 'agg_daily_dims',
  alerts: 'alerts',
  alertEvents: 'alert_events',
  auditLogs: 'audit_logs',
  reportSchedules: 'report_schedules',
  jobLocks: 'job_locks',
  migrations: '_migrations',
});

const ttl = { key: { expireAt: 1 }, expireAfterSeconds: 0, name: 'ttl_expireAt' };

/** @type {Record<string, Array<{key: object, unique?: boolean, name?: string, expireAfterSeconds?: number, partialFilterExpression?: object, sparse?: boolean}>>} */
export const INDEXES = {
  [C.organizations]: [{ key: { slug: 1 }, unique: true }],
  [C.users]: [{ key: { email: 1 }, unique: true }],
  [C.memberships]: [{ key: { orgId: 1, userId: 1 }, unique: true }, { key: { userId: 1 } }],
  [C.authSessions]: [{ key: { tokenHash: 1 }, unique: true }, { key: { userId: 1 } }, { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'ttl_expiresAt' }],
  [C.invites]: [{ key: { tokenHash: 1 }, unique: true }, { key: { orgId: 1 } }, { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'ttl_expiresAt' }],
  [C.websites]: [{ key: { siteId: 1 }, unique: true }, { key: { orgId: 1, deletedAt: 1 } }],
  [C.trackingKeys]: [{ key: { hash: 1 }, unique: true }, { key: { websiteId: 1 } }],

  [C.visitors]: [
    { key: { websiteId: 1, visitorId: 1 }, unique: true },
    { key: { websiteId: 1, lastSeen: -1 } },
    { key: { websiteId: 1, firstSeen: -1 } },
    { key: { identityId: 1 }, sparse: true },
    ttl,
  ],
  [C.sessions]: [
    { key: { websiteId: 1, sessionId: 1 }, unique: true },
    { key: { websiteId: 1, startedAt: -1 } },
    { key: { websiteId: 1, visitorId: 1, startedAt: -1 } },
    { key: { websiteId: 1, lastSeenAt: -1 } },
    ttl,
  ],
  [C.events]: [
    { key: { websiteId: 1, eventId: 1 }, unique: true, name: 'dedupe' },
    { key: { websiteId: 1, ts: -1 } },
    { key: { websiteId: 1, name: 1, ts: -1 } },
    { key: { websiteId: 1, visitorId: 1, ts: 1 } },
    { key: { websiteId: 1, sessionId: 1, ts: 1 } },
    ttl,
  ],
  [C.pageViews]: [
    { key: { websiteId: 1, pageviewId: 1 }, unique: true },
    { key: { websiteId: 1, ts: -1 } },
    { key: { websiteId: 1, path: 1, ts: -1 } },
    { key: { websiteId: 1, sessionId: 1, ts: 1 } },
    ttl,
  ],
  [C.searches]: [
    { key: { websiteId: 1, ts: -1 } },
    { key: { websiteId: 1, normalized: 1, ts: -1 } },
    { key: { websiteId: 1, visitorId: 1, ts: -1 } },
    ttl,
  ],
  [C.forms]: [{ key: { websiteId: 1, formKey: 1 }, unique: true }],
  [C.formSubmissions]: [{ key: { websiteId: 1, ts: -1 } }, { key: { websiteId: 1, formKey: 1, ts: -1 } }, ttl],
  [C.leads]: [
    { key: { websiteId: 1, ts: -1 } },
    { key: { orgId: 1, ts: -1 } },
    { key: { orgId: 1, status: 1, ts: -1 } },
    { key: { websiteId: 1, emailHash: 1 }, sparse: true },
    { key: { websiteId: 1, visitorId: 1 } },
    ttl,
  ],
  [C.conversions]: [{ key: { websiteId: 1, ts: -1 } }, { key: { websiteId: 1, goal: 1, ts: -1 } }, ttl],
  [C.goals]: [{ key: { websiteId: 1 } }],
  [C.campaigns]: [{ key: { websiteId: 1, source: 1, medium: 1, campaign: 1 }, unique: true }, { key: { websiteId: 1, lastSeen: -1 } }],
  [C.funnels]: [{ key: { orgId: 1 } }],
  [C.identities]: [{ key: { orgId: 1, externalHash: 1 }, unique: true }, { key: { 'links.websiteId': 1, 'links.visitorId': 1 } }],
  [C.heatmapPoints]: [{ key: { websiteId: 1, path: 1, ts: -1 } }, ttl],
  [C.aggDaily]: [{ key: { websiteId: 1, day: 1 }, unique: true }],
  [C.aggDailyPages]: [{ key: { websiteId: 1, day: 1, path: 1 }, unique: true }, { key: { websiteId: 1, path: 1, day: 1 } }],
  [C.aggDailyDims]: [{ key: { websiteId: 1, day: 1, dim: 1, value: 1 }, unique: true }, { key: { websiteId: 1, dim: 1, day: 1 } }],
  [C.alerts]: [{ key: { orgId: 1 } }, { key: { enabled: 1 } }],
  [C.alertEvents]: [{ key: { orgId: 1, ts: -1 } }, { key: { alertId: 1, ts: -1 } }],
  [C.auditLogs]: [{ key: { orgId: 1, ts: -1 } }, { key: { ts: 1 }, expireAfterSeconds: 2 * 365 * 86400, name: 'ttl_ts' }],
  [C.reportSchedules]: [{ key: { orgId: 1 } }],
};

/** Minimal validators on core collections: catch programming errors without blocking schema evolution. */
export const VALIDATORS = {
  [C.websites]: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['siteId', 'orgId', 'name', 'domain', 'settings', 'createdAt'],
      properties: {
        siteId: { bsonType: 'string', pattern: '^site_[a-z0-9]{8,32}$' },
        orgId: { bsonType: 'objectId' },
        name: { bsonType: 'string', maxLength: 120 },
        domain: { bsonType: 'string', maxLength: 255 },
        allowedOrigins: { bsonType: 'array', items: { bsonType: 'string' } },
        settings: { bsonType: 'object' },
      },
    },
  },
  [C.events]: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['websiteId', 'eventId', 'visitorId', 'sessionId', 'name', 'ts'],
      properties: {
        websiteId: { bsonType: 'objectId' },
        eventId: { bsonType: 'string', maxLength: 64 },
        name: { bsonType: 'string', maxLength: 64 },
        ts: { bsonType: 'date' },
        expireAt: { bsonType: 'date' },
      },
    },
  },
  [C.users]: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['email', 'passwordHash', 'fullName', 'createdAt'],
      properties: { email: { bsonType: 'string', maxLength: 254 }, passwordHash: { bsonType: 'string' } },
    },
  },
  [C.leads]: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['websiteId', 'orgId', 'ts', 'pii', 'status'],
      properties: { pii: { bsonType: 'string' }, status: { enum: ['new', 'contacted', 'qualified', 'converted', 'spam', 'closed'] } },
    },
  },
};
