#!/usr/bin/env node
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { runMigrations, migrationStatus } from './migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../../.env') });

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'rmw_analytics';
if (!uri) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

const cmd = process.argv[2] || 'migrate';
const client = new MongoClient(uri);
try {
  await client.connect();
  const db = client.db(dbName);
  if (cmd === 'status') {
    console.table(await migrationStatus(db));
  } else {
    const applied = await runMigrations(db, (m) => console.log(`• ${m}`));
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Schema up to date; no pending migrations.');
  }
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
