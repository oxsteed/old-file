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
//     A days-unit policy consumes that many days; an hours-unit policy
//     consumes days * WORKDAY_HOURS hours. The 8-hour day is the one
//     documented convention here; it is a time convention, not a pay
//     rule, and it never touches money.
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
//     transition that decrements).
//   - Carryover cap: a grant banks at most up to the cap; accrual
//     beyond the cap is not banked and is reported as capped.
//   - Accrual is granted by a manager-triggered endpoint, not a job:
//     one explicit call, one auditable grant per policy, no background
//     scheduler to drift or double-fire. The accrual_period on the
//     policy records the intended cadence; the manager grants on that
//     cadence.
//
// Balances are hours/days owed, not money: nothing in this module
// reads or writes pay lines, wages, or the ledger.

const WORKDAY_HOURS = 8;

// Whole calendar days in [startDate, endDate], inclusive of both ends.
function requestDays(startDate, endDate) {
  const start = new Date(`${String(startDate).slice(0, 10)}T12:00:00Z`);
  const end = new Date(`${String(endDate).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

// What one request consumes against a policy, in the policy's unit.
function consumptionFor(policy, startDate, endDate) {
  const days = requestDays(startDate, endDate);
  const unit = policy?.accrual_unit || 'days';
  return { amount: unit === 'hours' ? days * WORKDAY_HOURS : days, unit, days };
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
  const consumption = consumptionFor(policy, startDate, endDate);
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
  const consumption = consumptionFor(policy, startDate, endDate);
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

// Grant one policy's accrual to its balance, enforcing the carryover
// cap. Must run inside the caller's transaction. Returns the grant as
// reported to the manager, including the capped flag when the cap ate
// part (or all) of the grant.
async function grantAccrual(client, policy, grantedBy) {
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
  getPolicy,
  getBalance,
  checkSufficient,
  decrementForApproval,
  grantAccrual,
};
