'use strict';
// Group 4 rest, item 183 (closes G4-22; Emile approved 2026-11-23): scope
// and price change requests for hired jobs with no open work agreement.
//
//   - Only hired jobs ('accepted' or 'in_progress'). Jobs with an active or
//     pending work agreement use its change orders (409
//     use_work_agreement_change_order).
//   - The assigned helper opens a request; the customer may counter it (a
//     new version in the same thread); either side may counter the other's
//     latest version. Only the party who did NOT propose the latest version
//     accepts or declines it; the proposer may withdraw. One open version
//     per job. Every version is kept (job history).
//   - Line items reuse the quote negotiation terms() validator; with line
//     items the price change is their total (an addition).
//   - Accepting reuses jobChangeOrderFinance.applyApprovedChangeOrder in the
//     same transaction: the agreed price changes, card captures go down or
//     ask for re-authorization, Credit holds are replaced. Nothing is ever
//     charged automatically. A job_revisions row records it.
//   - The other party is notified on every step.
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const { sendNotification } = require('./notificationService');
const { terms } = require('./helperQuoteNegotiation');
const { applyApprovedChangeOrder } = require('./jobChangeOrderFinance');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CHANGE = 2000000000;

function parseBody(body = {}) {
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length < 10 || description.length > 4000) {
    throw new AppError('Validation failed', 400, 'validation_failed', { description: '10-4000 characters' });
  }
  let lineItems = null;
  let price = body.priceChangeCents;
  if (Array.isArray(body.lineItems) && body.lineItems.length) {
    const t = terms({ line_items: body.lineItems, notes: '' });
    lineItems = t.line_items;
    price = t.total_cents;
  }
  if (!Number.isSafeInteger(price) || Math.abs(price) > MAX_CHANGE) {
    throw new AppError('Validation failed', 400, 'validation_failed', { priceChangeCents: 'integer cents' });
  }
  const clientRequestId = body.clientRequestId == null ? null : String(body.clientRequestId).slice(0, 100);
  return { description, lineItems, price, clientRequestId };
}

