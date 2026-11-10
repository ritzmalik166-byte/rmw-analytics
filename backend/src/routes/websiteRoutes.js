import express from 'express';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler, ok, validate } from '../utils/http.js';
import { websiteCreateSchema, websiteUpdateSchema } from '../validators/schemas.js';
import * as ws from '../services/websiteService.js';
import { audit } from '../services/auditService.js';
import { env } from '../config/env.js';

const router = express.Router();
const tzOf = (req) => req.org.settings?.timezone;

async function present(w, req) {
  return { ...ws.presentWebsite(w), snippet: ws.snippetFor(w), status: await ws.installationStatus(w, tzOf(req)) };
}

router.get('/', asyncHandler(async (req, res) => {
  const list = await ws.listWebsites(req.org._id);
  ok(res, await Promise.all(list.map((w) => present(w, req))));
}));

router.post('/', requirePermission('websites:write'), asyncHandler(async (req, res) => {
  const body = validate(websiteCreateSchema, req.body);
  const w = await ws.createWebsite(req.org._id, body);
  await audit(req, 'website.created', { target: w.siteId, meta: { name: w.name, domain: w.domain } });
  ok(res, await present(w, req), 'Website created', 201);
}));

router.get('/:id', asyncHandler(async (req, res) => ok(res, await present(await ws.getWebsiteForOrg(req.org._id, req.params.id), req))));

router.get('/:id/status', asyncHandler(async (req, res) => {
  const w = await ws.getWebsiteForOrg(req.org._id, req.params.id);
  ok(res, await ws.installationStatus(w, tzOf(req)));
}));

router.patch('/:id', requirePermission('websites:write'), asyncHandler(async (req, res) => {
  const body = validate(websiteUpdateSchema, req.body);
  const w = await ws.updateWebsite(req.org._id, req.params.id, body);
  await audit(req, 'website.updated', { target: w.siteId, meta: { fields: Object.keys(body), settings: body.settings ? Object.keys(body.settings) : undefined } });
  ok(res, await present(w, req), 'Website updated');
}));

router.delete('/:id', requirePermission('websites:write'), asyncHandler(async (req, res) => {
  const w = await ws.deleteWebsite(req.org._id, req.params.id);
  await audit(req, 'website.deleted', { target: w.siteId });
  ok(res, null, 'Website removed. Tracking requests for it are now rejected.');
}));

router.post('/:id/keys', requirePermission('websites:keys'), asyncHandler(async (req, res) => {
  const { key, prefix } = await ws.rotateSecretKey(req.org._id, req.params.id);
  await audit(req, 'website.key_rotated', { target: req.params.id, meta: { prefix } });
  ok(res, { key, prefix, endpoint: `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/events` }, 'New secret key created. Copy it now — it will not be shown again.', 201);
}));

export default router;
