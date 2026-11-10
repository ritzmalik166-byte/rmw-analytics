import express from 'express';
import { col, oid } from '../config/db.js';
import { can } from '../config/rbac.js';
import { requirePermission } from '../middleware/auth.js';
import { resolveScope } from '../middleware/scope.js';
import { limiters } from '../middleware/security.js';
import { asyncHandler, ok, validate, parsePagination, pageMeta } from '../utils/http.js';
import { badRequest, notFound } from '../utils/errors.js';
import { funnelSchema, goalSchema, leadUpdateSchema, alertSchema, reportScheduleSchema } from '../validators/schemas.js';
import * as stats from '../services/statsService.js';
import * as explorer from '../services/explorerService.js';
import * as leads from '../services/leadService.js';
import * as funnels from '../services/funnelService.js';
import * as heatmaps from '../services/heatmapService.js';
import * as alerts from '../services/alertService.js';
import * as reports from '../services/reportService.js';
import { subscribe, activeVisitors } from '../services/realtime.js';
import { invalidateGoals } from '../services/ingest/ingestService.js';
import { audit } from '../services/auditService.js';

const router = express.Router();
const read = requirePermission('analytics:read');
const DIMS = ['channel', 'source', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign', 'country', 'region', 'city', 'device', 'browser', 'os', 'screen', 'language', 'entry', 'event'];

// ─── Stats ─────────────────────────────────────────────────────────────────
router.get('/stats/overview', read, resolveScope, asyncHandler(async (req, res) => ok(res, await stats.overview(req.scope))));
router.get('/stats/timeseries', read, resolveScope, asyncHandler(async (req, res) => ok(res, await stats.timeseries(req.scope))));
router.get('/stats/pages', read, resolveScope, asyncHandler(async (req, res) => ok(res, await stats.pages(req.scope, { q: req.query.q, sort: req.query.sort, limit: Number(req.query.limit) || 100 }))));
router.get('/stats/dimension/:dim', read, resolveScope, asyncHandler(async (req, res) => {
  if (!DIMS.includes(req.params.dim)) throw badRequest('Unknown dimension', 'BAD_DIMENSION');
  ok(res, await stats.dimension(req.scope, req.params.dim, { limit: Number(req.query.limit) || 50 }));
}));
router.get('/stats/campaigns', read, resolveScope, asyncHandler(async (req, res) => ok(res, await stats.campaigns(req.scope))));
router.get('/stats/events/:name', read, resolveScope, asyncHandler(async (req, res) => ok(res, await stats.eventDetail(req.scope, String(req.params.name).slice(0, 64)))));
router.get('/stats/searches', read, resolveScope, asyncHandler(async (req, res) => ok(res, await stats.searches(req.scope))));
router.get('/stats/forms', read, resolveScope, asyncHandler(async (req, res) => ok(res, await stats.forms(req.scope))));
router.get('/stats/journeys', read, resolveScope, asyncHandler(async (req, res) => ok(res, await stats.journeys(req.scope, { depth: Math.min(8, Number(req.query.depth) || 5), from: req.query.from_path || undefined }))));

// ─── Realtime ──────────────────────────────────────────────────────────────
router.get('/realtime', read, resolveScope, asyncHandler(async (req, res) => ok(res, await stats.realtime(req.scope))));

/** Server-Sent Events: `snapshot` on connect, `activity` per live event, `presence` every 10s. */
router.get('/realtime/stream', read, resolveScope, asyncHandler(async (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const ids = req.scope.websiteIds;
  send('snapshot', await stats.realtime(req.scope));
  const unsubscribe = await subscribe(ids, (item) => send('activity', item));
  const presence = setInterval(async () => {
    try {
      const v = await activeVisitors(ids);
      send('presence', { active: v.length, visitors: v.slice(0, 100) });
    } catch { /* next tick */ }
  }, 10_000);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { clearInterval(presence); clearInterval(heartbeat); unsubscribe(); });
}));

