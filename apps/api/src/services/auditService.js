import { col } from '../config/db.js';
import { logger } from '../config/logger.js';
import { sha256 } from '../utils/crypto.js';
import { clientIp } from '../utils/http.js';

/**
 * Append-only audit trail of administrative actions, PII views and exports.
 * Never throws: an audit failure must not break the user's request (it is logged instead).
 */
export async function audit(req, action, { target = null, meta = {} } = {}) {
  try {
    await col('auditLogs').insertOne({
      orgId: req.org?._id || null,
      userId: req.user?._id || null,
      userEmail: req.user?.email || null,
      action,
      target,
      meta,
      ipHash: clientIp(req) ? sha256(clientIp(req)).slice(0, 16) : null,
      userAgent: String(req.get?.('user-agent') || '').slice(0, 200),
      ts: new Date(),
    });
  } catch (err) {
    logger.error({ err: err.message, action }, 'Audit log write failed');
  }
}
