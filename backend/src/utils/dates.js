import { badRequest } from './errors.js';

export const DAY_MS = 86_400_000;
export const DEFAULT_TZ = 'Asia/Kolkata';

/** "YYYY-MM-DD" for a Date in a timezone. */
export function dayKey(date, tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Offset (ms) of `tz` from UTC at instant `date`. */
function tzOffsetMs(date, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Start of the hour containing `ms`, in `tz`, as epoch ms. Matches Mongo's $dateTrunc({ unit: 'hour', timezone }),
 * which matters for half-hour zones like IST where local hours start at :30 UTC.
 */
export function startOfHourInTz(ms, tz = DEFAULT_TZ) {
  const off = tzOffsetMs(new Date(ms), tz);
  return Math.floor((ms + off) / 3600_000) * 3600_000 - off;
}

/** Midnight (start of day) in `tz` for "YYYY-MM-DD", as a UTC Date. */
export function startOfDayInTz(day, tz = DEFAULT_TZ) {
  return localTimeInTz(day, '00:00', tz);
}

/** Wall-clock "YYYY-MM-DD" + "HH:mm" in `tz`, as a UTC Date. */
export function localTimeInTz(day, time, tz = DEFAULT_TZ) {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  return new Date(guess.getTime() - tzOffsetMs(guess, tz));
}

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Inclusive list of day keys between two day keys. */
export function daysBetween(fromDay, toDay) {
  const out = [];
  for (let d = fromDay; d <= toDay && out.length < 2000; d = addDays(d, 1)) out.push(d);
  return out;
}

const PRESETS = { today: 0, '7d': 6, '28d': 27, '30d': 29, '90d': 89, '12m': 364 };
/** Rolling windows ending now ("last 30 minutes", "last hour"…), in ms. */
const ROLLING = { '5m': 5 * 60_000, '15m': 15 * 60_000, '20m': 20 * 60_000, '30m': 30 * 60_000, '1h': 3600_000, '3h': 3 * 3600_000, '6h': 6 * 3600_000, '12h': 12 * 3600_000, '24h': DAY_MS };
/** Charts switch to per-minute points for windows up to this long. */
const MINUTE_INTERVAL_MAX_MS = 2 * 3600_000;

/** "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (wall clock in the org timezone) → { day, time|null }. */
function parseBound(v) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2})?)?$/.exec(String(v));
  if (!m) throw badRequest('from/to must be YYYY-MM-DD or YYYY-MM-DDTHH:mm', 'BAD_RANGE');
  return { day: m[1], time: m[2] || null };
}

/**
 * Resolve a query (`range=7d`, `range=30m`, `from=YYYY-MM-DD&to=YYYY-MM-DD`, or with times
 * `from=YYYY-MM-DDTHH:mm&to=YYYY-MM-DDTHH:mm`) into concrete instants in the org timezone.
 * Returns { from: Date, to: Date, fromDay, toDay, tz, interval, partial, prevFrom, prevTo }.
 * `partial` = the range doesn't cover whole days, so the daily rollups can't be used for it.
 */
export function resolveRange(q = {}, tz = DEFAULT_TZ) {
  const now = new Date();
  const today = dayKey(now, tz);
  let fromDay;
  let toDay;
  let from;
  let to;
  let partial = false;
  if (ROLLING[q.range]) {
    to = now;
    from = new Date(now.getTime() - ROLLING[q.range]);
    partial = true;
  } else if (q.range === 'yesterday') {
    fromDay = addDays(today, -1);
    toDay = fromDay;
  } else if (q.from || q.to) {
    let a = parseBound(q.from || q.to);
    let b = parseBound(q.to || q.from);
    if (`${a.day}T${a.time || '00:00'}` > `${b.day}T${b.time || '23:59'}`) [a, b] = [b, a];
    if (a.time || b.time) {
      from = localTimeInTz(a.day, a.time || '00:00', tz);
      // The end minute is inclusive: "to 14:30" counts everything up to 14:30:59.
      to = b.time ? new Date(localTimeInTz(b.day, b.time, tz).getTime() + 59_999) : new Date(startOfDayInTz(addDays(b.day, 1), tz).getTime() - 1);
      if (to > now) to = now;
      if (from >= to) throw badRequest('The start time must be before the end time (and in the past)', 'BAD_RANGE');
      if (to - from > 1830 * DAY_MS) throw badRequest('Date range is too large (max 5 years)', 'BAD_RANGE');
      partial = true;
    } else {
      fromDay = a.day;
      toDay = b.day;
      if (daysBetween(fromDay, toDay).length > 1830) throw badRequest('Date range is too large (max 5 years)', 'BAD_RANGE');
    }
  } else {
    const back = PRESETS[q.range] ?? PRESETS['30d'];
    toDay = today;
    fromDay = addDays(today, -back);
  }
  if (from) {
    fromDay = dayKey(from, tz);
    toDay = dayKey(to, tz);
  }
  from = from || startOfDayInTz(fromDay, tz);
  to = to || new Date(Math.min(startOfDayInTz(addDays(toDay, 1), tz).getTime() - 1, now.getTime()));
  const span = to.getTime() - from.getTime();
  const auto = span <= MINUTE_INTERVAL_MAX_MS ? 'minute' : span <= 2 * DAY_MS ? 'hour' : 'day';
  const asked = q.interval === 'minute' && span > DAY_MS ? null : q.interval; // cap per-minute charts at 1,440 points
  const interval = ['minute', 'hour', 'day'].includes(asked) ? asked : auto;
  return { from, to, fromDay, toDay, tz, interval, partial, prevFrom: new Date(from.getTime() - span - 1), prevTo: new Date(from.getTime() - 1) };
}
