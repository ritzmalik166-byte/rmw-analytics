import { MongoClient, ObjectId } from 'mongodb';
import { C, runMigrations } from '@rmw-analytics/database';
import { env } from './env.js';
import { logger } from './logger.js';

let client = null;
let db = null;

/** Connect once (idempotent). `uri`/`dbName` overrides are used by tests. */
export async function connectDb({ uri = env.MONGODB_URI, dbName = env.MONGODB_DB, migrate = env.AUTO_MIGRATE } = {}) {
  if (db) return db;
  client = new MongoClient(uri, {
    maxPoolSize: env.MONGODB_POOL_SIZE,
    retryWrites: true,
    serverSelectionTimeoutMS: 10_000,
    appName: 'rmw-analytics-api',
  });
  await client.connect();
  db = client.db(dbName);
  if (migrate) {
    const applied = await runMigrations(db, (m) => logger.debug(m));
    if (applied.length) logger.info({ applied }, 'Database migrations applied');
  }
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not connected; call connectDb() first');
  return db;
}

/** Collection accessor by logical name: col('events'), col(C.events). */
export const col = (name) => getDb().collection(C[name] || name);

export async function pingDb() {
  const t = Date.now();
  await getDb().command({ ping: 1 });
  return Date.now() - t;
}

export async function closeDb() {
  if (client) await client.close();
  client = null;
  db = null;
}

/** Parse a 24-hex ObjectId or return null (never throws). */
export function oid(v) {
  if (v instanceof ObjectId) return v;
  return typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v) ? new ObjectId(v) : null;
}

export { ObjectId, C };