async function loadJob(db, jobId, userId, lock = false) {
  if (!UUID.test(jobId || '')) throw new AppError('Invalid job', 400, 'validation_failed');
  const { rows: [job] } = await db.query(
    `SELECT id, client_id, assigned_helper_id, status FROM jobs
      WHERE id = $1 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [jobId]);
  const isClient = job && String(job.client_id) === String(userId);
  const isHelper = job && job.assigned_helper_id && String(job.assigned_helper_id) === String(userId);
  if (!job || (!isClient && !isHelper)) throw new AppError('Job not found', 404, 'not_found');
  return { job, isClient, isHelper };
}

async function assertWritable(db, job) {
  if (!['accepted', 'in_progress'].includes(job.status)) {
    throw new AppError('Only hired jobs can change scope', 409, 'change_request_not_allowed');
  }
  const { rows: [wa] } = await db.query(
    "SELECT 1 FROM work_agreements WHERE job_id = $1 AND status IN ('active', 'pending_signatures') LIMIT 1", [job.id]);
  if (wa) throw new AppError('This job has a work agreement; use its change orders', 409, 'use_work_agreement_change_order');
}

function present(r) {
  return {
    id: r.id, threadId: r.thread_id, version: r.version, parentId: r.parent_id, proposedBy: r.proposed_by,
    description: r.description, lineItems: r.line_items, priceChangeCents: Number(r.price_change_cents),
    status: r.status, decidedAt: r.decided_at, appliedJobValueCents: r.applied_job_value_cents == null ? null : Number(r.applied_job_value_cents),
    paymentAction: r.payment_adjustment?.payment_action || null, createdAt: r.created_at,
  };
}

async function notify(userId, type, jobId, rowId) {
  try {
    await sendNotification({ userId, type, data: { job_id: jobId, change_request_id: rowId },
      action_url: `/jobs/${jobId}`, idempotencyKey: `${type}:${rowId}` });
  } catch (error) {
    logger.warn('Change request notification failed', { jobId, error: error.message });
  }
}

const otherParty = (job, userId) => (String(job.client_id) === String(userId) ? job.assigned_helper_id : job.client_id);

async function list(userId, jobId) {
  const { job } = await loadJob(pool, jobId, userId);
  const { rows } = await pool.query(
    'SELECT * FROM job_change_requests WHERE job_id = $1 ORDER BY created_at DESC, version DESC LIMIT 100', [job.id]);
  return rows.map(present);
}

async function propose(userId, jobId, body) {
  const input = parseBody(body);
  const out = await withTransaction(pool, async (db) => {
    const { job, isHelper } = await loadJob(db, jobId, userId, true);
    if (!isHelper) throw new AppError('Only the helper can open a change request; counter an open one instead', 403, 'change_request_helper_only');
    await assertWritable(db, job);
    if (input.clientRequestId) {
      const { rows: [dup] } = await db.query(
        'SELECT * FROM job_change_requests WHERE job_id = $1 AND proposed_by = $2 AND client_request_id = $3',
        [job.id, userId, input.clientRequestId]);
      if (dup) return { job, row: dup, replay: true };
    }
    const { rows: [open] } = await db.query("SELECT id FROM job_change_requests WHERE job_id = $1 AND status = 'proposed'", [job.id]);
    if (open) throw new AppError('A change request is already open on this job', 409, 'change_request_open');
    const { rows: [row] } = await db.query(
      `INSERT INTO job_change_requests (job_id, thread_id, version, proposed_by, description, line_items, price_change_cents, client_request_id)
       VALUES ($1, gen_random_uuid(), 1, $2, $3, $4::jsonb, $5, $6) RETURNING *`,
      [job.id, userId, input.description, input.lineItems ? JSON.stringify(input.lineItems) : null, input.price, input.clientRequestId]);
    return { job, row };
  }, 'job_change_request_propose');
  if (!out.replay) await notify(otherParty(out.job, userId), 'job_change_request_proposed', out.job.id, out.row.id);
  return present(out.row);
}

async function respond(userId, jobId, requestId, body = {}) {
  const action = body.action;
  if (!['accept', 'decline', 'withdraw', 'counter'].includes(action)) {
    throw new AppError('Validation failed', 400, 'validation_failed', { action: 'accept, decline, withdraw or counter' });
  }
  if (!UUID.test(requestId || '')) throw new AppError('Invalid request', 400, 'validation_failed');
  const counterInput = action === 'counter' ? parseBody(body) : null;
  const out = await withTransaction(pool, async (db) => {
    const { job } = await loadJob(db, jobId, userId, true);
    const { rows: [cr] } = await db.query('SELECT * FROM job_change_requests WHERE id = $1 AND job_id = $2 FOR UPDATE', [requestId, job.id]);
    if (!cr) throw new AppError('Change request not found', 404, 'not_found');
    if (cr.status !== 'proposed') throw new AppError('This version is already closed', 409, 'change_request_closed');
    const mine = String(cr.proposed_by) === String(userId);
    if (action === 'withdraw') {
      if (!mine) throw new AppError('Only the proposer can withdraw', 403, 'change_request_forbidden');
      const { rows: [row] } = await db.query(
        "UPDATE job_change_requests SET status = 'withdrawn', decided_by = $2, decided_at = NOW() WHERE id = $1 RETURNING *", [cr.id, userId]);
      return { job, row, type: null };
    }
    if (mine) throw new AppError('The other party must answer this version', 403, 'change_request_forbidden');
    await assertWritable(db, job);
    if (action === 'decline') {
      const { rows: [row] } = await db.query(
        "UPDATE job_change_requests SET status = 'declined', decided_by = $2, decided_at = NOW() WHERE id = $1 RETURNING *", [cr.id, userId]);
      return { job, row, type: 'job_change_request_declined' };
    }
    if (action === 'counter') {
      await db.query("UPDATE job_change_requests SET status = 'countered', decided_by = $2, decided_at = NOW() WHERE id = $1", [cr.id, userId]);
      const { rows: [row] } = await db.query(
        `INSERT INTO job_change_requests (job_id, thread_id, version, parent_id, proposed_by, description, line_items, price_change_cents, client_request_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9) RETURNING *`,
        [job.id, cr.thread_id, cr.version + 1, cr.id, userId, counterInput.description,
          counterInput.lineItems ? JSON.stringify(counterInput.lineItems) : null, counterInput.price, counterInput.clientRequestId]);
      return { job, row, type: 'job_change_request_countered' };
    }
    // accept: apply through the shared change-order money path.
    const { adjustment, newValueCents } = await applyApprovedChangeOrder(db, {
      agreement: { job_id: job.id, helper_id: job.assigned_helper_id },
      changeOrder: { id: cr.id, price_change_cents: Number(cr.price_change_cents) },
      actorId: userId,
    });
    if (Number(cr.price_change_cents) === 0) {
      const { rows: [v] } = await db.query('SELECT version, revision FROM jobs WHERE id = $1', [job.id]);
      await db.query(
        `INSERT INTO job_revisions (job_id, version, revision, is_material, source, actor_id, reason, changes)
         VALUES ($1, $2, $3, TRUE, 'change_order', $4, $5, $6::jsonb)`,
        [job.id, v.version, v.revision, userId, `Change request ${cr.id} accepted`, JSON.stringify({ scope: { change_request_id: cr.id } })]);
    }
    const { rows: [row] } = await db.query(
      `UPDATE job_change_requests SET status = 'accepted', decided_by = $2, decided_at = NOW(),
              applied_job_value_cents = $3, payment_adjustment = $4::jsonb WHERE id = $1 RETURNING *`,
      [cr.id, userId, newValueCents ?? null, JSON.stringify(adjustment || {})]);
    return { job, row, type: 'job_change_request_accepted' };
  }, 'job_change_request_respond');
  if (out.type) await notify(otherParty(out.job, userId), out.type, out.job.id, out.row.id);
  return present(out.row);
}

module.exports = { list, propose, respond };
