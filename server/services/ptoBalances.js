'use strict';

// Phase 4 Track B (goal goal_a0fc7c0f0394): PTO balances + accrual.
//
// Model (migration 20261106020000):
//   - business_time_off_policies: one accrual rule per employee per
//     time-off type (accrual amount in hours or days per period, plus
//     an optional carryover cap). No policy for a type means that type
//     is unconfigured for the employee: requests are not
//     balance-checked, exactly like before this track (opt-in per
//     employee, so existing staff and tests keep working until a
//     manager sets a policy).
//   - business_time_off_balances: the stored balance per employee per
//     type. The CHECK (balance >= 0) is the last line of defence; the
//     code below also refuses to take a balance below zero.
//   - business_time_off_accrual_events: append-only ledger of every
//     balance movement, so any balance can be reconstructed and
//     audited.
//
// Rules, in one place:
//   - A request consumes whole calendar days, inclusive of both ends.
//     A days-unit policy consumes that many days. An hours-unit policy
//     consumes the SCHEDULED hours on the requested dates (finding 27):
//     the sum of the person's shift durations on those dates, so a
//     weekend day or a day with no scheduled shift consumes 0, and
//     there is no flat 8h day. A request over dates with no scheduled
//     hours at all consumes 0 and draws nothing. The 8-hour day
//     (WORKDAY_HOURS) is no longer used for consumption; it is kept
//     only as the documented convention it was. Balances are hours/days
//     owed, not money: consumption never touches pay.
//   - 'unpaid' time off never draws a balance: there is nothing owed
//     to draw from, so it is never balance-checked or decremented.
//   - Create-time check: a request that would take the balance below
//     zero is rejected with a structured 409 (insufficient balance),
//     never silently allowed to go negative.
//   - Approve-time decrement: approval decrements the balance inside
//     the same transaction as the status change, guarded by
//     `balance >= required`, so two concurrent approvals cannot both
//     spend the same balance. If the balance moved since the request
//     was made, approval 409s and the request stays pending.
//   - Cancelled / denied requests never touch the balance (only
//     pending requests can be cancelled, and approval is the only
//     transition that decrements), except that cancelling an APPROVED
//     request refunds exactly what approval took, as a 'reversal'
//     accrual event (finding 25): the status flip and the refund
//     happen in one transaction, so cancelling twice restores once.
//   - Carryover cap: a grant banks at most up to the cap; accrual
//     beyond the cap is not banked and is reported as capped.
//   - Accrual is granted by a manager-triggered endpoint, not a job:
//     one explicit call, one auditable grant per policy, no background
//     scheduler to drift or double-fire. The accrual_period on the
//     policy records the intended cadence; the manager grants on that
//     cadence. One grant per policy period at most (finding 26): a
//     second grant in the same period is refused, naming the period
//     and the existing grant.
//
// Balances are hours/days owed, not money: nothing in this module
// reads or writes pay lines, wages, or the ledger.

const laborJurisdiction = require('./laborJurisdictionRules');
const { shiftHours } = require('./shiftConflictValidation');

const WORKDAY_HOURS = 8;

