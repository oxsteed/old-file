'use strict';
// Groups 5-6 items 226 (approval thresholds), 227 (work authorization
// policy), 228 (cancellation settings). Owner-only edits, versioned with a
// snapshot history; guards are called from the existing write paths.
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const { fail, invalid, int, text } = require('./common');

const DEFAULTS = { quote_approval_cents: null, expense_approval_cents: null, refund_approval_cents: null, work_start_requires: 'none',
  work_start_min_role: 'employee', default_cancellation_fee_percent: 0, no_show_fee_percent: 0, version: 0,
  allow_self_claim: false, dispatch_confirm_hours: null, require_completion_record: false, escalation_hours: 4 };
const RANK = { employee: 1, support_agent: 2, representative: 3, manager: 4, owner: 5 };

async function policyRow(db, businessId) {
  const { rows: [row] } = await db.query('SELECT * FROM business_operating_policies WHERE business_id=$1', [businessId]);
  return { ...DEFAULTS, ...(row || {}), business_id: Number(businessId) };
}
async function rulesRow(db, businessId) {
  const { rows: [r] } = await db.query('SELECT * FROM business_booking_rules WHERE business_id=$1 ORDER BY id LIMIT 1', [businessId]);
  return r || null;
}

async function read(businessId) {
  const policy = await policyRow(pool, businessId);
  const rules = await rulesRow(pool, businessId);
  const { rows: history } = await pool.query(`SELECT h.version, h.snapshot, h.created_at, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS actor_name
    FROM business_operating_policy_history h LEFT JOIN users u ON u.id=h.actor_id WHERE h.business_id=$1 ORDER BY h.version DESC LIMIT 50`, [businessId]);
  const { rows: pending } = await pool.query(`SELECT 'expense' AS kind, e.id::text AS id, e.amount_cents, e.category AS label, e.created_at, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS requester
      FROM business_expenses e LEFT JOIN users u ON u.id=e.created_by WHERE e.business_id=$1 AND e.approval_status='pending'
    UNION ALL
    SELECT 'quote', q.id::text, q.total_cents, q.title, q.created_at, TRIM(CONCAT(u.first_name,' ',u.last_name))
      FROM business_quotes q LEFT JOIN users u ON u.id=q.created_by
     WHERE q.business_id=$1 AND q.status='draft' AND $2::int IS NOT NULL AND q.total_cents > $2 AND (q.approved_total_cents IS DISTINCT FROM q.total_cents)
    ORDER BY created_at DESC LIMIT 100`, [businessId, policy.quote_approval_cents]);
  return {
    policy,
    cancellation: {
      notice_hours: rules?.cancellation_allowed_hours_before ?? 24,
      allow_customer_reschedule: rules?.allow_customer_reschedule ?? true,
      auto_cancel_no_show_hours: rules?.auto_cancel_no_show_hours ?? null,
      fee_percent: policy.default_cancellation_fee_percent,
      no_show_fee_percent: policy.no_show_fee_percent,
    },
    history, pending,
  };
}

const optCents = (v, f) => (v === null || v === '' || v === undefined ? null : int(v, { min: 1, max: 100000000, field: f }));

