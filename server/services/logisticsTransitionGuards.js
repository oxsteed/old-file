'use strict';
/**
 * Funding and fulfillment gates for the OxSteed Logistics lifecycle.
 *
 * These are the transactional transition guards registered on the canonical
 * state machine (see registerTransitionGuard in logisticsStateMachine.js).
 * Money/fulfillment code fails closed: every guard returns a blocker
 * ({ code, message, details }) instead of advancing when its requirements
 * are not met, and the guards never mutate fulfillment state themselves.
 *
 * Gates implemented (spec: "Campaigns and fulfillment"):
 *  1. inventory_allocation → released
 *     The buyer's final balance must be collected: a 'final' installment
 *     payment attempt with status 'succeeded' must exist for the linked
 *     pooled-order participant. Only a signed Stripe webhook or a committed
 *     OxSteed Credit debit can mark an attempt 'succeeded', so browser
 *     redirects or client claims can never satisfy this gate.
 *  2. pooled_order pledging → deposit_phase
 *     Minimum demand met (current_committed_qty >= target_moq), an approved
 *     (accepted) supplier quote linked, and an explicit deposit_deadline set.
 *  3. pooled_order locked → placed
 *     Deposit-funded quantity (committed qty on participants with
 *     deposit_paid_cents > 0, the money-safe paid source) >= target_moq,
 *     plus a recorded 'placement_approved' decision authorizing supplier
 *     placement.
 *
 * Missed funding at deadline never advances or refunds the campaign: the
 * sweepFundingDeadlines() sweeper raises a row in logistics_review_exceptions
 * for staff resolution instead. Wire it into the scheduled-worker roster
 * (server/workers/scheduledWorkerSchedule.js) or call it directly.
 */
const crypto = require('crypto');
const { registerTransitionGuard } = require('./logisticsStateMachine');
const { logLogisticsAction } = require('./logisticsAuditService');

// ─── Blocker catalog ─────────────────────────────────────────────
// Codes are stable identifiers the client localizes (see
// /tmp/i18n-fulfill.json for the English source strings).
const BLOCKERS = {
  campaign_not_found: (details) => ({
    code: 'campaign_not_found',
    message: 'The campaign could not be found.',
    details,
  }),
  allocation_not_found: (details) => ({
    code: 'allocation_not_found',
    message: 'The inventory allocation could not be found.',
    details,
  }),
  min_demand_not_met: ({ committed, targetMoq }) => ({
    code: 'min_demand_not_met',
    message: `Minimum demand is not met yet (${committed} of ${targetMoq} units committed). The deposit window cannot open.`,
    details: { committed, targetMoq },
  }),
  no_approved_quote: () => ({
    code: 'no_approved_quote',
    message: 'An approved (accepted) supplier quote is required before the deposit window can open.',
  }),
  deposit_deadline_missing: () => ({
    code: 'deposit_deadline_missing',
    message: 'Set an explicit deposit deadline before opening the deposit window.',
  }),
  deposit_funding_shortfall: ({ fundedQty, targetMoq }) => ({
    code: 'deposit_funding_shortfall',
    message: `Deposit-funded quantity (${fundedQty}) is below the campaign minimum (${targetMoq}). The supplier order cannot be placed.`,
    details: { fundedQty, targetMoq },
  }),
  placement_approval_missing: () => ({
    code: 'placement_approval_missing',
    message: 'Supplier placement requires a recorded placement approval from Operations.',
  }),
  no_payment_subject_linked: () => ({
    code: 'no_payment_subject_linked',
    message: 'This allocation is not linked to a payable order or participation, so payment cannot be verified.',
  }),
  final_balance_not_collected: ({ participantId }) => ({
    code: 'final_balance_not_collected',
    message: "The buyer's final balance has not been collected yet. Goods cannot be released.",
    details: { participantId },
  }),
};

function acceptedQuoteExists(quoteStatus) {
  return quoteStatus === 'accepted';
}

// ─── Gate 2: pledging → deposit_phase ─────────────────────────────

