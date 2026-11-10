import http from 'node:http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDb, closeDb } from './config/db.js';
import { getRedis, closeRedis } from './config/redis.js';
import { createApp } from './app.js';
import { startJobs } from './services/jobs.js';

let server;
let stopJobs = () => {};

async function start() {
  try {
    await connectDb();
    logger.info('MongoDB connected');
  } catch (err) {
    logger.error({ err: err.message }, 'MongoDB connection failed; check MONGODB_URI');
    process.exit(1);
  }
  if (!(await getRedis())) logger.warn('REDIS_URL not set: realtime fan-out and site quotas are per-process (fine for a single instance).');
  if (env.RUN_JOBS_IN_PROCESS) stopJobs = startJobs();

  server = http.createServer(createApp());
  server.keepAliveTimeout = 65_000; // above typical load-balancer idle timeouts
  server.headersTimeout = 66_000;
  server.listen(env.PORT, () => logger.info(`RMW Analytics API listening on :${env.PORT}`));
}

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  stopJobs();
  server?.close();
  await closeRedis();
  await closeDb();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error({ err: err?.message, stack: err?.stack }, 'Unhandled rejection'));

start();
