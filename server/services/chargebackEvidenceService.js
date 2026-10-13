'use strict';

/**
 * Stripe chargeback evidence (review P3-814).
 *
 * Every charge.dispute.* webhook upserts a stripe_chargebacks row with the
 * evidence deadline. Evidence is assembled from platform records (job,
 * completion confirmations, food order, customer identity) and:
 *  - staged at Stripe (submit=false) as soon as the dispute opens, so an
 *    admin can review and add to it in the Stripe dashboard or via the
 *    admin API;
 *  - submitted by an admin (POST /api/admin/super/chargebacks/:id/submit);
 *  - auto-submitted by the deadline job when the deadline is near and
 *    nobody has submitted (CHARGEBACK_AUTO_SUBMIT, default on), so a
 *    dispute is never silently forfeited.
 */

const db = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');

const OPEN_STATUSES = new Set(['needs_response', 'warning_needs_response']);
const MAX_TEXT = 19000; // Stripe text evidence fields cap at 20,000 chars.

function stripeClient() {
  // eslint-disable-next-line global-require
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

function idOf(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id || null;
}

function toDate(unixSeconds) {
  const n = Number(unixSeconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}

async function upsertFromStripe(dispute, accountId = null, runner = db) {
  if (!dispute?.id) return null;
  const chargeId = idOf(dispute.charge);
  const piId = idOf(dispute.payment_intent);
  const dueBy = toDate(dispute.evidence_details?.due_by);
  const hasEvidence = Boolean(dispute.evidence_details?.has_evidence);
  const submissionCount = Number(dispute.evidence_details?.submission_count || 0);
  const { rows: [row] } = await runner.query(
    `INSERT INTO stripe_chargebacks
       (stripe_dispute_id, stripe_account_id, stripe_charge_id, stripe_payment_intent_id,
        amount_cents, currency_code, reason, stripe_status, evidence_due_by,
        has_evidence, submission_count)
     VALUES ($1, $2, $3, $4, $5, UPPER($6), $7, $8, $9, $10, $11)
     ON CONFLICT (stripe_dispute_id) DO UPDATE
       SET stripe_status = EXCLUDED.stripe_status,
           evidence_due_by = COALESCE(EXCLUDED.evidence_due_by, stripe_chargebacks.evidence_due_by),
           has_evidence = EXCLUDED.has_evidence,
           submission_count = GREATEST(stripe_chargebacks.submission_count, EXCLUDED.submission_count),
           evidence_submitted_at = CASE
             WHEN EXCLUDED.submission_count > 0 AND stripe_chargebacks.evidence_submitted_at IS NULL THEN NOW()
             ELSE stripe_chargebacks.evidence_submitted_at
           END,
           updated_at = NOW()
     RETURNING *`,
    [
      dispute.id, accountId || null, chargeId, piId,
      Number(dispute.amount || 0), dispute.currency || 'usd', dispute.reason || null,
      dispute.status || 'needs_response', dueBy, hasEvidence, submissionCount,
    ]
  );
  return row;
}

function clip(text) {
  if (text === null || text === undefined) return undefined;
  const s = String(text).trim();
  return s ? s.slice(0, MAX_TEXT) : undefined;
}

function isoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Builds Stripe dispute evidence from platform records. Returns
 * { evidence, snapshot } where evidence is the Stripe payload.
 */
async function buildEvidence(chargeback, runner = db) {
  const charge = chargeback.stripe_charge_id;
  const pi = chargeback.stripe_payment_intent_id;
  const lines = [
    `OxSteed marketplace record for Stripe dispute ${chargeback.stripe_dispute_id}.`,
  ];
  const evidence = {};
  const snapshot = { sources: [] };

  const { rows: [payment] } = await runner.query(
    `SELECT p.id, p.job_id, p.payer_id, p.payee_id, p.amount, p.currency, p.status, p.created_at,
            j.title, j.description, j.status AS job_status, j.completed_at,
            j.completion_confirmed_at, j.started_at, j.scheduled_start_at,
            j.location_city, j.location_state,
            cu.email AS customer_email, cu.first_name AS customer_first, cu.last_name AS customer_last,
            hu.first_name AS helper_first, hu.last_name AS helper_last
       FROM payments p
       LEFT JOIN jobs j ON j.id = p.job_id
       LEFT JOIN users cu ON cu.id = p.payer_id
       LEFT JOIN users hu ON hu.id = p.payee_id
      WHERE ($1::text IS NOT NULL AND p.stripe_charge_id = $1)
         OR ($2::text IS NOT NULL AND p.stripe_payment_intent_id = $2)
      ORDER BY p.id DESC LIMIT 1`,
    [charge, pi]
  );
  if (payment) {
    snapshot.sources.push({ type: 'job_payment', paymentId: payment.id, jobId: payment.job_id });
    evidence.customer_email_address = clip(payment.customer_email);
    evidence.customer_name = clip([payment.customer_first, payment.customer_last].filter(Boolean).join(' '));
    evidence.product_description = clip(`Local service job: ${payment.title || 'job'}. ${payment.description || ''}`);
    evidence.service_date = isoDate(payment.completed_at || payment.started_at || payment.scheduled_start_at) || undefined;
    lines.push(
      `Job "${payment.title || payment.job_id}" (status ${payment.job_status || 'unknown'}) was booked through OxSteed`
      + `${payment.location_city ? ` in ${payment.location_city}${payment.location_state ? `, ${payment.location_state}` : ''}` : ''}.`
    );
    if (payment.started_at) lines.push(`Work started: ${new Date(payment.started_at).toISOString()}.`);
    if (payment.completed_at) lines.push(`Work marked complete: ${new Date(payment.completed_at).toISOString()}.`);
    if (payment.completion_confirmed_at) {
      lines.push(`Customer confirmed completion: ${new Date(payment.completion_confirmed_at).toISOString()}.`);
    }
    if (payment.job_id) {
      const { rows: agreements } = await runner.query(
        `SELECT a.id, a.status, a.created_at,
                (SELECT MAX(s.signed_at) FROM work_agreement_signatures s WHERE s.agreement_id = a.id) AS last_signed_at
           FROM work_agreements a WHERE a.job_id = $1 ORDER BY a.created_at DESC LIMIT 1`,
        [payment.job_id]
      ).catch(() => ({ rows: [] }));
      if (agreements[0]) {
        lines.push(`A bilateral work agreement (${agreements[0].status}) exists`
          + `${agreements[0].last_signed_at ? `, last signed ${new Date(agreements[0].last_signed_at).toISOString()}` : ''}.`);
        snapshot.sources.push({ type: 'work_agreement', id: agreements[0].id });
      }
    }
  } else {
    const { rows: [order] } = await runner.query(
      `SELECT fo.id, fo.status, fo.created_at, fo.handed_off_at, fo.total_cents, fo.currency_code,
              fo.guest_name, fo.guest_email, fo.fulfillment_type,
              u.email AS customer_email, u.first_name, u.last_name,
              r.display_name AS restaurant_name
         FROM food_orders fo
         LEFT JOIN users u ON u.id = fo.customer_id
         LEFT JOIN food_restaurants r ON r.id = fo.restaurant_id
        WHERE $1::text IS NOT NULL AND fo.stripe_payment_intent_id = $1
        ORDER BY fo.id DESC LIMIT 1`,
      [pi]
    );
    if (order) {
      snapshot.sources.push({ type: 'food_order', orderId: order.id });
      evidence.customer_email_address = clip(order.customer_email || order.guest_email);
      evidence.customer_name = clip([order.first_name, order.last_name].filter(Boolean).join(' ') || order.guest_name);
      evidence.product_description = clip(`Food order #${order.id} from ${order.restaurant_name || 'a restaurant'} (${order.fulfillment_type || 'order'}).`);
      evidence.service_date = isoDate(order.handed_off_at || order.created_at) || undefined;
      lines.push(`Order status: ${order.status}. Placed ${new Date(order.created_at).toISOString()}.`);
      if (order.handed_off_at) lines.push(`Handed off to the customer: ${new Date(order.handed_off_at).toISOString()}.`);
    }
  }
  if (snapshot.sources.length === 0) {
    lines.push('No matching marketplace record was found for this charge; manual review required.');
  }
  evidence.uncategorized_text = clip(lines.join('\n'));
  for (const key of Object.keys(evidence)) if (evidence[key] === undefined) delete evidence[key];
  snapshot.evidence = evidence;
  return { evidence, snapshot };
}

async function pushEvidence(chargeback, { submit, actorId = null, auto = false, extraText = null }, runner = db) {
  if (!OPEN_STATUSES.has(chargeback.stripe_status)) {
    throw new AppError('This dispute no longer accepts evidence', 409, 'dispute_not_open');
  }
  const { evidence, snapshot } = await buildEvidence(chargeback, runner);
  if (extraText) {
    evidence.uncategorized_text = clip(`${evidence.uncategorized_text || ''}\n\nAdmin note: ${extraText}`);
  }
  try {
    await stripeClient().disputes.update(
      chargeback.stripe_dispute_id,
      { evidence, submit: Boolean(submit), metadata: { oxsteed_staged: 'true' } },
      chargeback.stripe_account_id ? { stripeAccount: chargeback.stripe_account_id } : undefined
    );
  } catch (err) {
    await runner.query(
      `UPDATE stripe_chargebacks SET attempts = attempts + 1, last_error = $2, updated_at = NOW() WHERE id = $1`,
      [chargeback.id, String(err.message || 'stripe error').slice(0, 1000)]
    );
    throw new AppError('Stripe rejected the dispute evidence', 502, 'dispute_evidence_failed');
  }
  const { rows: [row] } = await runner.query(
    `UPDATE stripe_chargebacks
        SET evidence_snapshot = $2::jsonb,
            evidence_staged_at = COALESCE(evidence_staged_at, NOW()),
            evidence_submitted_at = CASE WHEN $3 THEN NOW() ELSE evidence_submitted_at END,
            submitted_by = CASE WHEN $3 THEN $4::uuid ELSE submitted_by END,
            auto_submitted = CASE WHEN $3 THEN $5 ELSE auto_submitted END,
            has_evidence = TRUE,
            attempts = attempts + 1,
            last_error = NULL,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [chargeback.id, JSON.stringify(snapshot), Boolean(submit), actorId, Boolean(auto)]
  );
  return row;
}

/** Webhook entry: record the dispute and stage evidence on first sight. */
async function handleDisputeWebhook(dispute, accountId) {
  const row = await upsertFromStripe(dispute, accountId);
  if (!row) return null;
  if (OPEN_STATUSES.has(row.stripe_status) && !row.evidence_staged_at && !row.evidence_submitted_at) {
    try {
      return await pushEvidence(row, { submit: false });
    } catch (err) {
      // Staging is best effort; the deadline job retries and alerts.
      logger.warn('Chargeback evidence staging failed', { disputeId: row.stripe_dispute_id, error: err.message });
    }
  }
  return row;
}

async function submitEvidence(chargebackId, { actorId, note }) {
  const { rows: [row] } = await db.query('SELECT * FROM stripe_chargebacks WHERE id = $1', [chargebackId]);
  if (!row) throw new AppError('Chargeback not found', 404, 'not_found');
  if (row.evidence_submitted_at) throw new AppError('Evidence was already submitted', 409, 'already_submitted');
  return pushEvidence(row, { submit: true, actorId, extraText: note ? String(note).slice(0, 2000) : null });
}

async function listChargebacks({ open = true, limit = 100 } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM stripe_chargebacks
      WHERE ($1::boolean = FALSE OR (evidence_submitted_at IS NULL AND stripe_status IN ('needs_response','warning_needs_response')))
      ORDER BY evidence_due_by ASC NULLS LAST, id DESC
      LIMIT $2`,
    [Boolean(open), Math.min(500, Math.max(1, Number(limit) || 100))]
  );
  return rows;
}

function autoSubmitEnabled() {
  return String(process.env.CHARGEBACK_AUTO_SUBMIT ?? 'true').toLowerCase() !== 'false';
}

function autoSubmitLeadHours() {
  const n = Number(process.env.CHARGEBACK_AUTO_SUBMIT_LEAD_HOURS || 24);
  return Number.isFinite(n) && n > 0 ? n : 24;
}

module.exports = {
  OPEN_STATUSES,
  upsertFromStripe,
  buildEvidence,
  pushEvidence,
  handleDisputeWebhook,
  submitEvidence,
  listChargebacks,
  autoSubmitEnabled,
  autoSubmitLeadHours,
};
