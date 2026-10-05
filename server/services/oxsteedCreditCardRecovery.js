'use strict';

const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const { AppError } = require('../middleware/errorHandler');

async function writeEvent(client, { cardId, customerId, actorUserId, correlationId, requestIp, reason }, action, metadata = {}) {
  await client.query(`INSERT INTO oxsteed_credit_audit_events
    (action_type, actor_user_id, customer_id, resource_type, resource_id, correlation_id, request_ip, reason, metadata)
    VALUES ($1, $2, $3, 'credit_card', $4, $5, $6, $7, $8::jsonb)`,
  [`credit.card.${action}`, actorUserId || null, customerId, cardId, correlationId || null, requestIp || null,
    reason || null, JSON.stringify(metadata)]);
}

async function requestReplacement(args) {
  return withTransaction(pool, async client => {
    const { rows } = await client.query(`SELECT * FROM oxsteed_credit_cards WHERE id = $1 AND customer_id = $2 FOR UPDATE`, [args.cardId, args.customerId]);
    if (!rows[0] || args.actorUserId !== args.customerId || !['lost', 'stolen'].includes(rows[0].status))
      throw new AppError('A replacement cannot be requested for this card.', 409, 'credit_card_replacement_blocked');
    const { rows: requests } = await client.query(`INSERT INTO oxsteed_credit_card_replacement_requests
      (retired_card_id, customer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING retired_card_id`, [args.cardId, args.customerId]);
    if (requests.length) await writeEvent(client, args, 'replacement_requested');
    return { replacementPending: true, replayed: !requests.length };
  }, 'credit_card_replacement_request');
}

async function markFound(args) {
  return withTransaction(pool, async client => {
    const { rows } = await client.query(`SELECT * FROM oxsteed_credit_cards WHERE id = $1 AND customer_id = $2 FOR UPDATE`, [args.cardId, args.customerId]);
    const card = rows[0];
    if (!card || args.actorUserId !== args.customerId || !['lost', 'stolen'].includes(card.status))
      throw new AppError('This report cannot be updated.', 409, 'credit_card_report_update_blocked');
    if (card.found_at) return { foundAt: card.found_at, replayed: true, status: card.status };
    const { rows: updated } = await client.query(`UPDATE oxsteed_credit_cards SET found_at = NOW() WHERE id = $1 RETURNING found_at`, [args.cardId]);
    await writeEvent(client, args, 'found_after_report', { status: card.status, remainsDisabled: true });
    return { foundAt: updated[0].found_at, status: card.status, replayed: false };
  }, 'credit_card_found');
}

async function listHistory({ cardId, customerId, limit = 25, offset = 0, isAdmin = false }) {
  const size = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 25));
  const start = Math.min(1000000, Math.max(0, Number.parseInt(offset, 10) || 0));
  const { rows: cards } = await pool.query(`SELECT id FROM oxsteed_credit_cards WHERE id = $1
    ${isAdmin ? '' : 'AND customer_id = $2'}`, isAdmin ? [cardId] : [cardId, customerId]);
  if (!cards[0]) throw new AppError('Card not found.', 404, 'credit_card_not_found');
  const { rows } = await pool.query(`SELECT id, action_type, created_at, actor_user_id, customer_id,
    reason, correlation_id, request_ip, before_state, after_state, metadata
    FROM oxsteed_credit_audit_events WHERE resource_type = 'credit_card' AND resource_id = $1
    ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`, [cardId, size + 1, start]);
  return { events: rows.slice(0, size).map(row => ({
    id: String(row.id), action: row.action_type, createdAt: row.created_at,
    actor: row.actor_user_id === row.customer_id ? 'you' : row.actor_user_id ? 'staff' : 'system',
    ...(isAdmin ? { actorUserId: row.actor_user_id, reason: row.reason, correlationId: row.correlation_id,
      requestIp: row.request_ip, beforeState: row.before_state, afterState: row.after_state, metadata: row.metadata } : {}),
  })), pagination: { limit: size, offset: start, hasMore: rows.length > size, nextOffset: rows.length > size ? start + size : null } };
}

