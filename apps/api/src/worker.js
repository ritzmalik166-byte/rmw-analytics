/**
 * Background worker: rollups, alert evaluation, scheduled reports, retention.
 * Run one or more instances alongside the API (set RUN_JOBS_IN_PROCESS=false on API instances);
 * a lease lock in MongoDB guarantees each job runs on one instance at a time.
 */
import { logger } from './config/logger.js';
import { connectDb, closeDb } from './config/db.js';
import { closeRedis } from './config/redis.js';
import { startJobs } from './services/jobs.js';

let stop = () => {};

async function main() {
  await connectDb();
  logger.info('Worker connected to MongoDB');
  stop = startJobs();
}

async function shutdown(signal) {
  logger.info(`${signal} received, stopping worker`);
  stop();
  await closeRedis();
  await closeDb();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
main().catch((err) => {
  logger.error({ err: err.message }, 'Worker failed to start');
  process.exit(1);
});
