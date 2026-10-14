'use strict';

const pool = require('../db');
const logger = require('../utils/logger');

const DEFAULT_TERMS = [
  'wire transfer only',
  'western union',
  'send gift card',
  'guaranteed income',
  '100% free money',
  'cash app only',
  'outside oxsteed',
];

function normalizedTerms() {
  const configured = String(process.env.MODERATION_BLOCKLIST || '')
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_TERMS, ...configured]));
}

exports.getBlocklist = async (_req, res) => {
  res.json({ terms: normalizedTerms() });
};

exports.flagContent = async (req, res) => {
  const userId = req.user?.id || null;
  const { text = '', context = 'unknown', locale = 'en' } = req.body || {};
  const content = String(text || '').trim();

  if (!content) return res.status(400).json({ ok: false, error: 'text is required' });

  try {
    await pool.query(
      `INSERT INTO moderation_queue
         (type, target_id, target_type, reported_by, reason, status, priority, created_at)
       VALUES ('content_flag', $1, $2, $3, $4, 'pending', $5, now())`,
      [
        `${context}:${Date.now()}`,
        String(context || 'content').slice(0, 50),
        userId,
        JSON.stringify({ text: content.slice(0, 5000), locale, source: 'ios' }),
        content.length > 1000 ? 'high' : 'normal',
      ]
    );
  } catch (err) {
    logger.warn('Mobile moderation flag could not be queued', {
      userId,
      context,
      error: err.message,
    });
  }

  res.json({ ok: true });
};

// ─── ADMIN: moderation_queue reader ──────────────────────────────────────────
// ADM-023: flags submitted from mobile land in `moderation_queue`, but no
// admin endpoint, worker, or dashboard ever read the table, so the flags
// were write-only. These endpoints make the queue reviewable.

const FLAG_STATUSES = new Set(['pending', 'reviewed', 'resolved', 'dismissed']);
const FLAG_DECISIONS = new Set(['resolved', 'dismissed']);

/**
 * GET /api/admin/moderation-flags
 * Paginated list of moderation_queue rows (mobile content flags and any
 * other queue entries), most urgent first.
 */
exports.listContentFlags = async (req, res) => {
  try {
    const status = String(req.query.status || 'pending').toLowerCase();
    if (!FLAG_STATUSES.has(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed: ${[...FLAG_STATUSES].join(', ')}.` });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      `SELECT q.id, q.type, q.target_id, q.target_type, q.reason, q.status,
              q.priority, q.resolution, q.created_at, q.updated_at, q.resolved_at,
              r.first_name AS reporter_first, r.last_name AS reporter_last,
              r.email AS reporter_email,
              s.first_name AS resolver_first, s.last_name AS resolver_last
         FROM moderation_queue q
         LEFT JOIN users r ON r.id = q.reported_by
         LEFT JOIN users s ON s.id = q.resolved_by
        WHERE q.status = $1
        ORDER BY CASE q.priority
                   WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
                   WHEN 'normal' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,
                 q.created_at DESC
        LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );
    const { rows: [{ total }] } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM moderation_queue WHERE status = $1`,
      [status]
    );
    return res.json({ flags: rows, total, page, limit });
  } catch (err) {
    logger.error('listContentFlags error', { err });
    return res.status(500).json({ error: 'Failed to fetch moderation flags.' });
  }
};

/**
 * POST /api/admin/moderation-flags/:id/review
 * Body: { decision: 'resolved' | 'dismissed', resolution?: string }
 * Marks a pending queue entry reviewed. Only pending rows can be decided,
 * so two admins cannot silently overwrite each other's decisions.
 */
exports.reviewContentFlag = async (req, res) => {
  try {
    const { decision, resolution } = req.body || {};
    if (!FLAG_DECISIONS.has(decision)) {
      return res.status(400).json({ error: "decision must be 'resolved' or 'dismissed'." });
    }
    const { rows } = await pool.query(
      `UPDATE moderation_queue
          SET status = $1,
              resolution = $2,
              resolved_by = $3,
              resolved_at = NOW(),
              updated_at = NOW()
        WHERE id = $4 AND status = 'pending'
        RETURNING id, type, target_id, target_type, status`,
      [decision, String(resolution || '').slice(0, 2000) || null, req.user?.id || null, req.params.id]
    );
    if (!rows.length) {
      const { rows: existing } = await pool.query(
        `SELECT id, status FROM moderation_queue WHERE id = $1`,
        [req.params.id]
      );
      if (!existing.length) return res.status(404).json({ error: 'Flag not found.' });
      return res.status(409).json({
        error: `Flag already ${existing[0].status}; only pending flags can be reviewed.`,
      });
    }
    try {
      await require('../services/auditService').logAdminAction({
        adminId: req.user?.id,
        action: `moderation_flag_${decision}`,
        targetType: 'moderation_flag',
        targetId: req.params.id,
        description: String(resolution || '').slice(0, 500),
        before: { status: 'pending' },
        after: { status: decision },
        req,
      });
    } catch (auditErr) {
      logger.error('moderation flag audit log failed', { err: auditErr });
    }
    return res.json({ flag: rows[0] });
  } catch (err) {
    logger.error('reviewContentFlag error', { err });
    return res.status(500).json({ error: 'Failed to review moderation flag.' });
  }
};