async function processReplacementRequests(limit = 10) {
  const { rows: due } = await pool.query(`SELECT retired_card_id FROM oxsteed_credit_card_replacement_requests
    WHERE status = 'pending' AND next_attempt_at <= NOW() ORDER BY created_at LIMIT $1`, [Math.min(25, Math.max(1, limit))]);
  let ready = 0;
  for (const candidate of due) {
    try {
      const done = await withTransaction(pool, async client => {
        // Same lock order as retirement: card before replacement request.
        const { rows: cards } = await client.query(`SELECT c.*, a.status AS account_status, u.is_active AS owner_active
          FROM oxsteed_credit_cards c JOIN oxsteed_credit_accounts a ON a.id = c.account_id
          JOIN users u ON u.id = c.customer_id WHERE c.id = $1 FOR UPDATE OF c, a SKIP LOCKED`, [candidate.retired_card_id]);
        if (!cards[0]) return false;
        const { rows } = await client.query(`SELECT * FROM oxsteed_credit_card_replacement_requests
          WHERE retired_card_id = $1 AND status = 'pending' AND next_attempt_at <= NOW() FOR UPDATE SKIP LOCKED`, [candidate.retired_card_id]);
        const job = rows[0];
        if (!job) return false;
        const retired = cards[0];
        if (!retired || !['lost', 'stolen'].includes(retired.status) || retired.account_status !== 'active' || !retired.owner_active)
          throw new AppError('Replacement requires review.', 409, 'credit_card_replacement_review_required');
        const key = `card-reissue:${job.retired_card_id}`;
        const { rows: existing } = await client.query(`SELECT * FROM oxsteed_credit_cards WHERE idempotency_key = $1`, [key]);
        let card = existing[0];
        if (card && (card.customer_id !== job.customer_id || card.account_id !== retired.account_id))
          throw new AppError('Replacement conflict.', 409, 'credit_card_replacement_conflict');
        if (!card) {
          const { rows: created } = await client.query(`INSERT INTO oxsteed_credit_cards
            (customer_id, account_id, card_type, status, fulfillment_status, idempotency_key, replaces_card_id, issued_by, metadata)
            VALUES ($1, $2, 'virtual', 'pending', 'not_applicable', $3, $4, $1, '{"replacementRequiresActivation":true}') RETURNING *`,
          [job.customer_id, retired.account_id, key, job.retired_card_id]);
          card = created[0];
          await writeEvent(client, { cardId: card.id, customerId: job.customer_id }, 'replacement_ready', { replacesCardId: job.retired_card_id });
        }
        await client.query(`UPDATE oxsteed_credit_card_replacement_requests SET status = 'ready', replacement_card_id = $2,
          attempts = attempts + 1, last_error_code = NULL, updated_at = NOW() WHERE retired_card_id = $1`, [job.retired_card_id, card.id]);
        return true;
      }, 'credit_card_replacement_worker');
      if (done) ready++;
    } catch (error) {
      // Store only an allowlisted public code, never a raw provider/SQL error.
      const reason = ['credit_card_replacement_review_required', 'credit_card_replacement_conflict'].includes(error.code)
        ? error.code : 'credit_card_replacement_unavailable';
      await withTransaction(pool, async client => {
        const { rows } = await client.query(`UPDATE oxsteed_credit_card_replacement_requests SET attempts = attempts + 1,
          status = CASE WHEN attempts >= 7 OR $2 <> 'credit_card_replacement_unavailable' THEN 'failed' ELSE 'pending' END,
          next_attempt_at = NOW() + INTERVAL '5 minutes', last_error_code = $2, updated_at = NOW()
          WHERE retired_card_id = $1 AND status = 'pending' RETURNING customer_id, status, attempts`, [candidate.retired_card_id, reason]);
        if (rows[0]?.status === 'failed') await writeEvent(client, {
          cardId: candidate.retired_card_id, customerId: rows[0].customer_id,
        }, 'replacement_failed', { reasonCode: reason, attempts: rows[0].attempts });
      }, 'credit_card_replacement_failure');
    }
  }
  return { ready };
}

async function retryReplacement(args) {
  if (!args.isAdmin || !args.actorUserId) throw new AppError('Staff authorization required.', 403, 'credit_card_retry_forbidden');
  if (typeof args.reason !== 'string' || !args.reason.trim()) throw new AppError('A review reason is required.', 400, 'credit_card_retry_reason_required');
  return withTransaction(pool, async client => {
    const { rows } = await client.query(`UPDATE oxsteed_credit_card_replacement_requests SET status = 'pending', attempts = 0,
      next_attempt_at = NOW(), last_error_code = NULL, updated_at = NOW()
      WHERE retired_card_id = $1 AND status = 'failed' RETURNING customer_id`, [args.cardId]);
    if (!rows[0]) return { replayed: true };
    await writeEvent(client, { ...args, reason: args.reason.trim().slice(0, 500), customerId: rows[0].customer_id }, 'replacement_retry_authorized');
    return { replayed: false };
  }, 'credit_card_replacement_retry');
}

module.exports = { requestReplacement, markFound, listHistory, processReplacementRequests, retryReplacement };
