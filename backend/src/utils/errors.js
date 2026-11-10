export class AppError extends Error {
  constructor(message, { status = 400, errorCode = 'BAD_REQUEST', details } = {}) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (msg = 'Invalid request', code = 'BAD_REQUEST', details) => new AppError(msg, { status: 400, errorCode: code, details });
export const unauthorized = (msg = 'Authentication required', code = 'UNAUTHORIZED') => new AppError(msg, { status: 401, errorCode: code });
export const forbidden = (msg = 'You do not have permission to perform this action', code = 'FORBIDDEN') => new AppError(msg, { status: 403, errorCode: code });
export const notFound = (msg = 'Not found', code = 'NOT_FOUND') => new AppError(msg, { status: 404, errorCode: code });
export const conflict = (msg = 'Conflict', code = 'CONFLICT') => new AppError(msg, { status: 409, errorCode: code });
export const tooMany = (msg = 'Too many requests', code = 'RATE_LIMITED') => new AppError(msg, { status: 429, errorCode: code });
export const payloadTooLarge = (msg = 'Request body too large') => new AppError(msg, { status: 413, errorCode: 'PAYLOAD_TOO_LARGE' });