// ─── Visitors & sessions ───────────────────────────────────────────────────
router.get('/visitors', requirePermission('visitors:read'), resolveScope, asyncHandler(async (req, res) => {
  const p = parsePagination(req.query);
  const r = await explorer.listVisitors(req.scope, { ...p, q: req.query.q, segment: req.query.segment });
  ok(res, { rows: r.rows, meta: pageMeta(r.page, r.limit, r.total) });
}));
router.get('/visitors/:websiteId/:visitorId', requirePermission('visitors:read'), resolveScope, asyncHandler(async (req, res) => {
  const pii = can(req.role, 'leads:pii');
  const data = await explorer.visitorProfile(req.scope, req.params.websiteId, req.params.visitorId, { pii });
  if (pii && data.leads.length) await audit(req, 'pii.viewed', { target: req.params.visitorId, meta: { leads: data.leads.length } });
  ok(res, data);
}));
router.get('/visitors/:websiteId/:visitorId/export', requirePermission('visitors:export'), limiters.export, resolveScope, asyncHandler(async (req, res) => {
  const data = await explorer.exportVisitor(req.scope, req.params.websiteId, req.params.visitorId);
  await audit(req, 'visitor.exported', { target: req.params.visitorId });
  res.set('Content-Disposition', `attachment; filename="visitor-${req.params.visitorId}.json"`);
  res.json(data);
}));
router.delete('/visitors/:websiteId/:visitorId', requirePermission('visitors:delete'), resolveScope, asyncHandler(async (req, res) => {
  const counts = await explorer.deleteVisitor(req.scope, req.params.websiteId, req.params.visitorId);
  await audit(req, 'visitor.deleted', { target: req.params.visitorId, meta: counts });
  ok(res, counts, 'Visitor data deleted');
}));
router.get('/sessions', requirePermission('visitors:read'), resolveScope, asyncHandler(async (req, res) => {
  const p = parsePagination(req.query);
  const r = await explorer.listSessions(req.scope, { ...p, channel: req.query.channel, device: req.query.device, country: req.query.country, converted: req.query.converted });
  ok(res, { rows: r.rows, meta: pageMeta(r.page, r.limit, r.total) });
}));
router.get('/sessions/:websiteId/:sessionId', requirePermission('visitors:read'), resolveScope, asyncHandler(async (req, res) => ok(res, await explorer.sessionDetail(req.scope, req.params.websiteId, req.params.sessionId))));

// ─── Leads ─────────────────────────────────────────────────────────────────
router.get('/leads', requirePermission('leads:read'), resolveScope, asyncHandler(async (req, res) => {
  const p = parsePagination(req.query);
  const pii = can(req.role, 'leads:pii');
  const r = await leads.listLeads({ ...req.scope, ...p, status: req.query.status, q: req.query.q });
  if (pii && r.rows.length) await audit(req, 'pii.viewed', { meta: { leads: r.rows.length, page: p.page } });
  ok(res, { rows: r.rows.map((l) => leads.presentLead(l, { pii, websites: req.scope.allWebsites })), meta: pageMeta(r.page, r.limit, r.total), statuses: leads.LEAD_STATUSES });
}));
router.get('/leads/:id', requirePermission('leads:read'), resolveScope, asyncHandler(async (req, res) => {
  const pii = can(req.role, 'leads:pii');
  const l = await leads.getLead(req.scope.allWebsiteIds, req.params.id);
  if (pii) await audit(req, 'pii.viewed', { target: req.params.id });
  ok(res, leads.presentLead(l, { pii, websites: req.scope.allWebsites }));
}));
router.patch('/leads/:id', requirePermission('leads:write'), resolveScope, asyncHandler(async (req, res) => {
  const body = validate(leadUpdateSchema, req.body);
  const l = await leads.updateLead(req.scope.allWebsiteIds, req.params.id, body, req.user);
  await audit(req, 'lead.updated', { target: req.params.id, meta: { status: body.status, note: Boolean(body.note) } });
  ok(res, leads.presentLead(l, { pii: can(req.role, 'leads:pii'), websites: req.scope.allWebsites }), 'Lead updated');
}));

