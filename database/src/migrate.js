import { C, INDEXES, VALIDATORS } from './collections.js';
import { migrations } from '../migrations/index.js';

/** Create missing collections, apply validators and ensure every index exists (idempotent). */
export async function ensureSchema(db, log = () => {}) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const name of Object.values(C)) {
    const validator = VALIDATORS[name];
    if (!existing.has(name)) {
      await db.createCollection(name, validator ? { validator, validationLevel: 'moderate', validationAction: 'error' } : {});
      log(`created collection ${name}`);
    } else if (validator) {
      await db.command({ collMod: name, validator, validationLevel: 'moderate', validationAction: 'error' });
    }
  }
  for (const [name, specs] of Object.entries(INDEXES)) {
    if (!specs.length) continue;
    await db.collection(name).createIndexes(specs.map(({ key, ...opts }) => ({ key, ...opts })));
  }
  log('indexes ensured');
}

/** Run pending data migrations in order; each is recorded in `_migrations`. */
export async function runMigrations(db, log = () => {}) {
  await ensureSchema(db, log);
  const done = new Set((await db.collection(C.migrations).find({}, { projection: { _id: 1 } }).toArray()).map((m) => m._id));
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    log(`migration ${m.id}: ${m.description}`);
    await m.up(db);
    await db.collection(C.migrations).insertOne({ _id: m.id, description: m.description, appliedAt: new Date() });
  }
  return migrations.filter((m) => !done.has(m.id)).map((m) => m.id);
}

export async function migrationStatus(db) {
  const done = await db.collection(C.migrations).find({}).sort({ _id: 1 }).toArray();
  const doneIds = new Set(done.map((d) => d._id));
  return migrations.map((m) => ({ id: m.id, description: m.description, applied: doneIds.has(m.id), appliedAt: done.find((d) => d._id === m.id)?.appliedAt || null }));
}
