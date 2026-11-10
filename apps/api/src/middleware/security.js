import rateLimit from 'express-rate-limit';
import { dashboardOrigins, isTest } from '../config/env.js';
import { forbidden } from '../utils/errors.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated dashboard routes: state-changing requests must come from an
 * allowed dashboard Origin (or Referer). Combined with SameSite=Lax cookies and JSON-only bodies.
 */
export function originCheck(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  const origin = req.get('origin') || (() => { try { return new URL(req.get('referer')).origin; } catch { return null; } })();
  if (!origin || !dashboardOrigins.includes(origin)) return next(forbidden('Request origin not allowed', 'CSRF_REJECTED'));
  return next();
}

const handler = (_req, res, _next, options) => res.status(options.statusCode).json({
  success: false, message: 'Too many requests. Please slow down and try again shortly.', errorCode: 'RATE_LIMITED',
});

const make = (windowMs, limit, extra = {}) => rateLimit({ windowMs, limit: isTest ? 100_000 : limit, standardHeaders: 'draft-7', legacyHeaders: false, handler, ...extra });

// In-memory stores are per process; with several instances put the API behind sticky sessions or plug in rate-limit-redis.
export const limiters = {
  api: make(60_000, 600),
  login: make(15 * 60_000, 20),
  register: make(60 * 60_000, 10),
  export: make(60_000, 20),
};