async function guardDepositPhase(client, { id }) {
  const { rows } = await client.query(
    `SELECT po.target_moq,
            po.current_committed_qty,
            po.deposit_deadline,
            po.supplier_quote_id,
            sq.status AS quote_status
       FROM pooled_orders po
       LEFT JOIN supplier_quotes sq ON sq.id = po.supplier_quote_id
      WHERE po.id = $1`,
    [id]
  );
  const order = rows[0];
  if (!order) return BLOCKERS.campaign_not_found({ pooledOrderId: id });
  const committed = Number(order.current_committed_qty || 0);
  const targetMoq = Number(order.target_moq || 0);
  if (!(committed >= targetMoq)) {
    return BLOCKERS.min_demand_not_met({ committed, targetMoq });
  }
  if (!order.supplier_quote_id || !acceptedQuoteExists(order.quote_status)) {
    return BLOCKERS.no_approved_quote();
  }
  if (!order.deposit_deadline) {
    return BLOCKERS.deposit_deadline_missing();
  }
  return null;
}

// ─── Gate 3: locked → placed ──────────────────────────────────────

async function guardSupplierPlacement(client, { id }) {
  const { rows } = await client.query(
    `SELECT po.target_moq,
            COALESCE(SUM(CASE WHEN p.deposit_paid_cents > 0 THEN p.committed_qty ELSE 0 END), 0)
              AS funded_qty,
            EXISTS (
              SELECT 1 FROM logistics_campaign_approval_decisions d
               WHERE d.pooled_order_id = po.id
                 AND d.decision = 'placement_approved'
            ) AS placement_approved
       FROM pooled_orders po
       LEFT JOIN pooled_order_participants p
         ON p.pooled_order_id = po.id
        AND p.status NOT IN ('refunded', 'disputed')
      WHERE po.id = $1
      GROUP BY po.id, po.target_moq`,
    [id]
  );
  const order = rows[0];
  if (!order) return BLOCKERS.campaign_not_found({ pooledOrderId: id });
  const fundedQty = Number(order.funded_qty || 0);
  const targetMoq = Number(order.target_moq || 0);
  if (!(fundedQty >= targetMoq)) {
    return BLOCKERS.deposit_funding_shortfall({ fundedQty, targetMoq });
  }
  if (!order.placement_approved) {
    return BLOCKERS.placement_approval_missing();
  }
  return null;
}

/**
 * Record a staff approval authorizing supplier placement for a campaign.
 * This is the record the locked → placed gate requires; it is a separate
 * decision from campaign publication approval ('approved') and from the
 * supplier quote acceptance.
 */
async function recordPlacementApproval(db, pooledOrderId, decidedByUserId, reason = null) {
  const { rows } = await db.query(
    `INSERT INTO logistics_campaign_approval_decisions
       (pooled_order_id, decision, from_state, to_state, decided_by_user_id, reason)
     VALUES ($1, 'placement_approved', 'locked', 'placed', $2, $3)
     RETURNING *`,
    [pooledOrderId, decidedByUserId, reason]
  );
  logLogisticsAction('pooled_order', pooledOrderId, 'placement_approved', {
    actorUserId: decidedByUserId,
    notes: reason,
  });
  return rows[0];
}

// ─── Gate 1: inventory_allocation → released ──────────────────────

async function guardReleaseAllocation(client, { id }) {
  const { rows } = await client.query(
    `SELECT participant_id, pooled_order_id, buyer_user_id
       FROM inventory_allocations
      WHERE id = $1`,
    [id]
  );
  const alloc = rows[0];
  if (!alloc) return BLOCKERS.allocation_not_found({ allocationId: id });
  if (!alloc.participant_id) {
    return BLOCKERS.no_payment_subject_linked();
  }
  const paid = await client.query(
    `SELECT 1
       FROM logistics_payment_attempts
      WHERE participant_id = $1
        AND installment = 'final'
        AND status = 'succeeded'
      LIMIT 1`,
    [alloc.participant_id]
  );
  if (paid.rows.length === 0) {
    return BLOCKERS.final_balance_not_collected({ participantId: alloc.participant_id });
  }
  return null;
}

// ─── Missed-funding review exceptions ─────────────────────────────
// At deadline, insufficient funding raises a staff review exception; the
// campaign is never advanced or refunded automatically.

const EXCEPTION_TYPES = {
  FUNDING_SHORTFALL: 'funding_shortfall', // deposit_phase past deposit_deadline, funded qty < MOQ
  MIN_DEMAND_UNMET: 'min_demand_unmet',   // pledging past close_date, committed qty < MOQ
};

