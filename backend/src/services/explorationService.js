import { z } from 'zod';
import { col, oid } from '../config/db.js';
import { badRequest, notFound, forbidden } from '../utils/errors.js';
import { validate } from '../utils/http.js';

/**
 * Saved explorations (GA4 "Explorations" list). An exploration belongs to an organisation and has an owner.
 * Everyone in the organisation can open it; only the owner (or an admin/owner of the organisation) can
 * change or delete it, and anyone can duplicate it to make their own copy.
 *
 * Shape: { name, site ('all' | websiteId), range: { key, from?, to? }, segments: [Segment], tabs: [Tab] }
 *   Segment: { id, name, conditions: { device?, country?, channel?, source?, medium?, campaign?, page?, event? } }
 *   Tab:     { id, name, technique: 'freeform'|'funnel'|'path', config: {...technique settings} }
 */

const conditionKeys = ['device', 'country', 'channel', 'source', 'medium', 'campaign', 'page', 'event'];
const segmentSchema = z.object({
  id: z.string().max(40),
  name: z.string().trim().min(1).max(60),
  conditions: z.object(Object.fromEntries(conditionKeys.map((k) => [k, z.string().max(300).optional()]))).strict(),
});
const tabSchema = z.object({
  id: z.string().max(40),
  name: z.string().trim().min(1).max(60),
  technique: z.enum(['freeform', 'funnel', 'path']),
  config: z.record(z.any()).refine((c) => JSON.stringify(c).length <= 20_000, 'Tab settings are too large'),
});
export const explorationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  site: z.string().max(40).default('all'),
  range: z.object({ key: z.string().max(20), from: z.string().max(10).optional(), to: z.string().max(10).optional() }).default({ key: '28d' }),
  segments: z.array(segmentSchema).max(20).default([]),
  tabs: z.array(tabSchema).min(1).max(10),
});

const canEdit = (doc, req) => doc.ownerId.equals(req.user._id) || ['owner', 'admin'].includes(req.role);

export function present(doc, req, users = new Map()) {
  return {
    id: String(doc._id), name: doc.name, site: doc.site, range: doc.range, segments: doc.segments, tabs: doc.tabs,
    owner: { id: String(doc.ownerId), name: users.get(String(doc.ownerId)) || doc.ownerName || 'Unknown', me: doc.ownerId.equals(req.user._id) },
    techniques: [...new Set((doc.tabs || []).map((t) => t.technique))],
    canEdit: canEdit(doc, req), createdAt: doc.createdAt, updatedAt: doc.updatedAt,
  };
}

async function ownerNames(docs) {
  const ids = [...new Set(docs.map((d) => String(d.ownerId)))].map(oid).filter(Boolean);
  const users = await col('users').find({ _id: { $in: ids } }, { projection: { fullName: 1 } }).toArray();
  return new Map(users.map((u) => [String(u._id), u.fullName]));
}

export async function listExplorations(req) {
  const docs = await col('explorations').find({ orgId: req.org._id }, { projection: { tabs: { id: 1, technique: 1, name: 1 }, name: 1, site: 1, ownerId: 1, ownerName: 1, createdAt: 1, updatedAt: 1, range: 1 } }).sort({ updatedAt: -1 }).limit(500).toArray();
  const users = await ownerNames(docs);
  return docs.map((d) => present({ ...d, segments: [] }, req, users));
}

async function load(req, id) {
  const _id = oid(id);
  const doc = _id && (await col('explorations').findOne({ _id, orgId: req.org._id }));
  if (!doc) throw notFound('Exploration not found');
  return doc;
}

export async function getExploration(req, id) {
  const doc = await load(req, id);
  return present(doc, req, await ownerNames([doc]));
}

export async function createExploration(req, body) {
  const input = validate(explorationSchema, body);
  const now = new Date();
  const doc = { ...input, orgId: req.org._id, ownerId: req.user._id, ownerName: req.user.fullName, createdAt: now, updatedAt: now };
  const { insertedId } = await col('explorations').insertOne(doc);
  return present({ ...doc, _id: insertedId }, req);
}

export async function updateExploration(req, id, body) {
  const doc = await load(req, id);
  if (!canEdit(doc, req)) throw forbidden('Only the owner can change this exploration. Duplicate it to make your own copy.');
  const input = validate(explorationSchema.partial(), body);
  if (!Object.keys(input).length) throw badRequest('Nothing to update');
  const updatedAt = new Date();
  await col('explorations').updateOne({ _id: doc._id }, { $set: { ...input, updatedAt } });
  return present({ ...doc, ...input, updatedAt }, req, await ownerNames([doc]));
}

export async function deleteExploration(req, id) {
  const doc = await load(req, id);
  if (!canEdit(doc, req)) throw forbidden('Only the owner can delete this exploration');
  await col('explorations').deleteOne({ _id: doc._id });
}

export async function duplicateExploration(req, id) {
  const doc = await load(req, id);
  const { _id, ...rest } = doc;
  const now = new Date();
  const copy = { ...rest, name: `${doc.name} (copy)`.slice(0, 120), ownerId: req.user._id, ownerName: req.user.fullName, createdAt: now, updatedAt: now };
  const { insertedId } = await col('explorations').insertOne(copy);
  return present({ ...copy, _id: insertedId }, req);
}
