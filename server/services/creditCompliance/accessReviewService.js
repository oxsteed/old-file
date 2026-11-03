'use strict';

/**
 * Periodic access reviews (recertification) of privileged access (review
 * §9): every admin / super-admin account, every active delegated
 * permission grant and every active admin API key.
 *
 * - ensureCurrentReview (weekly job) opens one review per calendar quarter
 *   with a snapshot of all privileged access, due 30 days after the
 *   quarter starts, and raises an incident once when a review is overdue.
 * - Each item is decided keep / revoke by an administrator who is not the
 *   subject (DB CHECK credit_access_review_not_self); a revoke needs a note.
 * - Completion is the oversight action 'credit_access_review_complete'
 *   (two administrators). It applies revocations of grants and API keys
 *   (revoked_at/revoked_by) and opens an 'access_review_revocation'
 *   compliance case for each admin role to remove, because role changes go
 *   through the existing admin-management flow (and its own controls).
 */

const pool = require('../../db');
const { AppError } = require('../../middleware/errorHandler');
const { withTransaction } = require('../../utils/transaction');
const { insertComplianceAudit } = require('./audit');

const REVIEW_WINDOW_DAYS = 30;

function quarterOf(date) {
  const d = new Date(date);
  const q = Math.floor(d.getUTCMonth() / 3);
  const start = new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1));
  return { label: `${d.getUTCFullYear()}-Q${q + 1}`, start };
}

async function snapshotItems(client, reviewId) {
  const { rows: admins } = await client.query(
    `SELECT id, email, role, is_active, created_at, last_login_at FROM users
      WHERE role IN ('admin', 'super_admin') AND is_active = TRUE AND deleted_at IS NULL`
  );
  const { rows: grants } = await client.query(
    `SELECT id, grantor_id, grantee_id, permissions, expires_at, region_id, created_at FROM admin_permission_grants
      WHERE revoked_at IS NULL AND expires_at > NOW()`
  );
  const { rows: keys } = await client.query(
    `SELECT id, admin_id, name, prefix, created_at, last_used_at, expires_at FROM admin_api_keys
      WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`
  );
  const items = [
    ...admins.map((a) => ['admin_role', String(a.id), a.id, { email: a.email, role: a.role, createdAt: a.created_at, lastLoginAt: a.last_login_at }]),
    ...grants.map((g) => ['permission_grant', String(g.id), g.grantee_id, { grantorId: g.grantor_id, permissions: g.permissions, expiresAt: g.expires_at, regionId: g.region_id }]),
    ...keys.map((k) => ['api_key', String(k.id), k.admin_id, { name: k.name, prefix: k.prefix, createdAt: k.created_at, lastUsedAt: k.last_used_at, expiresAt: k.expires_at }]),
  ];
  for (const [type, ref, userId, snapshot] of items) {
    await client.query(
      `INSERT INTO credit_access_review_items (review_id, subject_type, subject_ref, user_id, snapshot)
       VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT DO NOTHING`,
      [reviewId, type, ref, userId, JSON.stringify(snapshot)]
    );
  }
  return items.length;
}

async function ensureCurrentReview({ now = new Date() } = {}) {
  const { label, start } = quarterOf(now);
  const created = await withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`credit-access-review:${label}`]);
    const { rows: existing } = await client.query('SELECT * FROM credit_access_reviews WHERE period_label = $1', [label]);
    if (existing[0]) return null;
    const due = new Date(start.getTime() + REVIEW_WINDOW_DAYS * 86400000);
    const { rows } = await client.query(
      `INSERT INTO credit_access_reviews (period_label, due_at) VALUES ($1, $2) RETURNING *`,
      [label, due]
    );
    const count = await snapshotItems(client, rows[0].id);
    await client.query('UPDATE credit_access_reviews SET item_count = $2 WHERE id = $1', [rows[0].id, count]);
    await insertComplianceAudit(client, {
      actionType: 'credit.access_review.opened', resourceType: 'credit_access_review', resourceId: String(rows[0].id),
      reason: `Access review ${label} opened with ${count} item(s)`,
    });
    return { id: String(rows[0].id), label, items: count };
  }, 'credit_access_review_open');
  const { rows: overdue } = await pool.query(
    `SELECT id, period_label, due_at FROM credit_access_reviews WHERE status = 'open' AND due_at < $1 AND overdue_flagged_at IS NULL`,
    [now]
  );
  for (const r of overdue) {
    await require('../incidentStore').recordIncident({
      type: 'credit_access_review_overdue', severity: 'high',
      message: `Access review ${r.period_label} is overdue`,
      dedupeKey: `credit-access-review-overdue:${r.id}`,
      details: { reviewId: String(r.id), dueAt: r.due_at },
    });
    await pool.query('UPDATE credit_access_reviews SET overdue_flagged_at = NOW() WHERE id = $1', [r.id]);
  }
  return { created, overdue: overdue.length };
}

