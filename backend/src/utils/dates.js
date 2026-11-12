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
  const [y, m, d] = day.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
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

const PRESETS = { today: 0, '24h': 1, '7d': 6, '30d': 29, '90d': 89, '12m': 364 };

/**
 * Resolve a query (`range=7d` or `from=YYYY-MM-DD&to=YYYY-MM-DD`) into concrete instants in the org timezone.
 * Returns { from: Date, to: Date, fromDay, toDay, tz, interval, prevFrom, prevTo }.
 */
export function resolveRange(q = {}, tz = DEFAULT_TZ) {
  const now = new Date();
  const today = dayKey(now, tz);
  let fromDay;
  let toDay;
  let from;
  let to;
  if (q.range === '24h') {
    to = now;
    from = new Date(now.getTime() - DAY_MS);
    fromDay = dayKey(from, tz);
    toDay = today;
  } else if (q.from || q.to) {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    fromDay = String(q.from || q.to).slice(0, 10);
    toDay = String(q.to || q.from).slice(0, 10);
    if (!re.test(fromDay) || !re.test(toDay)) throw badRequest('from/to must be YYYY-MM-DD', 'BAD_RANGE');
    if (fromDay > toDay) [fromDay, toDay] = [toDay, fromDay];
    if (daysBetween(fromDay, toDay).length > 1830) throw badRequest('Date range is too large (max 5 years)', 'BAD_RANGE');
  } else {
    const back = PRESETS[q.range] ?? PRESETS['30d'];
    toDay = today;
    fromDay = addDays(today, -back);
  }
  from = from || startOfDayInTz(fromDay, tz);
  to = to || new Date(Math.min(startOfDayInTz(addDays(toDay, 1), tz).getTime() - 1, now.getTime()));
  const span = to.getTime() - from.getTime();
  const interval = q.interval === 'hour' || q.interval === 'day' ? q.interval : span <= 2 * DAY_MS ? 'hour' : 'day';
  return { from, to, fromDay, toDay, tz, interval, prevFrom: new Date(from.getTime() - span - 1), prevTo: new Date(from.getTime() - 1) };
}
