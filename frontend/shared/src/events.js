/** Canonical event catalogue shared by the tracker, the API and the dashboard. */
export const EVENTS = Object.freeze({
  SESSION_START: 'session_start',
  PAGE_VIEW: 'page_view',
  ROUTE_CHANGE: 'route_change',
  PAGE_LEAVE: 'page_leave',
  CLICK: 'click',
  SCROLL: 'scroll',
  OUTBOUND_CLICK: 'outbound_click',
  FILE_DOWNLOAD: 'file_download',
  VIDEO_PLAY: 'video_play',
  VIDEO_PAUSE: 'video_pause',
  VIDEO_COMPLETE: 'video_complete',
  FORM_VIEW: 'form_view',
  FORM_START: 'form_start',
  FORM_SUBMIT: 'form_submit',
  FORM_ERROR: 'form_error',
  SEARCH: 'search',
  JS_ERROR: 'js_error',
  RAGE_CLICK: 'rage_click',
  DEAD_CLICK: 'dead_click',
  VISIBILITY_HIDDEN: 'visibility_hidden',
  IDENTIFY: 'identify',
  LEAD: 'lead',
  CONVERSION: 'conversion',
});

export const EVENT_NAMES = Object.freeze(Object.values(EVENTS));

/** Human labels used by the dashboard live feed and journeys. */
export const EVENT_LABELS = Object.freeze({
  session_start: 'New session',
  page_view: 'Page viewed',
  route_change: 'Route changed',
  page_leave: 'Left page',
  click: 'Clicked',
  scroll: 'Scrolled',
  outbound_click: 'Outbound link',
  file_download: 'File download',
  video_play: 'Video played',
  video_pause: 'Video paused',
  video_complete: 'Video completed',
  form_view: 'Form viewed',
  form_start: 'Form started',
  form_submit: 'Form submitted',
  form_error: 'Form error',
  search: 'Search performed',
  js_error: 'JavaScript error',
  rage_click: 'Rage click',
  dead_click: 'Dead click',
  visibility_hidden: 'Tab hidden',
  identify: 'Identified',
  lead: 'Lead submitted',
  conversion: 'Conversion',
});

/** High-volume / low-signal events hidden from live feeds and journeys by default. */
export const NOISY_EVENTS = Object.freeze(['scroll', 'page_leave', 'visibility_hidden', 'route_change']);

export const LIMITS = Object.freeze({
  MAX_EVENTS_PER_BATCH: 50,
  MAX_BODY_BYTES: 64 * 1024,
  MAX_PROPS: 30,
  MAX_PROP_KEY: 64,
  MAX_PROP_STRING: 500,
  MAX_URL: 2000,
  MAX_TITLE: 300,
  MAX_SEARCH_QUERY: 200,
  PAST_TOLERANCE_MS: 24 * 3600_000,
  FUTURE_TOLERANCE_MS: 5 * 60_000,
  SESSION_IDLE_MS: 30 * 60_000,
});

export const EVENT_NAME_RE = /^[a-z0-9_.:-]{1,64}$/i;
export const SITE_ID_RE = /^site_[a-z0-9]{8,32}$/;
export const VISITOR_ID_RE = /^v_[a-z0-9]{8,40}$/;
export const SESSION_ID_RE = /^s_[a-z0-9_]{6,48}$/;
export const EVENT_ID_RE = /^e_[a-z0-9_]{6,48}$/;
