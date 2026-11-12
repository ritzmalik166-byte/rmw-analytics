import { col, oid } from '../config/db.js';
import { notFound } from '../utils/errors.js';
import { globToRegex } from '../utils/http.js';

/**
 * Funnels: ordered steps evaluated per visitor within a conversion window.
 * Step types:
 *   path   – page_view whose path matches a glob ("/project/*", "*" = any page / landing)
 *   event  – event name ("contact_click", "property_view")
 *   search – any search (match optional: substring of the normalised query)
 *   form   – form_start / form_submit (match: "start" | "submit"; optional form key after ":")
 */
export const STEP_TYPES = ['path', 'event', 'search', 'form'];

export const listFunnels = (orgId) => col('funnels').find({ orgId }).sort({ createdAt: -1 }).toArray();

export async function getFunnel(orgId, id) {
  const _id = oid(id);
  const f = _id && (await col('funnels').findOne({ _id, orgId }));
  if (!f) throw notFound('Funnel not found');
  return f;
}

export async function createFunnel(orgId, input, user) {
  const doc = { orgId, websiteId: input.websiteId ? oid(input.websiteId) : null, name: input.name, steps: input.steps, windowHours: input.windowHours || 72, createdBy: user._id, createdAt: new Date() };
  const { insertedId } = await col('funnels').insertOne(doc);
  return { _id: insertedId, ...doc };
}

export async function updateFunnel(orgId, id, patch) {
  const f = await getFunnel(orgId, id);
  const $set = { updatedAt: new Date() };
  for (const k of ['name', 'steps', 'windowHours']) if (patch[k] !== undefined) $set[k] = patch[k];
  if (patch.websiteId !== undefined) $set.websiteId = patch.websiteId ? oid(patch.websiteId) : null;
  await col('funnels').updateOne({ _id: f._id }, { $set });
  return col('funnels').findOne({ _id: f._id });
}

export async function deleteFunnel(orgId, id) {
  const f = await getFunnel(orgId, id);
  await col('funnels').deleteOne({ _id: f._id });
}

function compileStep(step) {
  const m = String(step.match || '').trim();
  if (step.type === 'path') {
    const re = !m || m === '*' ? null : new RegExp(globToRegex(m));
    return { names: ['page_view'], test: (e) => !re || re.test(e.page?.path || '') };
  }
  if (step.type === 'event') return { names: [m], test: () => true };
  if (step.type === 'search') {
    const needle = m.toLowerCase();
    return { names: ['search'], test: (e) => !needle || String(e.props?.query || '').toLowerCase().includes(needle) };
  }
  // form: "submit", "start", "submit:contact-form"
  const [phase, formKey] = m.split(':');
  const name = phase === 'start' ? 'form_start' : phase === 'view' ? 'form_view' : 'form_submit';
  return { names: name === 'form_submit' ? ['form_submit', 'lead'] : [name], test: (e) => !formKey || e.props?.form === formKey };
}

/**
 * Compute step counts. Streams matching events sorted by visitor then time, and walks each visitor's
 * events once (O(n)). Each visitor is counted at most once per step, in order, within the window.
 */
export async function funnelReport(funnel, websiteIds, range, extra = {}) {
  const steps = funnel.steps.map(compileStep);
  const names = [...new Set(steps.flatMap((s) => s.names))];
  const ids = funnel.websiteId ? websiteIds.filter((id) => id.equals(funnel.websiteId)) : websiteIds;
  const windowMs = (funnel.windowHours || 72) * 3600_000;
  const counts = Array(steps.length).fill(0);
  const timeSums = Array(steps.length).fill(0);
  let visitors = 0;

  const cursor = col('events').find(
    { websiteId: { $in: ids }, name: { $in: names }, ts: { $gte: range.from, $lte: range.to }, ...extra },
    { projection: { websiteId: 1, visitorId: 1, name: 1, ts: 1, 'page.path': 1, 'props.query': 1, 'props.form': 1 }, sort: { websiteId: 1, visitorId: 1, ts: 1 }, allowDiskUse: true, batchSize: 5000 },
  );

  let current = null;
  let reached = 0;
  let stepTimes = [];
  const flush = () => {
    if (!current) return;
    visitors += 1;
    for (let i = 0; i < reached; i += 1) {
      counts[i] += 1;
      if (i > 0) timeSums[i] += stepTimes[i] - stepTimes[i - 1];
    }
  };
  for await (const e of cursor) {
    const key = `${e.websiteId}|${e.visitorId}`;
    if (key !== current) {
      flush();
      current = key;
      reached = 0;
      stepTimes = [];
    }
    if (reached >= steps.length) continue;
    if (reached > 0 && e.ts - stepTimes[0] > windowMs) continue;
    const s = steps[reached];
    if (s.names.includes(e.name) && s.test(e)) {
      stepTimes[reached] = e.ts.getTime();
      reached += 1;
    }
  }
  flush();

  return {
    visitorsEvaluated: visitors,
    steps: funnel.steps.map((st, i) => ({
      label: st.label || `${st.type}: ${st.match || 'any'}`,
      type: st.type,
      match: st.match,
      count: counts[i],
      conversionFromStart: counts[0] ? Math.round((counts[i] / counts[0]) * 1000) / 10 : 0,
      conversionFromPrevious: i === 0 ? 100 : counts[i - 1] ? Math.round((counts[i] / counts[i - 1]) * 1000) / 10 : 0,
      dropOff: i === 0 ? 0 : counts[i - 1] - counts[i],
      avgTimeFromPreviousMs: i > 0 && counts[i] ? Math.round(timeSums[i] / counts[i]) : null,
    })),
    overallConversion: counts[0] ? Math.round((counts.at(-1) / counts[0]) * 1000) / 10 : 0,
  };
}
