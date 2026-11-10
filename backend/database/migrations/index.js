/**
 * Ordered data migrations. Schema (collections, validators, indexes) is declarative in
 * src/collections.js and applied on every run; put data backfills / renames here.
 * Each migration: { id: 'NNN_name', description, up: async (db) => {} } — must be idempotent.
 */
export const migrations = [
  {
    id: '001_init',
    description: 'Initial schema (collections, validators, indexes)',
    up: async () => {},
  },
];
