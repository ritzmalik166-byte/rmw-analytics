#!/usr/bin/env node
/**
 * Local development MongoDB without installing MongoDB: starts a single-node replica set via
 * mongodb-memory-server with data persisted in ./.mongo-data, on port 27017 by default.
 *   npm run dev:mongo            → mongodb://127.0.0.1:27017/?replicaSet=rs0
 * Not for production — use MongoDB Atlas or the docker-compose replica set there.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(here, '../../.mongo-data');
fs.mkdirSync(dbPath, { recursive: true });
const port = Number(process.env.DEV_MONGO_PORT || 27017);

let MongoMemoryReplSet;
try {
  ({ MongoMemoryReplSet } = await import('mongodb-memory-server'));
} catch {
  console.error('mongodb-memory-server is not installed. Run `npm install` at the repo root.');
  process.exit(1);
}

const rs = await MongoMemoryReplSet.create({
  replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
  instanceOpts: [{ port, dbPath }],
});
console.log(`Dev MongoDB running: mongodb://127.0.0.1:${port}/?replicaSet=rs0  (data: ${dbPath})`);
console.log('Press Ctrl+C to stop.');

const stop = async () => { await rs.stop({ doCleanup: false }); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
