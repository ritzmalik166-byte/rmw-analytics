import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../../.env') });

const bool = (d) => z.string().optional().transform((v) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(v.toLowerCase())));
const int = (d) => z.string().optional().transform((v) => (v === undefined || v === '' ? d : parseInt(v, 10)));
const secret = (name) => z.string({ required_error: `${name} is required` }).min(32, `${name} must be at least 32 characters`);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: int(4100),
  LOG_LEVEL: z.string().default('info'),
  TRUST_PROXY: int(1),
  PUBLIC_API_URL: z.string().default('http://localhost:4100'),
  DASHBOARD_ORIGINS: z.string().default('http://localhost:3100'),
  APP_URL: z.string().default('http://localhost:3100'),

  MONGODB_URI: z.string({ required_error: 'MONGODB_URI is required' }),
  MONGODB_DB: z.string().default('rmw_analytics'),
  MONGODB_POOL_SIZE: int(50),
  AUTO_MIGRATE: bool(true),

  REDIS_URL: z.string().optional(),

  SESSION_SECRET: secret('SESSION_SECRET'),

  SMS_API_URL: z.string().optional(),
  SMS_API_KEY: z.string().optional(),
  SMS_SENDER_ID: z.string().optional(),
  SMS_OTP_TEMPLATE: z.string().optional(),
  SMS_TEMPLATE_ID: z.string().optional(),
  // false = sign in with email + password only (SMS step skipped even when a mobile is set)
  LOGIN_OTP_ENABLED: bool(true),
  OTP_LENGTH: int(6),

  // Session recordings are stored on disk here (default: backend/data/replays)
  REPLAY_DIR: z.string().optional(),
  OTP_TTL_SECONDS: int(300),
  OTP_MAX_ATTEMPTS: int(5),
  OTP_RESEND_COOLDOWN_SECONDS: int(60),
  OTP_MAX_SENDS_PER_HOUR: int(5),
  PII_ENCRYPTION_KEY: secret('PII_ENCRYPTION_KEY'),
  IDENTITY_HASH_SECRET: secret('IDENTITY_HASH_SECRET'),
  SESSION_COOKIE_NAME: z.string().default('rmwa_sid'),
  SESSION_TTL_HOURS: int(168),
  COOKIE_SECURE: bool(false),
  COOKIE_DOMAIN: z.string().optional(),
  ALLOW_SIGNUP: bool(false),

  INGEST_RATE_PER_IP_PER_MIN: int(1200),
  INGEST_RATE_PER_SITE_PER_MIN: int(60000),
  INGEST_ALLOW_MISSING_ORIGIN: bool(true),

  GEOIP_DB_PATH: z.string().optional(),

  RUN_JOBS_IN_PROCESS: bool(true),
  ROLLUP_INTERVAL_SECONDS: int(60),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: int(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('RMW Analytics <no-reply@example.com>'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:\n' + parsed.error.issues.map((i) => ` - ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const dashboardOrigins = env.DASHBOARD_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
