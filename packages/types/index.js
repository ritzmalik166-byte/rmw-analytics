/**
 * Shared JSDoc typedefs. Import for IntelliSense:  `/** @typedef {import('@rmw-analytics/types').StoredEvent} StoredEvent *\/`
 * Nothing is exported at runtime.
 */

/**
 * @typedef {'owner'|'admin'|'analyst'|'viewer'} Role
 *
 * @typedef {Object} WebsiteSettings
 * @property {'none'|'opt-in'|'opt-out'} consentMode
 * @property {boolean} respectDnt      Honour Do-Not-Track / Global Privacy Control
 * @property {boolean} cookieless      Never persist identifiers (per-tab IDs only)
 * @property {boolean} heatmaps        Collect click coordinates for heatmaps
 * @property {number}  sampleRate      0.01–1, applied per visitor
 * @property {boolean} leadCapture     Accept allowlisted form fields as leads
 * @property {boolean} identify        Accept analytics.identify() calls
 * @property {boolean} autoSearch
 * @property {boolean} autoForms
 * @property {boolean} trackErrors
 * @property {boolean} trackMedia
 * @property {number}  retentionDays
 * @property {string[]} excludePaths   Path prefixes / globs never tracked
 * @property {string[]} searchParams   Extra URL params carrying search queries
 * @property {string[]} leadFields     Allowlisted lead field names
 *
 * @typedef {Object} Website
 * @property {import('mongodb').ObjectId} _id
 * @property {string} siteId           Public ID used in the snippet (site_xxxxxxxx)
 * @property {import('mongodb').ObjectId} orgId
 * @property {string} name
 * @property {string} code             Short label shown in the switcher (MPF, RMW, CT…)
 * @property {string} domain
 * @property {string[]} allowedOrigins
 * @property {string} timezone
 * @property {WebsiteSettings} settings
 * @property {Date|null} lastEventAt
 * @property {Date} createdAt
 *
 * @typedef {Object} DeviceInfo
 * @property {'desktop'|'mobile'|'tablet'|'bot'|'other'} type
 * @property {string} browser
 * @property {string} [browserVersion]
 * @property {string} os
 * @property {string} [osVersion]
 * @property {string} [screen]   e.g. "1920x1080"
 * @property {string} [viewport]
 *
 * @typedef {Object} GeoInfo
 * @property {string|null} country  ISO-3166 alpha-2
 * @property {string|null} region
 * @property {string|null} city
 *
 * @typedef {Object} StoredEvent
 * @property {import('mongodb').ObjectId} websiteId
 * @property {string} eventId
 * @property {string} visitorId
 * @property {string} sessionId
 * @property {string} name
 * @property {Date} ts
 * @property {Date} receivedAt
 * @property {{url?: string, path?: string, title?: string, referrer?: string}} page
 * @property {DeviceInfo} device
 * @property {GeoInfo} geo
 * @property {string} channel
 * @property {Record<string, unknown>} props
 * @property {Date} expireAt
 *
 * @typedef {Object} Session
 * @property {import('mongodb').ObjectId} websiteId
 * @property {string} sessionId
 * @property {string} visitorId
 * @property {Date} startedAt
 * @property {Date} lastSeenAt
 * @property {number} durationMs
 * @property {number} activeMs
 * @property {number} pageviews
 * @property {number} events
 * @property {string} entryPath
 * @property {string} exitPath
 * @property {string|null} referrer
 * @property {string|null} referrerHost
 * @property {string} channel
 * @property {string} source
 * @property {{source?: string, medium?: string, campaign?: string, term?: string, content?: string}} utm
 * @property {DeviceInfo} device
 * @property {GeoInfo} geo
 * @property {string} [lang]
 * @property {string} [tz]
 * @property {boolean} isNew
 * @property {boolean} converted
 *
 * @typedef {Object} StatsQuery
 * @property {'all'|string} site   'all' or a website _id
 * @property {Date} from
 * @property {Date} to
 *
 * @typedef {Object} ApiEnvelope
 * @property {boolean} success
 * @property {*} data
 * @property {string} [message]
 * @property {string} [errorCode]
 */

export {};
