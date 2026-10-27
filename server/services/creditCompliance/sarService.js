'use strict';

/**
 * Suspicious activity reports (licence readiness §4).
 *
 * Lifecycle: draft (prepared from one or more compliance cases) ->
 * pending_approval -> approved by a DIFFERENT administrator (oversight
 * 'credit_sar_approve'; DB CHECK credit_sar_two_person) -> filed with the
 * FIU (filing reference recorded) or withdrawn with a reason.
 * Deadline: OXSTEED_SAR_DEADLINE_DAYS (default 30) after detection; the
 * deadline job escalates overdue reports. The subject is never notified
 * (no tipping off): nothing here sends user-facing messages.
 */

const crypto = require('crypto');
const pool = require('../../db');
const AppError = require('../../utils/appError');
const { withTransaction } = require('../../utils/transaction');
const { insertComplianceAudit } = require('./audit');

const DEADLINE_DAYS = () => Math.max(1, Number.parseInt(process.env.OXSTEED_SAR_DEADLINE_DAYS || '30', 10) || 30);
const REGULATOR = () => process.env.OXSTEED_SAR_REGULATOR || 'UCREF';

async function createDraft({ actorUserId, caseIds, narrative = '' }) {
  const ids = [...new Set((caseIds || []).map(String))].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) throw new AppError('At least one compliance case is required', 400, 'validation_failed');
  return withTransaction(pool, async (client) => {
    const { rows: cases } = await client.query(
      `SELECT id, subject_type, subject_id, created_at FROM oxsteed_credit_compliance_cases WHERE id = ANY($1::uuid[])`, [ids]
    );
    if (cases.length !== ids.length) throw new AppError('Unknown compliance case', 404, 'credit_case_not_found');
    const subjects = new Set(cases.map((c) => `${c.subject_type}:${c.subject_id}`));
    if (subjects.size !== 1 || cases[0].subject_type === 'platform') throw new AppError('All cases must concern one customer or partner', 400, 'validation_failed');
    const detectedAt = cases.map((c) => new Date(c.created_at)).sort((a, b) => a - b)[0];
    const dueAt = new Date(detectedAt.getTime() + DEADLINE_DAYS() * 86400000);
    const { rows: [sar] } = await client.query(
      `INSERT INTO credit_sar_reports (subject_type, subject_id, case_ids, regulator, narrative, detected_at, due_at, prepared_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [cases[0].subject_type, cases[0].subject_id, ids, REGULATOR(), String(narrative).slice(0, 20000), detectedAt.toISOString(), dueAt.toISOString(), actorUserId]
    );
    await client.query(
      `UPDATE oxsteed_credit_compliance_cases SET status = 'escalated', updated_at = NOW() WHERE id = ANY($1::uuid[]) AND status <> 'resolved'`, [ids]
    );
    await insertComplianceAudit(client, {
      actionType: 'credit.sar.drafted', actorUserId, resourceType: 'credit_sar_report', resourceId: sar.id,
      afterState: { caseIds: ids, dueAt: sar.due_at },
    });
    return sar;
  }, 'credit_sar_draft');
}

async function updateDraft({ actorUserId, sarId, narrative, activityFrom, activityTo, amountMinor, currencyCode }) {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `UPDATE credit_sar_reports
          SET narrative = COALESCE($2, narrative), activity_from = COALESCE($3, activity_from), activity_to = COALESCE($4, activity_to),
              amount_minor = COALESCE($5, amount_minor), currency_code = COALESCE($6, currency_code), updated_at = NOW()
        WHERE id = $1 AND status = 'draft' RETURNING *`,
      [sarId, narrative === undefined ? null : String(narrative).slice(0, 20000), activityFrom || null, activityTo || null,
        amountMinor === undefined || amountMinor === null ? null : Number(amountMinor), currencyCode || null]
    );
    if (!rows[0]) throw new AppError('Draft not found', 404, 'sar_not_found');
    await insertComplianceAudit(client, { actionType: 'credit.sar.updated', actorUserId, resourceType: 'credit_sar_report', resourceId: sarId });
    return rows[0];
  }, 'credit_sar_update');
}

/** Maker submits; the checker approves via the oversight action. */
async function submitForApproval({ actorUserId, sarId }) {
  const { rows } = await pool.query(
    `UPDATE credit_sar_reports SET status = 'pending_approval', updated_at = NOW()
      WHERE id = $1 AND status = 'draft' AND length(trim(narrative)) >= 50 RETURNING *`,
    [sarId]
  );
  if (!rows[0]) throw new AppError('Only a draft with a narrative of at least 50 characters can be submitted', 409, 'sar_state_conflict');
  const pending = require('../oxsteedCreditPendingActionService');
  const action = await pending.requestPendingAction({
    actionType: 'credit_sar_approve', payload: { sarId }, requestedBy: actorUserId, idempotencyKey: `sar-approve:${sarId}:${new Date(rows[0].updated_at).toISOString()}`,
  });
  return { sar: rows[0], pendingAction: action.pendingAction };
}

/** After a checker rejects the approval request, the maker can edit again. */
async function returnToDraft({ actorUserId, sarId }) {
  const { rows } = await pool.query(
    `UPDATE credit_sar_reports SET status = 'draft', updated_at = NOW()
      WHERE id = $1 AND status = 'pending_approval'
        AND NOT EXISTS (SELECT 1 FROM oxsteed_credit_pending_actions p
                         WHERE p.action_type = 'credit_sar_approve' AND p.status = 'pending' AND p.payload->>'sarId' = $1::text)
      RETURNING *`,
    [sarId]
  );
  if (!rows[0]) throw new AppError('The approval request is still pending', 409, 'sar_state_conflict');
  await insertComplianceAudit(pool, { actionType: 'credit.sar.returned_to_draft', actorUserId, resourceType: 'credit_sar_report', resourceId: sarId });
  return rows[0];
}

function validateApprove(payload) {
  if (!/^[0-9a-f-]{36}$/i.test(String(payload?.sarId || ''))) throw new AppError('sarId is required', 400, 'validation_failed');
  return { sarId: payload.sarId };
}

async function applyApprove({ client, payload, actorUserId }) {
  const v = validateApprove(payload);
  const { rows } = await client.query(
    `UPDATE credit_sar_reports SET status = 'approved', approved_by = $2, approved_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'pending_approval' AND prepared_by <> $2 RETURNING id`,
    [v.sarId, actorUserId]
  );
  if (!rows[0]) throw new AppError('SAR is not awaiting approval, or you prepared it', 409, 'sar_state_conflict');
  await insertComplianceAudit(client, { actionType: 'credit.sar.approved', actorUserId, resourceType: 'credit_sar_report', resourceId: v.sarId });
  return { id: v.sarId };
}
applyApprove.validate = validateApprove;

async function markFiled({ actorUserId, sarId, filingReference }) {
  const ref = String(filingReference || '').trim();
  if (ref.length < 3) throw new AppError('The FIU filing reference is required', 400, 'validation_failed');
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `UPDATE credit_sar_reports SET status = 'filed', filed_by = $2, filed_at = NOW(), filing_reference = $3, updated_at = NOW()
        WHERE id = $1 AND status = 'approved' RETURNING *`,
      [sarId, actorUserId, ref.slice(0, 200)]
    );
    if (!rows[0]) throw new AppError('Only an approved SAR can be filed', 409, 'sar_state_conflict');
    await insertComplianceAudit(client, { actionType: 'credit.sar.filed', actorUserId, resourceType: 'credit_sar_report', resourceId: sarId, afterState: { filingReference: ref } });
    return rows[0];
  }, 'credit_sar_file');
}

async function withdraw({ actorUserId, sarId, reason }) {
  const r = String(reason || '').trim();
  if (r.length < 10) throw new AppError('A reason is required', 400, 'validation_failed');
  const { rows } = await pool.query(
    `UPDATE credit_sar_reports SET status = 'withdrawn', withdrawn_reason = $2, updated_at = NOW()
      WHERE id = $1 AND status IN ('draft', 'pending_approval') RETURNING *`,
    [sarId, r]
  );
  if (!rows[0]) throw new AppError('Only drafts can be withdrawn', 409, 'sar_state_conflict');
  await insertComplianceAudit(pool, { actionType: 'credit.sar.withdrawn', actorUserId, resourceType: 'credit_sar_report', resourceId: sarId, reason: r });
  return rows[0];
}

/** Filing pack: report + case evidence + the subject's ledger activity. */
async function buildFilingPack(sarId) {
  const { rows: [sar] } = await pool.query('SELECT * FROM credit_sar_reports WHERE id = $1', [sarId]);
  if (!sar) throw new AppError('SAR not found', 404, 'sar_not_found');
  const { rows: cases } = await pool.query('SELECT * FROM oxsteed_credit_compliance_cases WHERE id = ANY($1::uuid[])', [sar.case_ids]);
  let subject = null;
  let cashouts = [];
  if (sar.subject_type === 'customer') {
    subject = (await pool.query('SELECT id, first_name, last_name, email, phone, country, created_at FROM users WHERE id = $1', [sar.subject_id])).rows[0] || null;
    cashouts = (await pool.query(
      `SELECT id, amount_minor, currency, status, created_at, destination_ref FROM credit_cashout_requests
        WHERE user_id = $1 AND created_at >= COALESCE($2::date, NOW() - INTERVAL '180 days') ORDER BY created_at`,
      [sar.subject_id, sar.activity_from]
    )).rows;
  }
  const pack = { generatedAt: new Date().toISOString(), regulator: sar.regulator, report: sar, subject, cases, cashouts };
  const json = JSON.stringify(pack, null, 2);
  return { json, sha256: crypto.createHash('sha256').update(json).digest('hex') };
}

async function checkDeadlines() {
  const { rows } = await pool.query(
    `SELECT id, due_at, status FROM credit_sar_reports
      WHERE status IN ('draft', 'pending_approval', 'approved') AND due_at < NOW() + INTERVAL '3 days'`
  );
  for (const r of rows) {
    const overdue = new Date(r.due_at) < new Date();
    await require('../incidentStore').recordIncident({
      type: overdue ? 'credit_sar_overdue' : 'credit_sar_due_soon',
      severity: overdue ? 'critical' : 'high',
      message: `SAR ${r.id} is ${overdue ? 'past its filing deadline' : 'due within 3 days'} (status ${r.status})`,
      dedupeKey: `credit-sar:${r.id}:${overdue ? 'overdue' : 'soon'}`,
      details: { sarId: r.id, dueAt: r.due_at },
    }).catch(() => {});
  }
  return { flagged: rows.length };
}

async function list({ status = null, limit = 100 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM credit_sar_reports WHERE ($1::text IS NULL OR status = $1) ORDER BY due_at LIMIT $2`,
    [status, Math.min(Number(limit) || 100, 500)]
  );
  return rows;
}

function registerOversightActions(register) {
  register('credit_sar_approve', applyApprove);
}

module.exports = { createDraft, updateDraft, submitForApproval, returnToDraft, applyApprove, markFiled, withdraw, buildFilingPack, checkDeadlines, list, registerOversightActions };
