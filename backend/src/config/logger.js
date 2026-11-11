import pino from 'pino';
import { env, isProd, isTest } from './env.js';

// Secrets and PII are redacted wherever they appear in log objects.
export const redactPaths = [
  'password', 'newPassword', 'currentPassword', 'token', 'secret', 'apiKey', 'fields', 'pii', 'otp', 'challenge',
  '*.password', '*.newPassword', '*.currentPassword', '*.token', '*.secret', '*.apiKey', '*.fields', '*.pii', '*.otp', '*.challenge',
  'req.headers.authorization', 'req.headers.cookie', 'req.headers["x-signature"]', 'res.headers["set-cookie"]',
];

let transport;
if (!isProd && !isTest) {
  try {
    await import('pino-pretty');
    transport = { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } };
  } catch { /* pretty printing is optional */ }
}

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  ...(transport ? { transport } : {}),
});
