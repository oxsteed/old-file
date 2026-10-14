'use strict';

/**
 * Shared HTTP mapping for the dual-approval gate (ADM-016).
 *
 * When a money movement is queued for second-admin approval, the initiating
 * endpoint returns 202 with the pending approval. Replays of the same
 * idempotency key return the existing approval: pending -> 202 again,
 * executed -> 200 with the stored execution result, terminal rejected ->
 * 409 so the client cannot mistake a dead request for a live one.
 */

function sanitizeApproval(approval) {
  if (!approval) return null;
  return {
    id: approval.id,
    movementType: approval.movement_type,
    referenceKey: approval.reference_key,
    amountCents: Number(approval.amount_cents),
    currencyCode: approval.currency_code,
    status: approval.status,
    requestedBy: approval.requested_by,
    requestedAt: approval.requested_at,
    decidedBy: approval.decided_by || null,
    decidedAt: approval.decided_at || null,
    executedAt: approval.executed_at || null,
  };
}

function sendMoneyMovementGateResult(res, gate) {
  const approval = gate.approval;
  const summary = sanitizeApproval(approval);
  if (approval.status === 'executed') {
    let result = approval.result;
    if (typeof result === 'string') {
      try { result = JSON.parse(result); } catch { result = null; }
    }
    return res.status(200).json({
      replay: true,
      approval: summary,
      result: result || null,
    });
  }
  if (approval.status !== 'pending') {
    return res.status(409).json({
      error: `This money movement was already ${approval.status}. Queue a new request instead of reusing the idempotency key.`,
      code: 'money_movement_terminal_replay',
      approval: summary,
      replayed: true,
    });
  }
  return res.status(202).json({
    message: 'Money movement queued for second-admin approval (dual approval). No funds have moved.',
    code: 'money_movement_pending_approval',
    replay: Boolean(gate.replay),
    approval: summary,
  });
}

module.exports = { sendMoneyMovementGateResult, sanitizeApproval };
