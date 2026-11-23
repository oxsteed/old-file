'use strict';
// Group 4 rest, item 193: repeat customer follow-up. The helper sees the
// customers they completed work for and may send a "book me again" invite:
// an in-app notification linking to the helper's public profile. Limits:
// only customers with a completed job with this helper, at most one invite
// per customer per 30 days (serialized per pair), optional note <= 500 chars.
// No email, no customer contact details are exposed (first name only).
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const { sendNotification } = require('./notificationService');
const { requireHelper } = require('./helperReputationService');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COOLDOWN_DAYS = 30;

async function list(helperId) {
  await requireHelper(pool, helperId);
  const { rows } = await pool.query(
    `SELECT j.client_id AS customer_id,
            NULLIF(BTRIM(u.first_name), '') AS first_name,
            COUNT(*)::int AS completed_jobs,
            MAX(COALESCE(j.completed_at, j.updated_at)) AS last_completed_at,
            (ARRAY_AGG(j.title ORDER BY COALESCE(j.completed_at, j.updated_at) DESC))[1] AS last_job_title,
            (SELECT MAX(i.sent_at) FROM helper_rebook_invites i WHERE i.helper_id = $1 AND i.customer_id = j.client_id) AS last_invited_at
       FROM jobs j
       JOIN users u ON u.id = j.client_id
      WHERE j.assigned_helper_id = $1 AND j.status IN ('completed','closed') AND j.deleted_at IS NULL
        AND j.client_id <> $1
      GROUP BY j.client_id, u.first_name
      ORDER BY last_completed_at DESC
      LIMIT 200`, [helperId]);
  const now = Date.now();
  return rows.map((r) => {
    const next = r.last_invited_at ? new Date(new Date(r.last_invited_at).getTime() + COOLDOWN_DAYS * 86400000) : null;
    return {
      customerId: r.customer_id, firstName: r.first_name || null, completedJobs: r.completed_jobs,
      lastCompletedAt: r.last_completed_at, lastJobTitle: r.last_job_title || null,
      lastInvitedAt: r.last_invited_at, canInvite: !next || next.getTime() <= now, nextInviteAt: next && next.getTime() > now ? next.toISOString() : null,
    };
  });
}

async function invite(helperId, customerId, body) {
  if (!UUID.test(customerId || '')) throw new AppError('Invalid customer', 400, 'validation_failed');
  const note = body?.message == null ? null : String(body.message).trim();
  if (note && note.length > 500) throw new AppError('Validation failed', 400, 'validation_failed', { message: '500 characters max' });
  const row = await withTransaction(pool, async (db) => {
    await requireHelper(db, helperId);
    const { rows: [past] } = await db.query(
      `SELECT 1 FROM jobs WHERE assigned_helper_id = $1 AND client_id = $2
          AND status IN ('completed','closed') AND deleted_at IS NULL LIMIT 1`, [helperId, customerId]);
    if (!past || String(helperId) === String(customerId)) throw new AppError('Customer not found', 404, 'not_found');
    // Serialize invites for this pair so two clicks cannot both pass the cooldown.
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`rebook:${helperId}:${customerId}`]);
    const { rows: [recent] } = await db.query(
      `SELECT sent_at FROM helper_rebook_invites WHERE helper_id = $1 AND customer_id = $2
          AND sent_at > NOW() - ($3 || ' days')::interval ORDER BY sent_at DESC LIMIT 1`,
      [helperId, customerId, String(COOLDOWN_DAYS)]);
    if (recent) throw new AppError('You already invited this customer in the last 30 days', 429, 'rebook_invite_cooldown');
    const { rows: [created] } = await db.query(
      `INSERT INTO helper_rebook_invites (helper_id, customer_id, message) VALUES ($1, $2, $3) RETURNING id, sent_at`,
      [helperId, customerId, note || null]);
    return created;
  }, 'helper_rebook_invite');
  try {
    await sendNotification({
      userId: customerId, type: 'helper_rebook_invite',
      data: { helper_id: helperId, invite_id: row.id, message: note || null },
      action_url: `/helpers/${helperId}`, idempotencyKey: `helper-rebook:${row.id}`,
    });
  } catch (error) {
    logger.warn('Rebook invite notification failed', { inviteId: row.id, error: error.message });
  }
  return { id: row.id, sentAt: row.sent_at };
}

module.exports = { list, invite, COOLDOWN_DAYS };
