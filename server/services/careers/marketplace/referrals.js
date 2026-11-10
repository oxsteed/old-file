'use strict';

// Careers employer referral program (docs/careers/marketplace.md §10.2).
// Off unless CAREERS_REFERRALS_ENABLED=true. Any signed-in user can get a
// code; a business owner can attach one code once, before its first paid
// plan. Paid plan invoices during the commission window (default 6 months)
// accrue a commission (default 15%) into a ledger. Payouts need two
// distinct admins (first + second approval), then a manual "paid" mark
// with a reference; refunds void unpaid commissions. Self-referral (owner
// or member of the referred business) is refused. No outside payout vendor.

const crypto = require('crypto');
const { AppError } = require('../../../middleware/errorHandler');
const { referralsConfig } = require('../providers/config');
const { featureOff, requireId, notFound } = require('./common');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function assertEnabled() {
  if (!referralsConfig().enabled) throw featureOff('referrals');
}

function newCode() {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

async function myCode(db, userId) {
  assertEnabled();
  const { rows: [existing] } = await db.query('SELECT id, code, disabled_at FROM career_referral_codes WHERE user_id = $1', [userId]);
  if (existing) return existing;
  for (let i = 0; i < 5; i += 1) {
    const { rows: [row] } = await db.query(
      `INSERT INTO career_referral_codes (user_id, code) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id, code, disabled_at`,
      [userId, newCode()]
    );
    if (row) return row;
    const { rows: [mine] } = await db.query('SELECT id, code, disabled_at FROM career_referral_codes WHERE user_id = $1', [userId]);
    if (mine) return mine;
  }
  throw new AppError('Could not create a code, try again', 503, 'referral_code_retry');
}

async function summary(db, userId) {
  const code = await myCode(db, userId);
  const { rows: [stats] } = await db.query(
    `SELECT COUNT(DISTINCT a.id)::int AS businesses,
            COALESCE(SUM(c.amount_cents) FILTER (WHERE c.status = 'pending'), 0)::bigint AS pending_cents,
            COALESCE(SUM(c.amount_cents) FILTER (WHERE c.status = 'approved'), 0)::bigint AS approved_cents,
            COALESCE(SUM(c.amount_cents) FILTER (WHERE c.status = 'paid'), 0)::bigint AS paid_cents,
            MAX(c.currency) AS currency
       FROM career_referral_attributions a
       LEFT JOIN career_referral_commissions c ON c.attribution_id = a.id
      WHERE a.code_id = $1 AND a.voided_at IS NULL`,
    [code.id]
  );
  const cfg = referralsConfig();
  return {
    enabled: cfg.enabled,
    code: code.code,
    active: !code.disabled_at,
    rate_bps: cfg.rateBps,
    months: cfg.months,
    businesses: stats.businesses,
    pending_cents: Number(stats.pending_cents),
    approved_cents: Number(stats.approved_cents),
    paid_cents: Number(stats.paid_cents),
    currency: stats.currency || 'usd',
  };
}

/** Attach a code to a business (owner only, once, before a paid plan). */
async function attribute(db, { businessId, actor, code, isOwner }) {
  assertEnabled();
  if (!isOwner) throw new AppError('Only the business owner can add a referral code', 403, 'owner_only');
  const clean = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(clean)) throw new AppError('Validation failed', 400, 'validation_failed', { code: 'Enter the 8-character code' });
  const { rows: [rc] } = await db.query('SELECT id, user_id, disabled_at FROM career_referral_codes WHERE code = $1', [clean]);
  if (!rc || rc.disabled_at) throw new AppError('Validation failed', 400, 'validation_failed', { code: 'That code is not valid' });
  const { rows: [self] } = await db.query(
    `SELECT 1 FROM businesses WHERE id = $1 AND user_id = $2
     UNION SELECT 1 FROM business_members WHERE business_id = $1 AND member_id = $2 AND status IN ('active','pending') LIMIT 1`,
    [businessId, rc.user_id]
  );
  if (self) throw new AppError('Validation failed', 400, 'validation_failed', { code: 'You cannot use your own team’s code' });
  const { rows: [paid] } = await db.query(
    `SELECT 1 FROM career_employer_subscriptions WHERE business_id = $1 AND status IN ('active','past_due','unpaid','canceled') LIMIT 1`,
    [businessId]
  );
  if (paid) throw new AppError('A referral code can only be added before the first paid plan', 409, 'referral_too_late');
  const { rows: [row] } = await db.query(
    `INSERT INTO career_referral_attributions (code_id, business_id, attributed_by, commission_ends_at)
     VALUES ($1, $2, $3, NOW() + make_interval(months => $4::int)) ON CONFLICT (business_id) DO NOTHING RETURNING id, attributed_at`,
    [rc.id, businessId, actor.id, referralsConfig().months]
  );
  if (!row) throw new AppError('This business already has a referral code', 409, 'referral_exists');
  return { attributed: true, attributed_at: row.attributed_at };
}