// Whole calendar days in [startDate, endDate], inclusive of both ends.
// Dates arrive as 'YYYY-MM-DD' strings from request validation and as
// node-pg Date objects from stored rows (decide/cancel read the request
// back from the database): a Date stringifies as 'Thu Dec 10 2026 ...',
// so it must go through toISOString first, or the range parses as
// invalid and the consumption silently computes 0 (approval would
// then decrement nothing and record a 0-amount event).
function requestDays(startDate, endDate) {
  const toDateStr = (value) => (
    value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
  );
  const start = new Date(`${toDateStr(startDate)}T12:00:00Z`);
  const end = new Date(`${toDateStr(endDate)}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

// Scheduled hours for one person over a date range: the sum of the
// durations of every stored shift whose shift_date falls in the range
// (draft or published; a draft is still planned work, the same rule
// validateShift uses for overlap). Durations come from the shared
// shiftHours, so overnight shifts count whole on their start date
// and a shift starting the day before the range is not counted. A
// date with no shift contributes 0.
async function scheduledHoursFor(db, businessId, userId, startDate, endDate) {
  const { rows: shifts } = await db.query(
    `SELECT shift_date::text AS shift_date,
            start_time::text AS start_time, end_time::text AS end_time
       FROM business_staff_shifts
      WHERE business_id = $1 AND user_id = $2
        AND shift_date >= $3::date AND shift_date <= $4::date`,
    [businessId, userId, toDateStr(startDate), toDateStr(endDate)]
  );
  let total = 0;
  for (const shift of shifts || []) total += shiftHours(shift);
  return Math.round(total * 100) / 100;
}

// Date to 'YYYY-MM-DD', accepting the strings validation produces and
// the Date objects node-pg returns for stored rows (see requestDays).
function toDateStr(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

// What one request consumes against a policy, in the policy's unit.
// A days-unit policy consumes the whole calendar days in the range.
// An hours-unit policy consumes the scheduled hours on the requested
// dates (see scheduledHoursFor): a date with no scheduled shift
// consumes 0, so a request over unscheduled dates consumes 0 and
// draws nothing from the balance.
async function consumptionFor(db, policy, businessId, userId, startDate, endDate) {
  const days = requestDays(startDate, endDate);
  const unit = policy?.accrual_unit || 'days';
  if (unit !== 'hours') return { amount: days, unit, days };
  const scheduled = await scheduledHoursFor(db, businessId, userId, startDate, endDate);
  return { amount: scheduled, unit, days, scheduled_hours: scheduled };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function getPolicy(db, businessId, userId, requestType) {
  const { rows: [row] } = await db.query(
    `SELECT id, business_id, user_id, request_type,
            accrual_amount, accrual_unit, accrual_period, carryover_cap
       FROM business_time_off_policies
      WHERE business_id = $1 AND user_id = $2 AND request_type = $3`,
    [businessId, userId, requestType]
  );
  return row || null;
}

async function getBalance(db, businessId, userId, requestType) {
  const { rows: [row] } = await db.query(
    `SELECT id, business_id, user_id, request_type, balance, unit
       FROM business_time_off_balances
      WHERE business_id = $1 AND user_id = $2 AND request_type = $3`,
    [businessId, userId, requestType]
  );
  return row || null;
}

// Balance check for a new request. Returns:
//   { enforced: false } — 'unpaid', or no policy for this type (unconfigured).
//   { enforced: true, ok: true, balance, required, unit, days }
//   { enforced: true, ok: false, balance, required, unit, days, code }
// The caller maps ok:false to a structured 409.
async function checkSufficient(db, businessId, userId, requestType, startDate, endDate) {
  if (requestType === 'unpaid') return { enforced: false, reason: 'unpaid' };
  const policy = await getPolicy(db, businessId, userId, requestType);
  if (!policy) return { enforced: false, reason: 'no_policy' };
  const consumption = await consumptionFor(db, policy, businessId, userId, startDate, endDate);
  const balanceRow = await getBalance(db, businessId, userId, requestType);
  const balance = balanceRow ? toNumber(balanceRow.balance) : 0;
  if (balance < consumption.amount) {
    return {
      enforced: true, ok: false, code: 'insufficient_pto_balance',
      balance, required: consumption.amount, unit: consumption.unit, days: consumption.days,
    };
  }
  return {
    enforced: true, ok: true,
    balance, required: consumption.amount, unit: consumption.unit, days: consumption.days,
  };
}

// Decrement the balance for an APPROVED request, inside the caller's
// transaction. Returns { decremented: true, balanceAfter, required, unit }
// or { decremented: false, ... } when the balance no longer covers the
// request (the caller keeps the request pending and 409s). Unpaid and
// unconfigured types return { decremented: false, enforced: false } and
// the caller approves normally.
async function decrementForApproval(client, businessId, userId, requestType, startDate, endDate, requestId, decidedBy) {
  if (requestType === 'unpaid') return { decremented: false, enforced: false, reason: 'unpaid' };
  const policy = await getPolicy(client, businessId, userId, requestType);
  if (!policy) return { decremented: false, enforced: false, reason: 'no_policy' };
  const consumption = await consumptionFor(client, policy, businessId, userId, startDate, endDate);
  // A request over dates with no scheduled hours consumes 0: the
  // approval goes through and draws nothing, so no balance write
  // and no zero-amount ledger event are recorded.
  if (consumption.amount <= 0) {
    const balanceRow = await getBalance(client, businessId, userId, requestType);
    return {
      decremented: true, enforced: true, ok: true, nothing_consumed: true,
      balanceAfter: balanceRow ? toNumber(balanceRow.balance) : 0,
      required: 0, unit: consumption.unit, days: consumption.days,
    };
  }
  const { rows: [updated] } = await client.query(
    `UPDATE business_time_off_balances
        SET balance = balance - $1::numeric, updated_at = NOW()
      WHERE business_id = $2 AND user_id = $3 AND request_type = $4
        AND balance >= $1::numeric
      RETURNING balance`,
    [consumption.amount, businessId, userId, requestType]
  );
  if (!updated) {
    const balanceRow = await getBalance(client, businessId, userId, requestType);
    return {
      decremented: false, enforced: true, ok: false, code: 'insufficient_pto_balance',
      balance: balanceRow ? toNumber(balanceRow.balance) : 0,
      required: consumption.amount, unit: consumption.unit, days: consumption.days,
    };
  }
  const balanceAfter = toNumber(updated.balance);
  await client.query(
    `INSERT INTO business_time_off_accrual_events
       (business_id, user_id, request_type, amount, unit, event_type, request_id, balance_after, created_by)
     VALUES ($1,$2,$3,$4,$5,'approval',$6,$7,$8)`,
    [businessId, userId, requestType, -consumption.amount, consumption.unit,
      requestId, balanceAfter, decidedBy || null]
  );
  return {
    decremented: true, enforced: true, ok: true,
    balanceAfter, required: consumption.amount, unit: consumption.unit, days: consumption.days,
  };
}

// Refund the balance an APPROVED request consumed, when that request
// is cancelled. Must run inside the caller's transaction, next to the
// status flip, so a cancellation can never restore twice: the row is
// locked and the status moves approved -> cancelled exactly once, and
// the reversal is recorded only when no reversal exists yet for the
// request. The refund is the exact amount the approval event recorded
// (never a recomputation: the schedule may have changed since
// approval, and the ledger is the record of what was taken). Unpaid
// and unconfigured approvals never decremented, so they have no
// approval event and nothing to refund. Uses the existing 'reversal'
// event type, so no schema change is needed.
async function refundForCancellation(client, businessId, userId, requestType, requestId, cancelledBy) {
  const { rows: [approval] } = await client.query(
    `SELECT amount, unit, balance_after
       FROM business_time_off_accrual_events
      WHERE business_id = $1 AND user_id = $2 AND request_type = $3
        AND request_id = $4 AND event_type = 'approval'
      ORDER BY id DESC LIMIT 1`,
    [businessId, userId, requestType, requestId]
  );
  if (!approval) return { refunded: false, reason: 'no_approval_event' };
  const restored = -toNumber(approval.amount);
  if (restored <= 0) return { refunded: false, reason: 'nothing_consumed' };
  const { rows: [existing] } = await client.query(
    `SELECT id FROM business_time_off_accrual_events
      WHERE business_id = $1 AND user_id = $2 AND request_type = $3
        AND request_id = $4 AND event_type = 'reversal'
      LIMIT 1`,
    [businessId, userId, requestType, requestId]
  );
  if (existing) return { refunded: false, reason: 'already_refunded' };
  const { rows: [updated] } = await client.query(
    `UPDATE business_time_off_balances
        SET balance = balance + $1::numeric, updated_at = NOW()
      WHERE business_id = $2 AND user_id = $3 AND request_type = $4
      RETURNING balance`,
    [restored, businessId, userId, requestType]
  );
  if (!updated) return { refunded: false, reason: 'no_balance_row' };
  const balanceAfter = toNumber(updated.balance);
  await client.query(
    `INSERT INTO business_time_off_accrual_events
       (business_id, user_id, request_type, amount, unit, event_type, request_id, balance_after, created_by)
     VALUES ($1,$2,$3,$4,$5,'reversal',$6,$7,$8)`,
    [businessId, userId, requestType, restored, approval.unit,
      requestId, balanceAfter, cancelledBy || null]
  );
  return { refunded: true, amount: restored, unit: approval.unit, balanceAfter };
}
// ── Finding 26: one grant per policy period ────────────────────────
// The policy's accrual_period is the cadence (weekly / monthly /
// yearly / once, from the policy row; no new period definition is
// invented). The period key is derived from the ledger event's
// created_at in UTC: a calendar month, a calendar year, the Sunday-
// start workweek containing the date (the system's one workweek
// definition; the policy has no location, so the default Sunday start
// applies), or 'once' for a one-time grant. A second grant whose key
// matches the current period is refused.
//
// checkAccrualPeriod locks the policy row first, so the check-and-
// grant sequence serializes: two concurrent grants for the same
// policy wait on the lock, and the second one re-reads the ledger
// after the first commits instead of double-granting.
function periodKeyFor(date, period) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  if (period === 'yearly') return `yearly:${y}`;
  if (period === 'weekly') return `weekly:${laborJurisdiction.weekStartOf(`${y}-${m}-${day}`, 0)}`;
  if (period === 'once') return 'once';
  return `monthly:${y}-${m}`;
}

async function lastAccrualGrant(client, policy) {
  const { rows: [row] } = await client.query(
    `SELECT amount, unit, balance_after, created_at
       FROM business_time_off_accrual_events
      WHERE business_id = $1 AND user_id = $2 AND request_type = $3
        AND event_type = 'accrual'
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [policy.business_id, policy.user_id, policy.request_type]
  );
  return row || null;
}