async function decideItem({ reviewId, itemId, decision, note = null, actorUserId, requestIp = null }) {
  if (!['keep', 'revoke'].includes(decision)) throw new AppError('Decision must be keep or revoke', 400, 'validation_failed', { decision: 'invalid' });
  if (decision === 'revoke' && String(note || '').trim().length < 5) throw new AppError('Say why access should be removed', 400, 'validation_failed', { note: 'required' });
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT i.*, r.status AS review_status FROM credit_access_review_items i JOIN credit_access_reviews r ON r.id = i.review_id
        WHERE i.id = $1 AND i.review_id = $2 FOR UPDATE OF i`,
      [itemId, reviewId]
    );
    const item = rows[0];
    if (!item) throw new AppError('Review item not found', 404, 'credit_access_review_item_not_found');
    if (item.review_status !== 'open') throw new AppError('This review is closed', 409, 'credit_access_review_closed');
    if (String(item.user_id) === String(actorUserId)) throw new AppError('You cannot review your own access', 403, 'credit_access_review_self');
    const { rows: updated } = await client.query(
      `UPDATE credit_access_review_items SET decision = $2, note = $3, decided_by = $4, decided_at = NOW() WHERE id = $1 RETURNING *`,
      [item.id, decision, note ? String(note).trim().slice(0, 1000) : null, actorUserId]
    );
    await insertComplianceAudit(client, {
      actionType: 'credit.access_review.decided', actorUserId, resourceType: 'credit_access_review_item', resourceId: String(item.id),
      reason: decision, requestIp, beforeState: { decision: item.decision }, afterState: { decision, note },
    });
    return updated[0];
  }, 'credit_access_review_decide');
}

function validateComplete(payload = {}) {
  if (!/^\d{1,18}$/.test(String(payload.reviewId || ''))) throw new AppError('Review is required', 400, 'validation_failed', { reviewId: 'required' });
}

/** Oversight executor 'credit_access_review_complete' (two admins). */
async function applyComplete({ client, payload, actorUserId, requestedBy }) {
  validateComplete(payload);
  const { rows } = await client.query('SELECT * FROM credit_access_reviews WHERE id = $1 FOR UPDATE', [payload.reviewId]);
  const review = rows[0];
  if (!review) throw new AppError('Review not found', 404, 'credit_access_review_not_found');
  if (review.status !== 'open') throw new AppError('This review is already complete', 409, 'credit_access_review_closed');
  const { rows: items } = await client.query('SELECT * FROM credit_access_review_items WHERE review_id = $1 ORDER BY id FOR UPDATE', [review.id]);
  const undecided = items.filter((i) => !i.decision);
  if (undecided.length) throw new AppError('Every item needs a decision first', 409, 'credit_access_review_incomplete', { undecided: undecided.length });
  const applied = { grants: 0, apiKeys: 0, roleCases: 0 };
  const { openComplianceCase } = require('../complianceCaseService');
  for (const item of items.filter((i) => i.decision === 'revoke')) {
    if (item.subject_type === 'permission_grant') {
      await client.query(`UPDATE admin_permission_grants SET revoked_at = NOW(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL`, [item.subject_ref, actorUserId]);
      applied.grants += 1;
    } else if (item.subject_type === 'api_key') {
      await client.query(`UPDATE admin_api_keys SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`, [item.subject_ref]);
      applied.apiKeys += 1;
    } else {
      await openComplianceCase(client, {
        caseType: 'access_review_revocation', subjectType: 'platform', subjectId: String(item.user_id), severity: 'high',
        evidence: { reviewId: String(review.id), period: review.period_label, itemId: String(item.id), note: item.note, snapshot: item.snapshot },
        dedupeKey: `credit-access-review:${review.id}:${item.id}`,
      });
      applied.roleCases += 1;
    }
    await client.query('UPDATE credit_access_review_items SET applied_at = NOW() WHERE id = $1', [item.id]);
  }
  const summaryJson = { items: items.length, kept: items.filter((i) => i.decision === 'keep').length, revoked: items.filter((i) => i.decision === 'revoke').length, applied };
  const { rows: done } = await client.query(
    `UPDATE credit_access_reviews
        SET status = 'completed', completed_at = NOW(), completed_requested_by = $2, completed_approved_by = $3, summary = $4::jsonb
      WHERE id = $1 RETURNING *`,
    [review.id, requestedBy, actorUserId, JSON.stringify(summaryJson)]
  );
  await insertComplianceAudit(client, {
    actionType: 'credit.access_review.completed', actorUserId, resourceType: 'credit_access_review', resourceId: String(review.id),
    reason: `Access review ${review.period_label} completed`, afterState: { ...summaryJson, requestedBy },
  });
  return { id: String(done[0].id), status: done[0].status, summary: summaryJson };
}
applyComplete.validate = validateComplete;

async function listReviews() {
  const { rows } = await pool.query(
    `SELECT r.*, COUNT(i.id) FILTER (WHERE i.decision IS NULL)::int AS undecided
       FROM credit_access_reviews r LEFT JOIN credit_access_review_items i ON i.review_id = r.id
      GROUP BY r.id ORDER BY r.created_at DESC LIMIT 20`
  );
  return rows.map((r) => ({ ...r, id: String(r.id) }));
}

async function getReview(reviewId) {
  const { rows } = await pool.query('SELECT * FROM credit_access_reviews WHERE id = $1', [reviewId]);
  if (!rows[0]) throw new AppError('Review not found', 404, 'credit_access_review_not_found');
  const { rows: items } = await pool.query(
    `SELECT i.*, u.email AS subject_email FROM credit_access_review_items i LEFT JOIN users u ON u.id = i.user_id
      WHERE i.review_id = $1 ORDER BY i.subject_type, i.id`,
    [reviewId]
  );
  return { review: { ...rows[0], id: String(rows[0].id) }, items: items.map((i) => ({ ...i, id: String(i.id), review_id: String(i.review_id) })) };
}

function registerOversightActions(register) {
  register('credit_access_review_complete', applyComplete);
}

module.exports = { quarterOf, ensureCurrentReview, decideItem, applyComplete, validateComplete, listReviews, getReview, registerOversightActions };