async function update(businessId, actorId, body) {
  const expected = int(body?.expectedVersion, { field: 'expectedVersion' });
  const next = {
    quote_approval_cents: optCents(body.quote_approval_cents, 'quote_approval_cents'),
    expense_approval_cents: optCents(body.expense_approval_cents, 'expense_approval_cents'),
    refund_approval_cents: optCents(body.refund_approval_cents, 'refund_approval_cents'),
    work_start_requires: body.work_start_requires,
    work_start_min_role: body.work_start_min_role,
    default_cancellation_fee_percent: int(body.default_cancellation_fee_percent ?? 0, { min: 0, max: 100, field: 'fee' }),
    no_show_fee_percent: int(body.no_show_fee_percent ?? 0, { min: 0, max: 100, field: 'no_show_fee' }),
  };
  if (!['none', 'confirmed_booking', 'accepted_quote'].includes(next.work_start_requires)) invalid('work_start_requires');
  if (!['employee', 'representative', 'manager', 'owner'].includes(next.work_start_min_role)) invalid('work_start_min_role');
  const notice = int(body.cancellation_notice_hours ?? 24, { min: 0, max: 720, field: 'notice' });
  const noShowHours = body.auto_cancel_no_show_hours == null || body.auto_cancel_no_show_hours === '' ? null : int(body.auto_cancel_no_show_hours, { min: 1, max: 72, field: 'no_show_hours' });
  const allowReschedule = body.allow_customer_reschedule !== false;
  return withTransaction(pool, async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-policy:${businessId}`]);
    const cur = await policyRow(db, businessId);
    if (cur.version !== expected) fail(409, 'conflict');
    // Team work settings (items 256, 260, 281, 289); omitted fields keep their value.
    next.allow_self_claim = body.allow_self_claim === undefined ? cur.allow_self_claim : body.allow_self_claim === true;
    next.require_completion_record = body.require_completion_record === undefined ? cur.require_completion_record : body.require_completion_record === true;
    next.dispatch_confirm_hours = body.dispatch_confirm_hours === undefined ? cur.dispatch_confirm_hours
      : (body.dispatch_confirm_hours === null || body.dispatch_confirm_hours === '' ? null : int(body.dispatch_confirm_hours, { min: 1, max: 168, field: 'dispatch_confirm_hours' }));
    next.escalation_hours = body.escalation_hours === undefined ? cur.escalation_hours : int(body.escalation_hours, { min: 1, max: 168, field: 'escalation_hours' });
    const { rows: [row] } = await db.query(`INSERT INTO business_operating_policies(business_id,quote_approval_cents,expense_approval_cents,refund_approval_cents,
        work_start_requires,work_start_min_role,default_cancellation_fee_percent,no_show_fee_percent,version,updated_by,updated_at,
        allow_self_claim,dispatch_confirm_hours,require_completion_record,escalation_hours)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,NOW(),$10,$11,$12,$13)
      ON CONFLICT (business_id) DO UPDATE SET quote_approval_cents=EXCLUDED.quote_approval_cents, expense_approval_cents=EXCLUDED.expense_approval_cents,
        refund_approval_cents=EXCLUDED.refund_approval_cents, work_start_requires=EXCLUDED.work_start_requires, work_start_min_role=EXCLUDED.work_start_min_role,
        default_cancellation_fee_percent=EXCLUDED.default_cancellation_fee_percent, no_show_fee_percent=EXCLUDED.no_show_fee_percent,
        allow_self_claim=EXCLUDED.allow_self_claim, dispatch_confirm_hours=EXCLUDED.dispatch_confirm_hours,
        require_completion_record=EXCLUDED.require_completion_record, escalation_hours=EXCLUDED.escalation_hours,
        version=business_operating_policies.version+1, updated_by=EXCLUDED.updated_by, updated_at=NOW() RETURNING *`,
      [businessId, next.quote_approval_cents, next.expense_approval_cents, next.refund_approval_cents, next.work_start_requires, next.work_start_min_role,
        next.default_cancellation_fee_percent, next.no_show_fee_percent, actorId,
        next.allow_self_claim, next.dispatch_confirm_hours, next.require_completion_record, next.escalation_hours]);
    const rules = await rulesRow(db, businessId);
    if (rules) await db.query('UPDATE business_booking_rules SET cancellation_allowed_hours_before=$2, allow_customer_reschedule=$3, auto_cancel_no_show_hours=$4, updated_at=NOW() WHERE id=$1', [rules.id, notice, allowReschedule, noShowHours]);
    else await db.query('INSERT INTO business_booking_rules(business_id,cancellation_allowed_hours_before,allow_customer_reschedule,auto_cancel_no_show_hours) VALUES($1,$2,$3,$4)', [businessId, notice, allowReschedule, noShowHours]);
    await db.query('INSERT INTO business_operating_policy_history(business_id,version,snapshot,actor_id) VALUES($1,$2,$3,$4)',
      [businessId, row.version, JSON.stringify({ ...next, cancellation_notice_hours: notice, allow_customer_reschedule: allowReschedule, auto_cancel_no_show_hours: noShowHours }), actorId]);
    return row;
  }, 'business_policy_update');
}

const isApprover = (role, perms, code) => role === 'owner' || Boolean(perms && perms.has && perms.has(code) && RANK[role] >= RANK.manager);

// 226 quotes: sending a quote above the threshold needs an approver, or an
// approval recorded for exactly the current total.
async function assertQuoteSendAllowed(db, businessId, quoteId, role, perms) {
  const policy = await policyRow(db, businessId);
  if (!policy.quote_approval_cents || isApprover(role, perms, 'quotes.approve_discounts')) return;
  const { rows: [q] } = await db.query('SELECT total_cents, approved_total_cents FROM business_quotes WHERE id=$1 AND business_id=$2', [quoteId, businessId]);
  if (q && Number(q.total_cents) > policy.quote_approval_cents && Number(q.approved_total_cents) !== Number(q.total_cents)) fail(409, 'quote_approval_required', 'This quote needs approval before it can be sent');
}
async function approveQuote(businessId, actorId, quoteId) {
  const id = int(quoteId, { min: 1, field: 'quote' });
  const { rows: [q] } = await pool.query(`UPDATE business_quotes SET approved_by=$3, approved_at=NOW(), approved_total_cents=total_cents, updated_at=NOW()
    WHERE id=$1 AND business_id=$2 AND status='draft' RETURNING id, total_cents, approved_total_cents, approved_at`, [id, businessId, actorId]);
  if (!q) fail(404, 'not_found');
  return q;
}
// 226 expenses: a non-approver's expense above the threshold waits for approval.
async function expenseStatusFor(businessId, role, perms, amountCents) {
  const policy = await policyRow(pool, businessId);
  if (!policy.expense_approval_cents || isApprover(role, perms, 'payouts.manage') || role === 'owner') return 'approved';
  return Number(amountCents) > policy.expense_approval_cents ? 'pending' : 'approved';
}
async function decideExpense(businessId, actorId, expenseId, body) {
  const id = int(expenseId, { min: 1, field: 'expense' });
  if (!['approved', 'rejected'].includes(body?.decision)) invalid('decision');
  const note = text(body?.note, 500, { required: false });
  const { rows: [e] } = await pool.query(`UPDATE business_expenses SET approval_status=$3, approved_by=$4, approval_decided_at=NOW(), approval_note=$5, updated_at=NOW()
    WHERE id=$1 AND business_id=$2 AND approval_status='pending' AND created_by IS DISTINCT FROM $4 RETURNING *`, [id, businessId, body.decision, actorId, note]);
  if (!e) fail(409, 'conflict');
  return e;
}
// 226 refunds: above the threshold only the owner may request a refund
// (it still goes to OxSteed admin approval afterwards).
async function assertRefundRequestAllowed(businessId, role, amountCents, fullRefund) {
  if (role === 'owner') return;
  const policy = await policyRow(pool, businessId);
  if (!policy.refund_approval_cents) return;
  if (fullRefund || Number(amountCents) > policy.refund_approval_cents) fail(403, 'refund_owner_approval_required', 'Refunds above the business limit must be requested by the owner');
}
// 227: starting work (status -> in_progress) honors the business policy.
async function assertWorkStart(db, businessId, appointment, role) {
  const policy = await policyRow(db, businessId);
  if ((RANK[role] || 0) < RANK[policy.work_start_min_role]) fail(403, 'work_start_role_required', 'Your role cannot start work under this business policy');
  if (policy.work_start_requires === 'confirmed_booking' && appointment.status !== 'confirmed') fail(409, 'work_authorization_required', 'Confirm the booking before starting work');
  if (policy.work_start_requires === 'accepted_quote') {
    const { rows: [q] } = await db.query("SELECT 1 FROM business_quotes WHERE business_id=$1 AND appointment_id=$2 AND status IN ('approved','accepted','converted','paid') LIMIT 1", [businessId, appointment.id]);
    if (!q) fail(409, 'work_authorization_required', 'The customer must accept a quote before work starts');
  }
}
async function defaultFees(db, businessId) {
  const p = await policyRow(db, businessId);
  return { fee: p.default_cancellation_fee_percent, noShow: p.no_show_fee_percent };
}

module.exports = { policyRow, read, update, assertQuoteSendAllowed, approveQuote, expenseStatusFor, decideExpense, assertRefundRequestAllowed, assertWorkStart, defaultFees };