function exceptionReference() {
  return `LRE-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

async function raiseReviewException(client, { pooledOrderId, exceptionType, details }) {
  const { rows } = await client.query(
    `INSERT INTO logistics_review_exceptions
       (reference, pooled_order_id, exception_type, status, details)
     VALUES ($1, $2, $3, 'open', $4)
     ON CONFLICT (pooled_order_id, exception_type) WHERE status = 'open'
     DO NOTHING
     RETURNING *`,
    [exceptionReference(), pooledOrderId, exceptionType, JSON.stringify(details || {})]
  );
  const raised = rows[0] || null;
  if (raised) {
    logLogisticsAction('pooled_order', pooledOrderId, `review_exception_${exceptionType}`, {
      afterState: { reviewExceptionId: raised.id, reference: raised.reference },
      notes: `Funding deadline missed; raised for staff resolution (${raised.reference}). Campaign not advanced.`,
    });
  }
  return raised;
}

/**
 * Callable sweeper: evaluates funding deadlines and raises staff review
 * exceptions. Never changes campaign status, never refunds, never advances.
 * Idempotent: an open exception per (campaign, type) is raised at most once.
 *
 * @param db     pg Pool (or a client with .query)
 * @param {{ limit }} options
 * @returns {{ checked: number, raised: number, exceptions: Array }}
 */
async function sweepFundingDeadlines(db, { limit = 200 } = {}) {
  const checked = { campaigns: 0 };
  const raisedExceptions = [];

  // 1. Deposit windows past their explicit deadline without enough
  //    deposit-funded quantity to meet the minimum.
  const { rows: shortfalls } = await db.query(
    `SELECT po.id,
            po.reference,
            po.target_moq,
            po.deposit_deadline,
            COALESCE(SUM(CASE WHEN p.deposit_paid_cents > 0 THEN p.committed_qty ELSE 0 END), 0)
              AS funded_qty
       FROM pooled_orders po
       LEFT JOIN pooled_order_participants p
         ON p.pooled_order_id = po.id
        AND p.status NOT IN ('refunded', 'disputed')
      WHERE po.status = 'deposit_phase'
        AND po.deposit_deadline IS NOT NULL
        AND po.deposit_deadline < NOW()
      GROUP BY po.id, po.reference, po.target_moq, po.deposit_deadline
     HAVING COALESCE(SUM(CASE WHEN p.deposit_paid_cents > 0 THEN p.committed_qty ELSE 0 END), 0)
              < po.target_moq
      LIMIT $1`,
    [limit]
  );
  for (const row of shortfalls) {
    checked.campaigns += 1;
    const raised = await raiseReviewException(db, {
      pooledOrderId: row.id,
      exceptionType: EXCEPTION_TYPES.FUNDING_SHORTFALL,
      details: {
        reference: row.reference,
        targetMoq: Number(row.target_moq),
        fundedQty: Number(row.funded_qty),
        depositDeadline: row.deposit_deadline,
      },
    });
    if (raised) raisedExceptions.push(raised);
  }

  // 2. Pledge windows past their close date without meeting minimum demand.
  const { rows: unmet } = await db.query(
    `SELECT po.id, po.reference, po.target_moq, po.close_date, po.current_committed_qty
       FROM pooled_orders po
      WHERE po.status = 'pledging'
        AND po.close_date IS NOT NULL
        AND po.close_date < NOW()
        AND COALESCE(po.current_committed_qty, 0) < po.target_moq
      LIMIT $1`,
    [limit]
  );
  for (const row of unmet) {
    checked.campaigns += 1;
    const raised = await raiseReviewException(db, {
      pooledOrderId: row.id,
      exceptionType: EXCEPTION_TYPES.MIN_DEMAND_UNMET,
      details: {
        reference: row.reference,
        targetMoq: Number(row.target_moq),
        committedQty: Number(row.current_committed_qty || 0),
        closeDate: row.close_date,
      },
    });
    if (raised) raisedExceptions.push(raised);
  }

  return { checked: checked.campaigns, raised: raisedExceptions.length, exceptions: raisedExceptions };
}

// ─── Registration ─────────────────────────────────────────────────

let registered = false;
function registerLogisticsGuards() {
  if (registered) return;
  registerTransitionGuard('pooled_order', 'deposit_phase', guardDepositPhase);
  registerTransitionGuard('pooled_order', 'placed', guardSupplierPlacement);
  registerTransitionGuard('inventory_allocation', 'released', guardReleaseAllocation);
  registered = true;
}

module.exports = {
  BLOCKERS,
  EXCEPTION_TYPES,
  guardDepositPhase,
  guardSupplierPlacement,
  guardReleaseAllocation,
  recordPlacementApproval,
  raiseReviewException,
  sweepFundingDeadlines,
  registerLogisticsGuards,
};
