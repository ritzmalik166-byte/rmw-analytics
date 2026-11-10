import { badRequest } from './errors.js';

/** Wrap async route handlers so rejections reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Standard success envelope: { success: true, data, message? } */
export const ok = (res, data = null, message, status = 200) => res.status(status).json({ success: true, ...(message ? { message } : {}), data });

export const clientIp = (req) => req.ip || req.socket?.remoteAddress || null;

export function parsePagination(q, { maxLimit = 100, defaultLimit = 25 } = {}) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(q.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export const pageMeta = (page, limit, total) => ({ page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });

/** Validate `data` with a zod schema; throws a 400 with field details on failure. */
export function validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const details = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest(details[0]?.message ? `${details[0].path ? `${details[0].path}: ` : ''}${details[0].message}` : 'Invalid request', 'VALIDATION_ERROR', details);
  }
  return r.data;
}

/** Escape user input for use inside a RegExp. */
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Convert a glob ("/project/*") to an anchored RegExp source. */
export const globToRegex = (glob) => `^${String(glob).split('*').map(escapeRegex).join('.*')}$`;
