import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import pinoHttp from 'pino-http';
import { env, dashboardOrigins } from './config/env.js';
import { logger } from './config/logger.js';
import { pingDb } from './config/db.js';
import { originCheck, limiters } from './middleware/security.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import ingestRoutes from './routes/ingestRoutes.js';
import authRoutes from './routes/authRoutes.js';
import orgRoutes from './routes/orgRoutes.js';
import websiteRoutes from './routes/websiteRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === '/health' || req.url.startsWith('/api/v1/events') || req.url.startsWith('/tracker.js') || req.url.includes('/realtime/stream') },
    serializers: { req: () => undefined, res: () => undefined },
    customSuccessMessage: (req, res, ms) => `${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Math.round(ms)}ms`,
    customErrorMessage: (req, res) => `${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode}`,
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
  }));
  // SSE must not be buffered by compression.
  app.use(compression({ filter: (req, res) => !req.path.endsWith('/realtime/stream') && compression.filter(req, res) }));

  app.get('/health', async (_req, res) => {
    try { res.json({ ok: true, db: `${await pingDb()}ms` }); } catch { res.status(503).json({ ok: false }); }
  });

  // Public, cross-origin: tracker script, site config, event ingestion. No cookies, own CORS.
  app.use(ingestRoutes);

  // Dashboard API: credentialed CORS for dashboard origins only, JSON bodies, Origin check on writes.
  const dash = express.Router();
  dash.use(cors({ origin: dashboardOrigins, credentials: true }), cookieParser(), express.json({ limit: '200kb' }), originCheck, limiters.api);
  dash.use('/auth', authRoutes);
  dash.use('/org', requireAuth, orgRoutes);
  dash.use('/websites', requireAuth, websiteRoutes);
  dash.use('/', requireAuth, analyticsRoutes);
  app.use('/api/v1', dash);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