// ─── Funnels & goals ───────────────────────────────────────────────────────
const presentFunnel = (f) => ({ id: String(f._id), name: f.name, websiteId: f.websiteId ? String(f.websiteId) : null, steps: f.steps, windowHours: f.windowHours, createdAt: f.createdAt });
router.get('/funnels', read, asyncHandler(async (req, res) => ok(res, (await funnels.listFunnels(req.org._id)).map(presentFunnel))));
router.post('/funnels', requirePermission('funnels:write'), asyncHandler(async (req, res) => {
  const f = await funnels.createFunnel(req.org._id, validate(funnelSchema, req.body), req.user);
  await audit(req, 'funnel.created', { target: String(f._id) });
  ok(res, presentFunnel(f), 'Funnel created', 201);
}));
router.patch('/funnels/:id', requirePermission('funnels:write'), asyncHandler(async (req, res) => ok(res, presentFunnel(await funnels.updateFunnel(req.org._id, req.params.id, validate(funnelSchema.partial(), req.body))), 'Funnel updated')));
router.delete('/funnels/:id', requirePermission('funnels:write'), asyncHandler(async (req, res) => { await funnels.deleteFunnel(req.org._id, req.params.id); ok(res, null, 'Funnel deleted'); }));
router.get('/funnels/:id/report', read, resolveScope, asyncHandler(async (req, res) => {
  const f = await funnels.getFunnel(req.org._id, req.params.id);
  ok(res, { funnel: presentFunnel(f), ...(await funnels.funnelReport(f, req.scope.websiteIds, req.scope.range)) });
}));
/** Ad-hoc funnel (preview while building, nothing saved). */
router.post('/funnels/preview', read, resolveScope, asyncHandler(async (req, res) => {
  const body = validate(funnelSchema.extend({ name: funnelSchema.shape.name.optional() }), req.body);
  ok(res, await funnels.funnelReport({ ...body, websiteId: body.websiteId ? oid(body.websiteId) : null }, req.scope.websiteIds, req.scope.range));
}));

router.get('/goals', read, resolveScope, asyncHandler(async (req, res) => {
  const rows = await col('goals').find({ websiteId: { $in: req.scope.allWebsiteIds } }).toArray();
  ok(res, rows.map((g) => ({ id: String(g._id), websiteId: String(g.websiteId), name: g.name, type: g.type, match: g.match, value: g.value || 0, currency: g.currency || null })));
}));
router.post('/goals', requirePermission('websites:write'), resolveScope, asyncHandler(async (req, res) => {
  const body = validate(goalSchema, req.body);
  const wid = oid(body.websiteId);
  if (!req.scope.allWebsiteIds.some((id) => id.equals(wid))) throw notFound('Website not found');
  const { insertedId } = await col('goals').insertOne({ ...body, websiteId: wid, createdAt: new Date() });
  invalidateGoals(wid);
  await audit(req, 'goal.created', { target: String(insertedId), meta: { name: body.name } });
  ok(res, { id: String(insertedId) }, 'Goal created', 201);
}));
router.delete('/goals/:id', requirePermission('websites:write'), resolveScope, asyncHandler(async (req, res) => {
  const g = await col('goals').findOneAndDelete({ _id: oid(req.params.id), websiteId: { $in: req.scope.allWebsiteIds } });
  const doc = g?.value ?? g;
  if (doc?.websiteId) invalidateGoals(doc.websiteId);
  ok(res, null, 'Goal deleted');
}));

// ─── Heatmaps ──────────────────────────────────────────────────────────────
router.get('/heatmaps', read, resolveScope, asyncHandler(async (req, res) => ok(res, await heatmaps.heatmapPages(req.scope))));
router.get('/heatmaps/data', read, resolveScope, asyncHandler(async (req, res) => {
  if (!req.query.path) throw badRequest('path is required');
  ok(res, await heatmaps.heatmapData(req.scope, { path: String(req.query.path).slice(0, 500), device: ['desktop', 'tablet', 'mobile'].includes(req.query.device) ? req.query.device : null }));
}));