/** Called from the plan webhook on invoice.paid (inside its transaction). */
async function accrueFromInvoice(db, { businessId, invoiceId, amountPaidCents, currency }) {
  if (!referralsConfig().enabled || !invoiceId || !(amountPaidCents > 0)) return null;
  const { rows: [a] } = await db.query(
    `SELECT a.id FROM career_referral_attributions a JOIN career_referral_codes c ON c.id = a.code_id
      WHERE a.business_id = $1 AND a.voided_at IS NULL AND c.disabled_at IS NULL AND a.commission_ends_at > NOW()`,
    [businessId]
  );
  if (!a) return null;
  const rate = referralsConfig().rateBps;
  const amount = Math.floor((Number(amountPaidCents) * rate) / 10000);
  const { rows: [row] } = await db.query(
    `INSERT INTO career_referral_commissions (attribution_id, stripe_invoice_id, invoice_amount_cents, amount_cents, currency, rate_bps)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (stripe_invoice_id) DO NOTHING RETURNING id`,
    [a.id, invoiceId, amountPaidCents, amount, String(currency || 'usd').toLowerCase().slice(0, 3), rate]
  );
  return row ? row.id : null;
}

async function voidForInvoice(db, invoiceId, reason = 'refunded') {
  const { rowCount } = await db.query(
    `UPDATE career_referral_commissions SET status = 'void', paid_reference = $2
      WHERE stripe_invoice_id = $1 AND status IN ('pending','approved')`,
    [invoiceId, `void:${reason}`.slice(0, 120)]
  );
  return rowCount;
}

// ── Admin ───────────────────────────────────────────────────────────────────

async function listCommissions(db, { status = 'pending' } = {}) {
  const allowed = ['pending', 'approved', 'paid', 'void'];
  const { rows } = await db.query(
    `SELECT c.id, c.status, c.amount_cents::float8 AS amount_cents, c.invoice_amount_cents::float8 AS invoice_amount_cents, c.currency, c.rate_bps, c.created_at,
            c.first_approver, c.first_approved_at, c.second_approver, c.approved_at, c.paid_reference, c.paid_at,
            c.stripe_invoice_id, a.business_id, b.business_name, rc.code, rc.user_id AS referrer_user_id
       FROM career_referral_commissions c
       JOIN career_referral_attributions a ON a.id = c.attribution_id
       JOIN career_referral_codes rc ON rc.id = a.code_id
       JOIN businesses b ON b.id = a.business_id
      WHERE c.status = $1 ORDER BY c.created_at LIMIT 200`,
    [allowed.includes(status) ? status : 'pending']
  );
  return rows;
}

/**
 * Two distinct admins approve a payout. The first call records the first
 * approver; the second must be a different admin and moves it to approved.
 */
async function approveCommission(db, { commissionId, admin }) {
  const id = requireId(commissionId, 'Commission not found');
  const { rows: [c] } = await db.query('SELECT * FROM career_referral_commissions WHERE id = $1 FOR UPDATE', [id]);
  if (!c) throw notFound('Commission not found');
  if (c.status !== 'pending') throw new AppError('Only pending commissions can be approved', 409, 'invalid_state');
  if (!c.first_approver) {
    await db.query('UPDATE career_referral_commissions SET first_approver = $2, first_approved_at = NOW() WHERE id = $1', [id, admin.id]);
    return { id, status: 'pending', approvals: 1 };
  }
  if (c.first_approver === admin.id) throw new AppError('A second, different admin must approve this payout', 409, 'second_approver_required');
  await db.query(
    `UPDATE career_referral_commissions SET second_approver = $2, approved_at = NOW(), status = 'approved' WHERE id = $1`,
    [id, admin.id]
  );
  return { id, status: 'approved', approvals: 2 };
}

async function markPaid(db, { commissionId, admin, reference }) {
  const id = requireId(commissionId, 'Commission not found');
  const ref = String(reference || '').trim().slice(0, 120);
  if (!ref) throw new AppError('Validation failed', 400, 'validation_failed', { reference: 'Add the payout reference' });
  const { rows: [row] } = await db.query(
    `UPDATE career_referral_commissions SET status = 'paid', paid_reference = $2, paid_at = NOW()
      WHERE id = $1 AND status = 'approved' AND second_approver IS NOT NULL AND second_approver <> first_approver RETURNING id`,
    [id, ref]
  );
  if (!row) throw new AppError('Only approved commissions can be marked paid', 409, 'invalid_state');
  return { id, status: 'paid', marked_by: admin.id };
}

async function voidCommission(db, { commissionId, reason }) {
  const id = requireId(commissionId, 'Commission not found');
  const { rows: [row] } = await db.query(
    `UPDATE career_referral_commissions SET status = 'void', paid_reference = $2 WHERE id = $1 AND status IN ('pending','approved') RETURNING id`,
    [id, `void:${String(reason || 'admin').slice(0, 100)}`]
  );
  if (!row) throw new AppError('Only unpaid commissions can be voided', 409, 'invalid_state');
  return { id, status: 'void' };
}

module.exports = {
  newCode,
  myCode,
  summary,
  attribute,
  accrueFromInvoice,
  voidForInvoice,
  listCommissions,
  approveCommission,
  markPaid,
  voidCommission,
};