async function checkAccrualPeriod(client, policy, now = new Date()) {
  const period = policy.accrual_period || 'monthly';
  const currentKey = periodKeyFor(now, period);
  if (policy.id != null) {
    await client.query(
      'SELECT id FROM business_time_off_policies WHERE id = $1 FOR UPDATE',
      [policy.id]
    );
  }
  const last = await lastAccrualGrant(client, policy);
  if (!last) return { refused: false, period: currentKey, accrualPeriod: period };
  if (periodKeyFor(last.created_at, period) !== currentKey) {
    return { refused: false, period: currentKey, accrualPeriod: period };
  }
  return {
    refused: true,
    period: currentKey,
    accrualPeriod: period,
    existingGrant: {
      amount: toNumber(last.amount),
      unit: last.unit,
      grantedAt: last.created_at instanceof Date
        ? last.created_at.toISOString() : String(last.created_at),
      balanceAfter: toNumber(last.balance_after),
    },
  };
}

// Grant one policy's accrual to its balance, enforcing the carryover
// cap. Must run inside the caller's transaction. Returns the grant as
// reported to the manager, including the capped flag when the cap ate
// part (or all) of the grant. A second grant for the same policy
// period is refused (see checkAccrualPeriod above) instead of
// double-granting.
async function grantAccrual(client, policy, grantedBy) {
  const periodCheck = await checkAccrualPeriod(client, policy);
  if (periodCheck.refused) {
    const balanceRow = await getBalance(
      client, policy.business_id, policy.user_id, policy.request_type
    );
    return {
      user_id: policy.user_id,
      request_type: policy.request_type,
      granted: 0,
      unit: policy.accrual_unit || 'days',
      balance_after: balanceRow ? toNumber(balanceRow.balance) : 0,
      capped: false,
      carryover_cap: policy.carryover_cap == null ? null : toNumber(policy.carryover_cap),
      refused: true,
      period: periodCheck.period,
      accrual_period: periodCheck.accrualPeriod,
      existing_grant: periodCheck.existingGrant,
    };
  }
  const amount = toNumber(policy.accrual_amount);
  const unit = policy.accrual_unit || 'days';
  const cap = policy.carryover_cap == null ? null : toNumber(policy.carryover_cap);
  const { rows: [row] } = await client.query(
    `INSERT INTO business_time_off_balances (business_id, user_id, request_type, balance, unit)
     VALUES ($1,$2,$3,0,$4)
     ON CONFLICT (business_id, user_id, request_type) DO NOTHING
     RETURNING balance`,
    [policy.business_id, policy.user_id, policy.request_type, unit]
  );
  const before = row ? 0 : toNumber((await getBalance(
    client, policy.business_id, policy.user_id, policy.request_type
  ))?.balance);
  const uncapped = before + amount;
  const after = cap == null ? uncapped : Math.min(uncapped, cap);
  const granted = Math.round((after - before) * 100) / 100;
  await client.query(
    `UPDATE business_time_off_balances
        SET balance = $1::numeric, updated_at = NOW()
      WHERE business_id = $2 AND user_id = $3 AND request_type = $4`,
    [after, policy.business_id, policy.user_id, policy.request_type]
  );
  if (granted !== 0) {
    await client.query(
      `INSERT INTO business_time_off_accrual_events
         (business_id, user_id, request_type, amount, unit, event_type, balance_after, created_by)
       VALUES ($1,$2,$3,$4,$5,'accrual',$6,$7)`,
      [policy.business_id, policy.user_id, policy.request_type, granted, unit, after, grantedBy || null]
    );
  }
  return {
    user_id: policy.user_id,
    request_type: policy.request_type,
    granted,
    unit,
    balance_after: after,
    capped: cap != null && uncapped > cap,
    carryover_cap: cap,
  };
}

module.exports = {
  WORKDAY_HOURS,
  requestDays,
  consumptionFor,
  scheduledHoursFor,
  getPolicy,
  getBalance,
  checkSufficient,
  decrementForApproval,
  refundForCancellation,
  checkAccrualPeriod,
  periodKeyFor,
  grantAccrual,
};