// ─── Alerts ────────────────────────────────────────────────────────────────
const presentAlert = (a) => ({ id: String(a._id), name: a.name, type: a.type, websiteId: a.websiteId ? String(a.websiteId) : null, threshold: a.threshold, windowMinutes: a.windowMinutes, cooldownMinutes: a.cooldownMinutes, channels: a.channels, enabled: a.enabled, lastTriggeredAt: a.lastTriggeredAt, createdAt: a.createdAt });
router.get('/alerts', read, asyncHandler(async (req, res) => ok(res, { rules: (await alerts.listAlerts(req.org._id)).map(presentAlert), types: alerts.ALERT_TYPES })));
router.post('/alerts', requirePermission('alerts:write'), asyncHandler(async (req, res) => {
  const a = await alerts.createAlert(req.org._id, validate(alertSchema, req.body), req.user);
  await audit(req, 'alert.created', { target: String(a._id), meta: { type: a.type } });
  ok(res, presentAlert(a), 'Alert created', 201);
}));
router.patch('/alerts/:id', requirePermission('alerts:write'), asyncHandler(async (req, res) => ok(res, presentAlert(await alerts.updateAlert(req.org._id, req.params.id, validate(alertSchema.partial(), req.body))), 'Alert updated')));
router.delete('/alerts/:id', requirePermission('alerts:write'), asyncHandler(async (req, res) => { await alerts.deleteAlert(req.org._id, req.params.id); ok(res, null, 'Alert deleted'); }));
router.get('/alerts/events', read, asyncHandler(async (req, res) => {
  const rows = await alerts.listAlertEvents(req.org._id, { limit: Math.min(200, Number(req.query.limit) || 50), unreadFor: req.query.unread === '1' ? req.user._id : undefined });
  const unread = await col('alertEvents').countDocuments({ orgId: req.org._id, readBy: { $ne: req.user._id } });
  ok(res, { unread, rows: rows.map((e) => ({ id: String(e._id), type: e.type, name: e.name, message: e.message, value: e.value, websiteId: e.websiteId ? String(e.websiteId) : null, ts: e.ts, read: (e.readBy || []).some((u) => u.equals(req.user._id)) })) });
}));
router.post('/alerts/events/read', read, asyncHandler(async (req, res) => { await alerts.markAlertEventsRead(req.org._id, req.user._id); ok(res, null); }));

// ─── Reports ───────────────────────────────────────────────────────────────
router.get('/reports', read, (_req, res) => ok(res, Object.entries(reports.REPORTS).map(([key, r]) => ({ key, title: r.title, pii: Boolean(r.pii) }))));
router.get('/reports/schedules', read, asyncHandler(async (req, res) => {
  const rows = await col('reportSchedules').find({ orgId: req.org._id }).toArray();
  ok(res, rows.map((s) => ({ id: String(s._id), websiteId: s.websiteId ? String(s.websiteId) : null, frequency: s.frequency, recipients: s.recipients, lastSentAt: s.lastSentAt || null })));
}));
router.post('/reports/schedules', requirePermission('reports:schedule'), asyncHandler(async (req, res) => {
  const body = validate(reportScheduleSchema, req.body);
  const { insertedId } = await col('reportSchedules').insertOne({ orgId: req.org._id, websiteId: body.websiteId ? oid(body.websiteId) : null, frequency: body.frequency, recipients: body.recipients, createdBy: req.user._id, createdAt: new Date(), enabled: true });
  await audit(req, 'report.scheduled', { meta: { frequency: body.frequency } });
  ok(res, { id: String(insertedId) }, 'Report scheduled', 201);
}));
router.delete('/reports/schedules/:id', requirePermission('reports:schedule'), asyncHandler(async (req, res) => {
  await col('reportSchedules').deleteOne({ _id: oid(req.params.id), orgId: req.org._id });
  ok(res, null, 'Schedule removed');
}));
router.get('/reports/:type', requirePermission('reports:export'), limiters.export, resolveScope, asyncHandler(async (req, res) => {
  const type = req.params.type;
  const def = reports.REPORTS[type];
  if (!def) throw notFound('Unknown report');
  if (def.pii && !can(req.role, 'leads:export')) throw badRequest('Exporting leads requires the leads:export permission', 'FORBIDDEN_EXPORT');
  const report = await reports.buildReport(type, req.scope, { pii: can(req.role, 'leads:pii') });
  const format = req.query.format === 'xlsx' ? 'xlsx' : req.query.format === 'json' ? 'json' : 'csv';
  await audit(req, 'report.exported', { target: type, meta: { format, rows: report.rows.length, from: req.scope.range.fromDay, to: req.scope.range.toDay } });
  const name = `${type}-${req.scope.range.fromDay}-to-${req.scope.range.toDay}`;
  if (format === 'json') return ok(res, report);
  if (format === 'xlsx') {
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${name}.xlsx"`);
    return res.send(await reports.toXlsx([report]));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${name}.csv"`);
  return res.send(reports.toCsv(report));
}));

export default router;
