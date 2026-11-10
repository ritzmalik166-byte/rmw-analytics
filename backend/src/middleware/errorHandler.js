import { logger } from '../config/logger.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ success: false, message: 'Route not found', errorCode: 'NOT_FOUND' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return undefined;
  if (err.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Malformed JSON body', errorCode: 'BAD_JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ success: false, message: 'Request body too large', errorCode: 'PAYLOAD_TOO_LARGE' });
  if (err.code === 11000) return res.status(409).json({ success: false, message: 'A record with these details already exists', errorCode: 'DUPLICATE' });
  if (err.expose && err.status < 500) {
    return res.status(err.status).json({ success: false, message: err.message, errorCode: err.errorCode, ...(err.details ? { details: err.details } : {}) });
  }
  // Unexpected: full detail goes to logs only; clients get a generic message.
  const status = err.status && err.status >= 500 ? err.status : 500;
  logger.error({ err: { message: err.message, code: err.code, stack: err.stack }, path: req.path, method: req.method }, 'Unhandled error');
  return res.status(status).json({ success: false, message: 'Something went wrong', errorCode: err.errorCode || 'INTERNAL_ERROR' });
}
