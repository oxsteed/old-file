'use strict';

/**
 * Investment settlement service (best-guess model).
 *
 * ASSUMPTIONS: every assumption in this file is numbered and recorded in
 * docs/oxsteed-invest/SETTLEMENT_ASSUMPTIONS.md (A1-A8) so counsel and
 * the registered intermediary can strike or confirm each one. If the
 * partner cannot support Credit-only settlement in this shape, STOP:
 * live commitments stay disabled and no unauthorized fallback is built.
 *
 * Flow:
 * 1. Commit: eligible Credit is RESERVED (a real oxsteed_credit_reservations
 *    row, so reserved_cents and ordinary spending stay consistent) and
 *    the exact lots are recorded in investment_commitment_lots. A
 *    settlement row marks the partner-escrow expectation as
 *    pending_partner_confirmation. No real partner integration, no fiat
 *    movement, no external calls. Atomic transaction plus idempotency key.
 * 2. Close: all-or-nothing. Target reached, closing conditions approved,
 *    and separate review plus execution approvals from two different
 *    approvers, neither the entity representative. Eligibility is
 *    rechecked per commitment. Reservations complete into positions
 *    under the exact agreement version accepted: the wallet is debited
 *    through the journal (type `settlement`, wallet to platform
 *    treasury) and the lots are debited. Proceeds move to awaiting
 *    release; they cannot release before approved closing conditions.
 * 3. Cancel / unsuccessful close: reservations release back to the
 *    ORIGINAL lots (allocation rows flip to `released`; lot remaining
 *    balances are untouched, so original classification and restrictions
 *    are restored exactly).
 * 4. Distributions: entity pays through the partner; credited back to
 *    the investor as Credit through the settlement flow, with a
 *    traceable journal transaction and a `distribution` lot.
 *
 * Money code fails closed throughout: flags off, rail off, target
 * unmet, conditions unapproved, or a failed eligibility recheck all
 * refuse the operation with no partial state (single transaction).
 */

const crypto = require('crypto');
const AppError = require('../../utils/appError');
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const {
  postJournalTransaction,
  ensureAccount,
  assertCreditRailEnabled,
} = require('../oxsteedCreditService');
const { reserveFunds, releaseReservation } = require('../oxsteedCreditReservationService');
const { allocateEligibleLots, createLot } = require('./creditLots');
const { appendEntry } = require('./investmentSubledger');
const { requireInvestEnabled, requireInvestCommitmentsEnabled } = require('./flags');

function fail(message, code, status = 400) {
  throw new AppError(message, status, code);
}

const COMMITMENT_IDEMPOTENCY_PREFIX = 'invest-commit:';
const CLOSE_IDEMPOTENCY_PREFIX = 'invest-close:';
const DISTRIBUTION_IDEMPOTENCY_PREFIX = 'invest-distribution:';

function formatCommitment(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    opportunityId: String(row.opportunity_id),
    applicationId: row.application_id ? String(row.application_id) : null,
    amountCents: Number(row.amount_cents || 0),
    currencyCode: row.currency_code,
    status: row.status,
    agreementVersionId: String(row.agreement_version_id),
    agreementVersionNumber: Number(row.agreement_version_number || 0),
    creditReservationId: row.credit_reservation_id ? String(row.credit_reservation_id) : null,
    journalTransactionId: row.journal_transaction_id ? String(row.journal_transaction_id) : null,
    creditReferenceRate: row.credit_reference_rate === null ? null : Number(row.credit_reference_rate),
    idempotencyKey: row.idempotency_key,
    cancelledAt: row.cancelled_at || null,
    cancellationReason: row.cancellation_reason || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function formatPosition(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    opportunityId: String(row.opportunity_id),
    commitmentId: String(row.commitment_id),
    amountCents: Number(row.amount_cents || 0),
    currencyCode: row.currency_code,
    agreementVersionId: String(row.agreement_version_id),
    agreementVersionNumber: Number(row.agreement_version_number || 0),
    status: row.status,
    acquiredAt: row.acquired_at || null,
  };
}

async function lockOpportunity(client, opportunityId) {
  const { rows } = await client.query(
    `SELECT * FROM investment_opportunities WHERE id = $1 FOR UPDATE`, [opportunityId],
  );
  if (!rows[0]) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
  return rows[0];
}

async function getCommitmentForUpdate(client, commitmentId) {
  const { rows } = await client.query(
    `SELECT * FROM investment_commitments WHERE id = $1 FOR UPDATE`, [commitmentId],
  );
  if (!rows[0]) fail('Commitment not found', 'invest_commitment_not_found', 404);
  return rows[0];
}

/**
 * Create a commitment: reserve eligible Credit, record the lots, open
 * the escrow-expectation settlement row, and journal the reservation.
 * Idempotent on idempotencyKey; concurrent requests serialize on the
 * opportunity row lock and the lot row locks, so neither the balance
 * nor the opportunity can be overspent or overfilled.
 */
async function createCommitment(input, dbPool = pool) {
  const {
    userId, opportunityId, applicationId, amountCents, currencyCode = 'USD',
    agreementVersionId, idempotencyKey, referenceRate = 1,
  } = input || {};
  if (!userId) fail('userId is required for a commitment', 'invest_commitment_user_required');
  if (!opportunityId) fail('opportunityId is required for a commitment', 'invest_commitment_opportunity_required');
  if (!applicationId) fail('An approved participation application is required for a commitment', 'invest_commitment_application_required');
  if (!agreementVersionId) fail('agreementVersionId is required for a commitment', 'invest_commitment_agreement_required');
  if (!idempotencyKey) fail('idempotencyKey is required for a commitment', 'invest_commitment_idempotency_required');
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) fail('amountCents must be a positive integer number of cents', 'invest_commitment_amount_invalid');
  requireInvestCommitmentsEnabled(userId);

  const commitmentId = crypto.randomUUID();
  const key = String(idempotencyKey).slice(0, 160);

  return withTransaction(dbPool, async (client) => {
    const { rows: existing } = await client.query(
      `SELECT * FROM investment_commitments WHERE idempotency_key = $1`, [key],
    );
    if (existing[0]) {
      const row = existing[0];
      if (String(row.user_id) !== String(userId)
        || String(row.opportunity_id) !== String(opportunityId)
        || Number(row.amount_cents) !== amount) {
        fail('Idempotency key was already used for a different commitment', 'invest_commitment_idempotency_conflict', 409);
      }
      return { commitment: formatCommitment(row), replayed: true };
    }

    await assertCreditRailEnabled(client);
    const opportunity = await lockOpportunity(client, opportunityId);
    if (opportunity.status !== 'published') {
      fail('Commitments are only accepted for published opportunities', 'invest_commitment_opportunity_not_published', 409);
    }
    if (String(opportunity.current_agreement_version_id) !== String(agreementVersionId)) {
      fail('The commitment must accept the opportunity current agreement version', 'invest_commitment_agreement_stale', 409);
    }

    const { rows: appRows } = await client.query(
      `SELECT * FROM investment_participation_applications WHERE id = $1 FOR UPDATE`, [applicationId],
    );
    const application = appRows[0];
    if (!application) fail('Participation application not found', 'invest_application_not_found', 404);
    if (String(application.user_id) !== String(userId)
      || String(application.opportunity_id) !== String(opportunityId)) {
      fail('Participation application does not belong to this investor and opportunity', 'invest_commitment_application_mismatch', 403);
    }
    if (application.status !== 'approved') {
      fail('Only an approved participation application can commit', 'invest_commitment_application_not_approved', 409);
    }
    if (String(application.agreement_version_id) !== String(agreementVersionId)) {
      fail('The application accepted a different agreement version', 'invest_commitment_application_agreement_mismatch', 409);
    }

    const { rows: versionRows } = await client.query(
      `SELECT * FROM investment_agreement_versions WHERE id = $1`, [agreementVersionId],
    );
    if (!versionRows[0] || String(versionRows[0].opportunity_id) !== String(opportunityId)) {
      fail('Agreement version not found for this opportunity', 'invest_agreement_not_found', 404);
    }

    // Overfill guard, serialized by the opportunity row lock.
    const { rows: reservedRows } = await client.query(
      `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS reserved_total
         FROM investment_commitments
        WHERE opportunity_id = $1 AND status = 'reserved'`,
      [opportunityId],
    );
    const reservedTotal = Number(reservedRows[0].reserved_total || 0);
    if (reservedTotal + amount > Number(opportunity.target_cents)) {
      fail('This commitment would overfill the opportunity', 'invest_commitment_overfill', 409);
    }

    // Eligibility is decided inside this transaction, under the same
    // locks as the reservation, so the check and the hold cannot race.
    const { allocations, eligibleBalance } = await allocateEligibleLots(client, {
      customerId: userId, currencyCode, amountCents: amount,
    });

    const { rows: commitmentRows } = await client.query(
      `INSERT INTO investment_commitments
         (id, user_id, opportunity_id, application_id, amount_cents, currency_code,
          status, agreement_version_id, agreement_version_number,
          credit_reference_rate, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, 'reserved', $7, $8, $9, $10)
       RETURNING *`,
      [
        commitmentId, userId, opportunityId, applicationId, amount, currencyCode,
        agreementVersionId, Number(versionRows[0].version_number), Number(referenceRate), key,
      ],
    );
    const commitment = commitmentRows[0];

    for (const allocation of allocations) {
      await client.query(
        `INSERT INTO investment_commitment_lots (commitment_id, lot_id, amount_cents)
         VALUES ($1, $2, $3)`,
        [commitmentId, allocation.lotId, allocation.amountCents],
      );
    }

    // Real Credit reservation: increments reserved_cents and records the
    // oxsteed_credit_reservations row, so ordinary spending cannot spend
    // reserved value and reconciliation can prove the invariant.
    // ASSUMPTION A2 (docs/oxsteed-invest/SETTLEMENT_ASSUMPTIONS.md):
    // at commitment, eligible Credit is RESERVED in the dedicated
    // subledger: unavailable for ordinary spending, not yet an
    // investment position.
    const { reservation } = await reserveFunds(client, {
      accountId: Number(eligibleBalance.accountId),
      reservationType: 'investment_commitment',
      referenceType: 'investment_commitment',
      referenceId: commitmentId,
      amountCents: amount,
    });
    await client.query(
      `UPDATE investment_commitments SET credit_reservation_id = $2 WHERE id = $1`,
      [commitmentId, reservation.id],
    );

    // ASSUMPTION A3: the partner holds the corresponding monetary value
    // in escrow. This row records the expectation only; there is no
    // partner integration and no fiat movement here.
    await client.query(
      `INSERT INTO investment_settlements
         (opportunity_id, commitment_id, kind, status, amount_cents, currency_code,
          credit_reference_rate, created_by)
       VALUES ($1, $2, 'escrow_expectation', 'pending_partner_confirmation', $3, $4, $5, $6)`,
      [opportunityId, commitmentId, amount, currencyCode, Number(referenceRate), userId],
    );

    await appendEntry(client, {
      entryType: 'reservation',
      category: 'pending_reservations',
      opportunityId,
      commitmentId,
      userId,
      amountCents: amount,
      currencyCode,
      referenceType: 'investment_commitment',
      referenceId: commitmentId,
      idempotencyKey: `${COMMITMENT_IDEMPOTENCY_PREFIX}${commitmentId}:reserve`,
    });

    const { rows: refreshed } = await client.query(
      `SELECT * FROM investment_commitments WHERE id = $1`, [commitmentId],
    );
    return { commitment: formatCommitment(refreshed[0]), allocations, replayed: false };
  }, 'invest_create_commitment');
}

/**
 * Release one reserved commitment inside the caller's transaction: the
 * Credit reservation is released and the allocation rows flip to
 * `released`; lot remaining balances are never touched, so the value
 * returns to the ORIGINAL lots with their original classification and
 * restrictions.
 *
 * ASSUMPTION A5 (docs/oxsteed-invest/SETTLEMENT_ASSUMPTIONS.md): a
 * failed closing returns value to the original classification. This
 * helper is the single implementation of that release, shared by an
 * investor cancellation and by fail-close, so the two paths cannot
 * drift apart.
 */
async function releaseReservedCommitmentTx(client, commitment, reason) {
  await releaseReservation(client, {
    referenceType: 'investment_commitment',
    referenceId: String(commitment.id),
    reason: reason || 'investment commitment released',
  });
  await client.query(
    `UPDATE investment_commitment_lots SET status = 'released', updated_at = NOW()
      WHERE commitment_id = $1 AND status = 'active'`,
    [commitment.id],
  );
  await client.query(
    `UPDATE investment_settlements
        SET status = 'cancelled', updated_at = NOW()
      WHERE commitment_id = $1 AND kind = 'escrow_expectation'
        AND status = 'pending_partner_confirmation'`,
    [commitment.id],
  );
  const { rows: updated } = await client.query(
    `UPDATE investment_commitments
        SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = $2,
            expected_version = expected_version + 1, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [commitment.id, reason || null],
  );
  await appendEntry(client, {
    entryType: 'release',
    category: 'pending_reservations',
    opportunityId: commitment.opportunity_id,
    commitmentId: String(commitment.id),
    userId: commitment.user_id,
    amountCents: -Number(commitment.amount_cents),
    currencyCode: commitment.currency_code,
    referenceType: 'investment_commitment',
    referenceId: String(commitment.id),
    idempotencyKey: `${COMMITMENT_IDEMPOTENCY_PREFIX}${commitment.id}:release`,
  });
  await appendEntry(client, {
    entryType: 'release',
    category: 'cancelled_released',
    opportunityId: commitment.opportunity_id,
    commitmentId: String(commitment.id),
    userId: commitment.user_id,
    amountCents: Number(commitment.amount_cents),
    currencyCode: commitment.currency_code,
    referenceType: 'investment_commitment',
    referenceId: String(commitment.id),
    idempotencyKey: `${COMMITMENT_IDEMPOTENCY_PREFIX}${commitment.id}:cancelled`,
  });
  return formatCommitment(updated[0]);
}

/**
 * Cancel a reserved commitment. The Credit reservation is released and
 * the allocation rows flip to `released`; lot remaining balances are
 * never touched, so the value returns to the ORIGINAL lots with their
 * original classification and restrictions (ASSUMPTION A5).
 */
async function cancelCommitment(input, dbPool = pool) {
  const { commitmentId, userId, reason = null, actorUserId = null } = input || {};
  if (!commitmentId) fail('commitmentId is required to cancel a commitment', 'invest_commitment_id_required');
  return withTransaction(dbPool, async (client) => {
    const commitment = await getCommitmentForUpdate(client, commitmentId);
    if (String(commitment.user_id) !== String(userId) && String(actorUserId || '') !== String(userId)) {
      fail('Only the investor may cancel this commitment', 'invest_commitment_not_owner', 403);
    }
    if (commitment.status !== 'reserved') {
      fail(`Only a reserved commitment can be cancelled (current status: ${commitment.status})`, 'invest_commitment_cancel_invalid', 409);
    }
    requireInvestEnabled(userId);

    return releaseReservedCommitmentTx(client, commitment, reason || 'investor cancellation');
  }, 'invest_cancel_commitment');
}

/**
 * Fail-close one opportunity: the unsuccessful-closing path (spec
 * section 7). Every still-reserved commitment is released back to its
 * ORIGINAL lots through the shared release helper (ASSUMPTION A5), and
 * the opportunity moves to the terminal `unsuccessful` status with its
 * terminal timestamp and reason recorded. A reviewer calls this when
 * the raise failed (target missed, conditions failed, or the entity
 * withdrew); the sweeper calls it when the deadline passed with the
 * target unmet. It refuses an opportunity that already closed/funded
 * or already reached a terminal state, and a human reviewer may never
 * fail-close their own entity's raise. A null actorUserId is the
 * system (sweeper) actor, which has no entity to be self-approving
 * against. Fail-close is deliberately NOT behind the live commitment
 * gate: it releases holds and restores prior state, it never creates a
 * position, a proceed, or a distribution.
 */
async function failCloseOpportunity(input, dbPool = pool) {
  const { opportunityId, actorUserId = null, reason = null } = input || {};
  if (!opportunityId) fail('opportunityId is required to fail-close', 'invest_fail_close_opportunity_required');
  if (actorUserId) requireInvestEnabled(actorUserId);
  const failReason = reason || 'Closing did not occur: the opportunity was unsuccessful';
  return withTransaction(dbPool, async (client) => {
    const opportunity = await lockOpportunity(client, opportunityId);
    if (!['published', 'paused', 'closing'].includes(opportunity.status)) {
      fail(`Only an open opportunity can be fail-closed (current status: ${opportunity.status})`, 'invest_fail_close_status_invalid', 409);
    }
    if (actorUserId && String(opportunity.created_by) === String(actorUserId)) {
      fail('An entity representative cannot fail-close their own opportunity', 'invest_fail_close_self_approval', 403);
    }
    const { rows: commitmentRows } = await client.query(
      `SELECT * FROM investment_commitments
        WHERE opportunity_id = $1 AND status = 'reserved'
        ORDER BY created_at ASC FOR UPDATE`,
      [opportunityId],
    );
    const releasedCommitments = [];
    let releasedCents = 0;
    for (const commitment of commitmentRows) {
      await releaseReservedCommitmentTx(client, commitment, failReason);
      releasedCommitments.push(String(commitment.id));
      releasedCents += Number(commitment.amount_cents || 0);
    }
    const { rows: updated } = await client.query(
      `UPDATE investment_opportunities
          SET status = 'unsuccessful', cancelled_at = NOW(), cancellation_reason = $2,
              expected_version = expected_version + 1, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [opportunityId, failReason],
    );
    return {
      opportunityId: String(opportunityId),
      status: updated[0].status,
      releasedCommitmentIds: releasedCommitments,
      releasedCommitmentCount: releasedCommitments.length,
      releasedCents,
      cancelledAt: updated[0].cancelled_at || null,
    };
  }, 'invest_fail_close_opportunity');
}

/**
 * Sweeper: find open opportunities whose deadline passed with the
 * target unmet and fail-close them, so no reservation strands as
 * `reserved` forever after a missed raise. Only past-deadline,
 * target-unmet opportunities are picked up: a past-deadline raise
 * that met its target is left for a reviewer (closing it late, or
 * fail-closing it, is a human decision, not a sweeper's). Each
 * opportunity fail-closes in its own transaction; one failure is
 * recorded in the result and the sweep continues with the rest.
 */
async function sweepUnsuccessfulOpportunities(input = {}, dbPool = pool) {
  const limit = Number.isSafeInteger(Number(input.limit)) && Number(input.limit) > 0
    ? Math.min(Number(input.limit), 500)
    : 100;
  const { rows } = await dbPool.query(
    `SELECT o.id, o.target_cents,
            COALESCE(SUM(c.amount_cents), 0)::bigint AS reserved_total
       FROM investment_opportunities o
       LEFT JOIN investment_commitments c
         ON c.opportunity_id = o.id AND c.status = 'reserved'
      WHERE o.status IN ('published', 'paused', 'closing')
        AND o.deadline_at < NOW()
      GROUP BY o.id, o.target_cents
     HAVING COALESCE(SUM(c.amount_cents), 0) < o.target_cents
      ORDER BY o.deadline_at ASC
      LIMIT $1`,
    [limit],
  );
  const failClosed = [];
  const failed = [];
  for (const row of rows) {
    try {
      const result = await failCloseOpportunity({
        opportunityId: String(row.id),
        actorUserId: null,
        reason: 'Deadline passed without reaching the target',
      }, dbPool);
      failClosed.push(result);
    } catch (err) {
      failed.push({ opportunityId: String(row.id), code: err.code || null, error: err.message });
    }
  }
  return { checkedAt: new Date().toISOString(), failClosed, failed };
}

/**
 * Record partner confirmation of an escrow expectation.
 *
 * ASSUMPTION A3 (docs/oxsteed-invest/SETTLEMENT_ASSUMPTIONS.md): the
 * partner holds the corresponding monetary value in escrow, and the
 * escrow_expectation row records that expectation as
 * pending_partner_confirmation. Closing deliberately does NOT flip it:
 * only explicit partner input moves it to confirmed, through this
 * function, with the partner reference recorded. Nothing calls this
 * yet and no partner integration is implied; it is the audited hook
 * for the future moment partner input arrives.
 */
async function recordPartnerEscrowConfirmation(input, dbPool = pool) {
  const { commitmentId, partnerRef, confirmedBy, note = null } = input || {};
  if (!commitmentId) fail('commitmentId is required to confirm escrow', 'invest_escrow_commitment_required');
  if (!partnerRef || !String(partnerRef).trim()) fail('partnerRef is required: the partner confirmation reference', 'invest_escrow_partner_ref_required');
  if (!confirmedBy) fail('confirmedBy is required: escrow confirmation must be attributable to a reviewer', 'invest_escrow_actor_required');
  return withTransaction(dbPool, async (client) => {
    const commitment = await getCommitmentForUpdate(client, commitmentId);
    const { rows } = await client.query(
      `UPDATE investment_settlements
          SET status = 'confirmed', confirmed_at = NOW(), partner_ref = $2,
              note = $3, updated_at = NOW()
        WHERE commitment_id = $1 AND kind = 'escrow_expectation'
          AND status = 'pending_partner_confirmation'
        RETURNING *`,
      [commitmentId, String(partnerRef).trim().slice(0, 160), note ? String(note).slice(0, 2000) : null],
    );
    if (!rows[0]) {
      fail('No pending escrow expectation for this commitment', 'invest_escrow_nothing_pending', 409);
    }
    return {
      settlementId: String(rows[0].id),
      commitmentId: String(commitment.id),
      opportunityId: String(rows[0].opportunity_id),
      kind: rows[0].kind,
      status: rows[0].status,
      amountCents: Number(rows[0].amount_cents),
      currencyCode: rows[0].currency_code,
      partnerRef: rows[0].partner_ref,
      confirmedAt: rows[0].confirmed_at || null,
      confirmedBy: String(confirmedBy),
    };
  }, 'invest_record_partner_escrow_confirmation');
}

/**
 * Eligibility recheck at closing, per commitment: every allocated lot
 * must still hold the allocated amount unencumbered, and the wallet
 * must still be active. Fails closed; the whole close aborts.
 */
async function recheckCommitmentEligibility(client, commitment) {
  const { rows: allocationRows } = await client.query(
    `SELECT cl.amount_cents AS allocated_cents, l.*
       FROM investment_commitment_lots cl
       JOIN oxsteed_credit_balance_lots l ON l.id = cl.lot_id
      WHERE cl.commitment_id = $1 AND cl.status = 'active'
      FOR UPDATE OF l`,
    [commitment.id],
  );
  const { rows: accountRows } = await client.query(
    `SELECT status FROM oxsteed_credit_accounts
      WHERE customer_id = $1 AND currency_code = $2 AND account_type = 'customer_wallet'`,
    [commitment.user_id, commitment.currency_code],
  );
  if (!accountRows[0] || accountRows[0].status !== 'active') {
    fail('Investor wallet is not active at closing', 'invest_close_wallet_inactive', 409);
  }
  for (const row of allocationRows) {
    const free = Number(row.remaining_cents || 0) - Number(row.encumbered_cents || 0);
    if (free < Number(row.allocated_cents || 0)) {
      fail('Allocated Credit is no longer available at closing', 'invest_close_eligibility_failed', 409);
    }
  }
  return true;
}

async function approveClosingConditions(input, dbPool = pool) {
  const { opportunityId, approverUserId } = input || {};
  if (!opportunityId || !approverUserId) fail('opportunityId and approverUserId are required', 'invest_close_approver_required');
  return withTransaction(dbPool, async (client) => {
    const opportunity = await lockOpportunity(client, opportunityId);
    if (String(opportunity.created_by) === String(approverUserId)) {
      fail('An entity representative cannot approve their own opportunity closing conditions', 'invest_close_self_approval', 403);
    }
    const { rows } = await client.query(
      `UPDATE investment_opportunities
          SET closing_conditions_approved_at = NOW(),
              closing_conditions_approved_by = $2,
              updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [opportunityId, approverUserId],
    );
    return rows[0];
  }, 'invest_approve_closing_conditions');
}

/**
 * Record one stage of closing approval. Review must precede execution,
 * the two stages must have different approvers, and neither approver
 * may be the entity representative. A rejected stage may be re-decided;
 * an approved stage is final.
 */
async function recordClosingApproval(input, dbPool = pool) {
  const { opportunityId, stage, approverUserId, decision = 'approved', note = null } = input || {};
  if (!['review', 'execution'].includes(stage)) fail('Closing approval stage must be review or execution', 'invest_close_stage_invalid');
  if (!['approved', 'rejected'].includes(decision)) fail('Closing approval decision must be approved or rejected', 'invest_close_decision_invalid');
  return withTransaction(dbPool, async (client) => {
    const opportunity = await lockOpportunity(client, opportunityId);
    if (String(opportunity.created_by) === String(approverUserId)) {
      fail('An entity representative cannot approve their own opportunity closing', 'invest_close_self_approval', 403);
    }
    if (stage === 'execution') {
      const { rows: reviewRows } = await client.query(
        `SELECT * FROM investment_closing_approvals
          WHERE opportunity_id = $1 AND stage = 'review' AND decision = 'approved'`,
        [opportunityId],
      );
      if (!reviewRows[0]) fail('Closing execution requires an approved review first', 'invest_close_review_required', 409);
      if (String(reviewRows[0].approver_user_id) === String(approverUserId)) {
        fail('Closing review and execution must have different approvers', 'invest_close_same_approver', 403);
      }
    }
    const { rows: existing } = await client.query(
      `SELECT * FROM investment_closing_approvals
        WHERE opportunity_id = $1 AND stage = $2 FOR UPDATE`,
      [opportunityId, stage],
    );
    if (existing[0] && existing[0].decision === 'approved') {
      return { approval: existing[0], replayed: true };
    }
    if (existing[0]) {
      const { rows } = await client.query(
        `UPDATE investment_closing_approvals
            SET approver_user_id = $2, decision = $3, note = $4, decided_at = NOW()
          WHERE id = $1 RETURNING *`,
        [existing[0].id, approverUserId, decision, note],
      );
      return { approval: rows[0], replayed: false };
    }
    const { rows } = await client.query(
      `INSERT INTO investment_closing_approvals
         (opportunity_id, stage, approver_user_id, decision, note)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [opportunityId, stage, approverUserId, decision, note],
    );
    return { approval: rows[0], replayed: false };
  }, 'invest_record_closing_approval');
}

async function getClosingApprovals(client, opportunityId) {
  const { rows } = await client.query(
    `SELECT * FROM investment_closing_approvals
      WHERE opportunity_id = $1 AND decision = 'approved'`,
    [opportunityId],
  );
  return rows;
}

/**
 * Close an opportunity, all or nothing: target reached, closing
 * conditions approved, and separate approved review plus execution.
 * Each reserved commitment completes into a position under the exact
 * agreement version accepted; proceeds move to awaiting release.
 *
 * ASSUMPTION A4 (docs/oxsteed-invest/SETTLEMENT_ASSUMPTIONS.md):
 * closing is all-or-nothing: target plus deadline plus conditions plus
 * a separate closing approval, enforced here in the service, not the
 * caller. The deadline is checked first and on its own: a raise whose
 * deadline passed cannot close even when the target was met; that
 * raise fail-closes instead.
 *
 * The live commitment gate is enforced here in the service, not only
 * at the route: a direct service caller cannot close past it.
 */
async function closeOpportunity(input, dbPool = pool) {
  const { opportunityId, executorUserId } = input || {};
  if (!opportunityId || !executorUserId) fail('opportunityId and executorUserId are required to close', 'invest_close_actor_required');
  requireInvestCommitmentsEnabled(executorUserId);
  return withTransaction(dbPool, async (client) => {
    await assertCreditRailEnabled(client);
    const opportunity = await lockOpportunity(client, opportunityId);
    if (!['published', 'closing'].includes(opportunity.status)) {
      fail(`Only a published opportunity can close (current status: ${opportunity.status})`, 'invest_close_status_invalid', 409);
    }
    if (!opportunity.closing_conditions_approved_at) {
      fail('Closing conditions must be approved before closing', 'invest_close_conditions_unapproved', 409);
    }
    const approvals = await getClosingApprovals(client, opportunityId);
    const review = approvals.find((row) => row.stage === 'review');
    const execution = approvals.find((row) => row.stage === 'execution');
    if (!review || !execution) {
      fail('Closing requires separate approved review and execution', 'invest_close_approvals_missing', 409);
    }
    if (String(review.approver_user_id) === String(execution.approver_user_id)) {
      fail('Closing review and execution must have different approvers', 'invest_close_same_approver', 403);
    }
    if (String(execution.approver_user_id) !== String(executorUserId)) {
      fail('Only the approved execution approver may execute the close', 'invest_close_executor_mismatch', 403);
    }

    // Fail closed: only commitments on the opportunity's CURRENT
    // agreement version are captured. A commitment still on an older
    // version (its investor never reconfirmed after an amendment went
    // effective) is excluded from the close entirely: it does not
    // count toward the target, its wallet is not debited, and no
    // position is created for it. It stays 'reserved' so an admin can
    // cancel/release it through the existing cancel path; the excluded
    // ids and total are returned so the caller can act on them.
    // A NULL current version (no versioning in play) matches NULL
    // commitment versions, so unversioned raises close as before.
    const { rows: reservedRows } = await client.query(
      `SELECT * FROM investment_commitments
        WHERE opportunity_id = $1 AND status = 'reserved'
        ORDER BY created_at ASC FOR UPDATE`,
      [opportunityId],
    );
    const currentVersionId = String(opportunity.current_agreement_version_id);
    const commitmentRows = reservedRows.filter(
      (row) => String(row.agreement_version_id) === currentVersionId,
    );
    const excludedCommitments = reservedRows.filter(
      (row) => String(row.agreement_version_id) !== currentVersionId,
    );
    const reservedTotal = commitmentRows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
    // The deadline is enforced on its own, before the target check: a
    // raise whose deadline passed cannot close even when the target was
    // met. (The old form folded the deadline into the target check, so
    // the target failure fired first and the deadline never did.)
    if (new Date(opportunity.deadline_at) < new Date()) {
      fail('Closing deadline has passed', 'invest_close_deadline_passed', 409);
    }
    if (reservedTotal < Number(opportunity.target_cents)) {
      // Name the excluded amount: when this fails because stale-version
      // commitments were left out, the admin needs to know the shortfall
      // is stale money, not missing money, and that cancelling those
      // commitments frees the overfill headroom for new money.
      const excludedCents = excludedCommitments.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
      fail(
        `Closing target has not been reached (${reservedTotal} captured on the current agreement version, ${excludedCents} excluded on older versions)`,
        'invest_close_target_unmet',
        409,
      );
    }

    const treasury = await ensureAccount(client, {
      accountType: 'platform_treasury', currencyCode: 'USD',
    });
    const positions = [];
    let completedTotal = 0;

    for (const commitment of commitmentRows) {
      await recheckCommitmentEligibility(client, commitment);
      const { rows: allocationRows } = await client.query(
        `SELECT * FROM investment_commitment_lots
          WHERE commitment_id = $1 AND status = 'active' FOR UPDATE`,
        [commitment.id],
      );
      const { rows: walletRows } = await client.query(
        `SELECT * FROM oxsteed_credit_accounts
          WHERE customer_id = $1 AND currency_code = $2 AND account_type = 'customer_wallet'
          FOR UPDATE`,
        [commitment.user_id, commitment.currency_code],
      );
      const wallet = walletRows[0];
      if (!wallet) fail('Investor wallet not found at closing', 'invest_close_wallet_missing', 404);

      await releaseReservation(client, {
        referenceType: 'investment_commitment',
        referenceId: String(commitment.id),
        reason: 'closing completion',
      });

      // Debit the wallet through the journal so the account balance,
      // hash chain, and ledger guard all stay intact. The journal type
      // is `adjustment` with metadata direction `debit`: it is the only
      // postable type the direction guard (migration 514) allows for a
      // customer_wallet to platform_treasury movement without a
      // partner. `settlement` is bound to approved partner payout
      // snapshots (migration 490) and `purchase` to partner agreements,
      // so neither fits an investment completion. The debit is
      // attributed to the executing approver with a reason, satisfying
      // the migration 487 admin-evidence rule for adjustments.
      const { transaction } = await postJournalTransaction(client, {
        transactionType: 'adjustment',
        debitAccountId: wallet.id,
        creditAccountId: treasury.id,
        customerId: commitment.user_id,
        amountCents: Number(commitment.amount_cents),
        currencyCode: commitment.currency_code,
        idempotencyKey: `${CLOSE_IDEMPOTENCY_PREFIX}${commitment.id}`,
        actorType: 'admin',
        actorUserId: executorUserId,
        reason: 'Investment closing completion',
        description: 'Investment closing completion',
        referenceType: 'investment_commitment',
        referenceId: String(commitment.id),
        metadata: { direction: 'debit', opportunityId: String(opportunityId), commitmentId: String(commitment.id) },
      });

      for (const allocation of allocationRows) {
        const { rows: lotUpdated } = await client.query(
          `UPDATE oxsteed_credit_balance_lots
              SET remaining_cents = remaining_cents - $2, updated_at = NOW()
            WHERE id = $1 AND remaining_cents >= $2
            RETURNING *`,
          [allocation.lot_id, Number(allocation.amount_cents)],
        );
        if (!lotUpdated[0]) fail('Allocated Credit lot no longer holds the committed amount', 'invest_close_lot_short', 409);
      }
      await client.query(
        `UPDATE investment_commitment_lots SET status = 'captured', updated_at = NOW()
          WHERE commitment_id = $1 AND status = 'active'`,
        [commitment.id],
      );
      await client.query(
        `UPDATE investment_commitments
            SET status = 'completed', journal_transaction_id = $2, completed_at = NOW(),
                eligibility_rechecked_at = NOW(), expected_version = expected_version + 1,
                updated_at = NOW()
          WHERE id = $1`,
        [commitment.id, transaction.id],
      );
      const { rows: positionRows } = await client.query(
        `INSERT INTO investment_positions
           (user_id, opportunity_id, commitment_id, amount_cents, currency_code,
            agreement_version_id, agreement_version_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          commitment.user_id, opportunityId, commitment.id,
          Number(commitment.amount_cents), commitment.currency_code,
          commitment.agreement_version_id, Number(commitment.agreement_version_number),
        ],
      );
      positions.push(formatPosition(positionRows[0]));
      completedTotal += Number(commitment.amount_cents);

      // The escrow-expectation row stays pending_partner_confirmation
      // here on purpose (ASSUMPTION A3): only explicit partner input,
      // through recordPartnerEscrowConfirmation, may move it to
      // confirmed. Closing without partner input must not fabricate
      // that confirmation.
      await appendEntry(client, {
        entryType: 'completion',
        category: 'pending_reservations',
        opportunityId,
        commitmentId: String(commitment.id),
        userId: String(commitment.user_id),
        amountCents: -Number(commitment.amount_cents),
        currencyCode: commitment.currency_code,
        referenceType: 'investment_commitment',
        referenceId: String(commitment.id),
        idempotencyKey: `${CLOSE_IDEMPOTENCY_PREFIX}${commitment.id}:pending`,
      });
      await appendEntry(client, {
        entryType: 'completion',
        category: 'completed_contributions',
        opportunityId,
        commitmentId: String(commitment.id),
        userId: String(commitment.user_id),
        amountCents: Number(commitment.amount_cents),
        currencyCode: commitment.currency_code,
        referenceType: 'investment_commitment',
        referenceId: String(commitment.id),
        idempotencyKey: `${CLOSE_IDEMPOTENCY_PREFIX}${commitment.id}:completed`,
      });
    }

    const { rows: proceedsRows } = await client.query(
      `INSERT INTO investment_proceeds
         (opportunity_id, amount_cents, currency_code, status)
       VALUES ($1, $2, 'USD', 'awaiting_release') RETURNING *`,
      [opportunityId, completedTotal],
    );
    const { rows: settlementRows } = await client.query(
      `INSERT INTO investment_settlements
         (opportunity_id, kind, status, amount_cents, currency_code, created_by)
       VALUES ($1, 'proceeds_release', 'pending_partner_confirmation', $2, 'USD', $3)
       RETURNING *`,
      [opportunityId, completedTotal, executorUserId],
    );
    await client.query(
      `UPDATE investment_proceeds SET settlement_id = $2 WHERE id = $1`,
      [proceedsRows[0].id, settlementRows[0].id],
    );
    await appendEntry(client, {
      entryType: 'proceeds_awaiting',
      category: 'proceeds_awaiting_release',
      opportunityId,
      userId: null,
      amountCents: completedTotal,
      currencyCode: 'USD',
      referenceType: 'investment_opportunity',
      referenceId: String(opportunityId),
      idempotencyKey: `${CLOSE_IDEMPOTENCY_PREFIX}${opportunityId}:proceeds`,
    });
    await client.query(
      `UPDATE investment_opportunities
          SET status = 'closed', closed_at = NOW(),
              expected_version = expected_version + 1, updated_at = NOW()
        WHERE id = $1`,
      [opportunityId],
    );

    return {
      opportunityId: String(opportunityId),
      status: 'closed',
      completedTotalCents: completedTotal,
      positions,
      proceedsId: String(proceedsRows[0].id),
      excludedCommitmentIds: excludedCommitments.map((row) => String(row.id)),
      excludedCents: excludedCommitments.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0),
    };
  }, 'invest_close_opportunity');
}

/**
 * Release entity proceeds. BLOCKED until the opportunity is closed with
 * approved closing conditions and separate review plus execution. The
 * releaser cannot be the entity representative.
 */
async function releaseProceeds(input, dbPool = pool) {
  const { opportunityId, releasedBy } = input || {};
  if (!opportunityId || !releasedBy) fail('opportunityId and releasedBy are required to release proceeds', 'invest_proceeds_actor_required');
  // The live commitment gate is enforced here in the service, not only
  // at the route: a direct service caller cannot release past it.
  requireInvestCommitmentsEnabled(releasedBy);
  return withTransaction(dbPool, async (client) => {
    await assertCreditRailEnabled(client);
    const opportunity = await lockOpportunity(client, opportunityId);
    if (String(opportunity.created_by) === String(releasedBy)) {
      fail('An entity representative cannot release their own opportunity proceeds', 'invest_proceeds_self_release', 403);
    }
    if (opportunity.status !== 'closed' || !opportunity.closing_conditions_approved_at) {
      fail('Proceeds cannot release before approved closing conditions', 'invest_proceeds_blocked', 409);
    }
    const approvals = await getClosingApprovals(client, opportunityId);
    if (!approvals.find((row) => row.stage === 'review') || !approvals.find((row) => row.stage === 'execution')) {
      fail('Proceeds cannot release without separate approved review and execution', 'invest_proceeds_approvals_missing', 409);
    }
    const { rows: proceedsRows } = await client.query(
      `SELECT * FROM investment_proceeds
        WHERE opportunity_id = $1 AND status = 'awaiting_release'
        ORDER BY created_at ASC FOR UPDATE LIMIT 1`,
      [opportunityId],
    );
    const proceeds = proceedsRows[0];
    if (!proceeds) fail('No proceeds awaiting release for this opportunity', 'invest_proceeds_none_awaiting', 409);
    const amount = Number(proceeds.amount_cents);
    const { rows: updated } = await client.query(
      `UPDATE investment_proceeds
          SET status = 'released', released_at = NOW(), released_by = $2, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [proceeds.id, releasedBy],
    );
    await client.query(
      `UPDATE investment_settlements
          SET status = 'released', released_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'pending_partner_confirmation'`,
      [proceeds.settlement_id],
    );
    await appendEntry(client, {
      entryType: 'proceeds_released',
      category: 'proceeds_awaiting_release',
      opportunityId,
      userId: null,
      amountCents: -amount,
      currencyCode: proceeds.currency_code,
      referenceType: 'investment_proceeds',
      referenceId: String(proceeds.id),
      idempotencyKey: `invest-proceeds:${proceeds.id}:awaiting`,
    });
    await appendEntry(client, {
      entryType: 'proceeds_released',
      category: 'released_proceeds',
      opportunityId,
      userId: null,
      amountCents: amount,
      currencyCode: proceeds.currency_code,
      referenceType: 'investment_proceeds',
      referenceId: String(proceeds.id),
      idempotencyKey: `invest-proceeds:${proceeds.id}:released`,
    });
    return {
      proceedsId: String(updated[0].id),
      opportunityId: String(opportunityId),
      amountCents: amount,
      status: 'released',
      releasedAt: updated[0].released_at || null,
    };
  }, 'invest_release_proceeds');
}

/**
 * Record a distribution: the entity paid through the partner, and the
 * investor is credited back as Credit through the settlement flow.
 * Idempotent on idempotencyKey. The credit creates a `distribution` lot
 * (settled, ineligible for new commitments) so the value stays
 * traceable to its distribution, never mingled as purchased value.
 *
 * ASSUMPTION A6 (docs/oxsteed-invest/SETTLEMENT_ASSUMPTIONS.md):
 * distributions come back as Credit through the settlement flow, with
 * a traceable record. No promise of distributions, cash redeemability,
 * or principal protection is made anywhere in this build.
 *
 * The live commitment gate is enforced here in the service, not only
 * at the route: a direct service caller cannot distribute past it.
 */
async function recordDistribution(input, dbPool = pool) {
  const {
    opportunityId, positionId, userId, amountCents, currencyCode = 'USD',
    idempotencyKey, actorUserId = null,
  } = input || {};
  if (!opportunityId || !positionId || !userId) fail('opportunityId, positionId, and userId are required for a distribution', 'invest_distribution_refs_required');
  if (!idempotencyKey) fail('idempotencyKey is required for a distribution', 'invest_distribution_idempotency_required');
  if (!actorUserId) fail('actorUserId is required for a distribution: the Credit load must be attributable to a staff actor (migration 487)', 'invest_distribution_actor_required');
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) fail('amountCents must be a positive integer number of cents', 'invest_distribution_amount_invalid');
  requireInvestCommitmentsEnabled(actorUserId || userId);
  const key = String(idempotencyKey).slice(0, 160);

  return withTransaction(dbPool, async (client) => {
    const { rows: existing } = await client.query(
      `SELECT * FROM investment_distributions WHERE idempotency_key = $1`, [key],
    );
    if (existing[0]) {
      if (String(existing[0].user_id) !== String(userId) || Number(existing[0].amount_cents) !== amount) {
        fail('Idempotency key was already used for a different distribution', 'invest_distribution_idempotency_conflict', 409);
      }
      return { distribution: existing[0], replayed: true };
    }
    await assertCreditRailEnabled(client);
    const opportunity = await lockOpportunity(client, opportunityId);
    if (opportunity.status !== 'closed') {
      fail('Distributions require a closed opportunity', 'invest_distribution_opportunity_not_closed', 409);
    }
    const { rows: positionRows } = await client.query(
      `SELECT * FROM investment_positions WHERE id = $1 FOR UPDATE`, [positionId],
    );
    const position = positionRows[0];
    if (!position) fail('Investment position not found', 'invest_position_not_found', 404);
    if (String(position.user_id) !== String(userId) || String(position.opportunity_id) !== String(opportunityId)) {
      fail('Position does not belong to this investor and opportunity', 'invest_distribution_position_mismatch', 403);
    }
    if (position.status !== 'active') fail('Distributions require an active position', 'invest_distribution_position_inactive', 409);

    const { rows: balanceRows } = await client.query(
      `SELECT * FROM oxsteed_credit_accounts
        WHERE customer_id = $1 AND currency_code = $2 AND account_type = 'customer_wallet'
        FOR UPDATE`,
      [userId, currencyCode],
    );
    const wallet = balanceRows[0];
    if (!wallet || wallet.status !== 'active') fail('Investor wallet is not active', 'invest_distribution_wallet_inactive', 409);
    const treasury = await ensureAccount(client, {
      accountType: 'platform_treasury', currencyCode,
    });
    // R-1: the proceeds cap, enforced inside the execution transaction
    // (race-safe). Total distributions for the opportunity must never
    // exceed what the close captured.
    const capacity = await getDistributionCapacity(client, { opportunityId, currencyCode });
    if (amount > capacity.remainingCents) {
      fail(`Distribution exceeds the remaining proceeds for this opportunity (${capacity.remainingCents} cents remain of ${capacity.proceedsCents})`, 'invest_distribution_exceeds_proceeds', 409);
    }

    const { transaction } = await postJournalTransaction(client, {
      transactionType: 'load',
      debitAccountId: treasury.id,
      creditAccountId: wallet.id,
      customerId: userId,
      amountCents: amount,
      currencyCode,
      idempotencyKey: `${DISTRIBUTION_IDEMPOTENCY_PREFIX}${key}`,
      // Migration 487 rejects system-actor loads, so the distribution
      // credit is attributed to the invoking staff actor, with a reason.
      actorType: 'admin',
      actorUserId,
      reason: 'Investment distribution',
      description: 'Investment distribution credited as Credit',
      referenceType: 'investment_distribution',
      referenceId: key,
      metadata: { opportunityId: String(opportunityId), positionId: String(positionId) },
    });

    const { lot } = await createLot(client, {
      accountId: wallet.id,
      customerId: userId,
      currencyCode,
      source: 'distribution',
      amountCents: amount,
      settledAt: new Date().toISOString(),
      originatingTransactionId: transaction.id,
      referenceType: 'investment_distribution',
      referenceId: key,
    });

    const { rows: settlementRows } = await client.query(
      `INSERT INTO investment_settlements
         (opportunity_id, kind, status, amount_cents, currency_code, partner_ref, created_by, released_at)
       VALUES ($1, 'distribution', 'released', $2, $3, $4, $5, NOW()) RETURNING *`,
      [opportunityId, amount, currencyCode, `distribution:${key}`, actorUserId || null],
    );
    const { rows: distributionRows } = await client.query(
      `INSERT INTO investment_distributions
         (opportunity_id, position_id, user_id, settlement_id, amount_cents,
          currency_code, status, journal_transaction_id, lot_id, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, 'credited', $7, $8, $9) RETURNING *`,
      [opportunityId, positionId, userId, settlementRows[0].id, amount, currencyCode, transaction.id, lot.id, key],
    );
    await appendEntry(client, {
      entryType: 'distribution_credit',
      category: 'distributions',
      opportunityId,
      commitmentId: String(position.commitment_id),
      userId,
      amountCents: amount,
      currencyCode,
      referenceType: 'investment_distribution',
      referenceId: key,
      idempotencyKey: `${DISTRIBUTION_IDEMPOTENCY_PREFIX}${key}:ledger`,
    });
    return { distribution: distributionRows[0], lot, replayed: false };
  }, 'invest_record_distribution');
}

// ── R-1: distribution proceeds cap ────────────────────────────────────
// A distribution credits an investor from the platform treasury, so the
// total distributed for an opportunity must never exceed what the close
// captured (the investment_proceeds row). The cap is per currency: the
// proceeds rows are USD-denominated by the close, so a non-USD
// distribution has no proceeds in its currency and is refused. The
// check runs twice: read-only at queue time (immediate feedback) and
// again inside recordDistribution's transaction (race-safe, authoritative).
async function getDistributionCapacity(client, { opportunityId, currencyCode = 'USD' } = {}) {
  const currency = String(currencyCode || 'USD').toUpperCase().slice(0, 3);
  const { rows: proceedsRows } = await client.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::int AS total
       FROM investment_proceeds WHERE opportunity_id = $1 AND currency_code = $2`,
    [opportunityId, currency]
  );
  const { rows: distributedRows } = await client.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::int AS total
       FROM investment_distributions
      WHERE opportunity_id = $1 AND currency_code = $2 AND status = 'credited'`,
    [opportunityId, currency]
  );
  const proceedsCents = Number(proceedsRows[0]?.total || 0);
  const distributedCents = Number(distributedRows[0]?.total || 0);
  return { proceedsCents, distributedCents, remainingCents: proceedsCents - distributedCents, currencyCode: currency };
}

// R-1: queue a distribution for dual approval. The maker can never
// execute a distribution themselves: every request goes through the
// money-movement approval queue (forceQueue) and only a DIFFERENT admin
// with a fresh step-up challenge can approve it in Money Approvals.
// The executor (moneyMovementExecutors 'invest_distribution') runs
// recordDistribution, which re-validates everything including the cap.
async function requestDistribution(input, dbPool = pool) {
  const {
    opportunityId, positionId, userId, amountCents, currencyCode = 'USD',
    idempotencyKey, actorUserId = null,
  } = input || {};
  if (!opportunityId || !positionId || !userId) fail('opportunityId, positionId, and userId are required for a distribution', 'invest_distribution_refs_required');
  if (!idempotencyKey) fail('idempotencyKey is required for a distribution', 'invest_distribution_idempotency_required');
  if (!actorUserId) fail('actorUserId is required for a distribution: the request must be attributable to a staff actor', 'invest_distribution_actor_required');
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) fail('amountCents must be a positive integer number of cents', 'invest_distribution_amount_invalid');
  requireInvestCommitmentsEnabled(actorUserId || userId);
  const key = String(idempotencyKey).slice(0, 160);
  const currency = String(currencyCode || 'USD').toUpperCase().slice(0, 3);
  // Read-only validation: immediate feedback for a bad position or an
  // over-proceeds amount, instead of queueing an approval that can
  // never execute. Not the gate: recordDistribution re-checks inside
  // its own transaction at execution time.
  await withTransaction(dbPool, async (client) => {
    const { rows: opportunityRows } = await client.query(
      `SELECT status FROM investment_opportunities WHERE id = $1`, [opportunityId]
    );
    if (!opportunityRows[0]) fail('Opportunity not found', 'invest_opportunity_not_found', 404);
    if (opportunityRows[0].status !== 'closed') {
      fail('Distributions require a closed opportunity', 'invest_distribution_opportunity_not_closed', 409);
    }
    const { rows: positionRows } = await client.query(
      `SELECT * FROM investment_positions WHERE id = $1`, [positionId]
    );
    const position = positionRows[0];
    if (!position) fail('Investment position not found', 'invest_position_not_found', 404);
    if (String(position.user_id) !== String(userId) || String(position.opportunity_id) !== String(opportunityId)) {
      fail('Position does not belong to this investor and opportunity', 'invest_distribution_position_mismatch', 403);
    }
    if (position.status !== 'active') fail('Distributions require an active position', 'invest_distribution_position_inactive', 409);
    const capacity = await getDistributionCapacity(client, { opportunityId, currencyCode: currency });
    if (amount > capacity.remainingCents) {
      fail(`Distribution exceeds the remaining proceeds for this opportunity (${capacity.remainingCents} cents remain of ${capacity.proceedsCents})`, 'invest_distribution_exceeds_proceeds', 409);
    }
  }, 'invest_request_distribution_validate');
  const { requestMoneyMovementApproval } = require('../dualApprovalService');
  const queued = await requestMoneyMovementApproval({
    movementType: 'invest_distribution',
    referenceKey: `opportunity:${opportunityId}`,
    amountCents: amount,
    currencyCode: currency,
    requestedBy: actorUserId,
    idempotencyKey: key,
    payload: {
      opportunityId: String(opportunityId),
      positionId: String(positionId),
      userId: String(userId),
      amountCents: amount,
      currencyCode: currency,
      idempotencyKey: key,
      makerAdminId: String(actorUserId),
    },
    forceQueue: true,
  });
  if (!queued.queued) {
    throw new AppError('Distribution was not queued for dual approval', 500, 'invest_distribution_not_queued');
  }
  return { approval: queued.approval, replay: !!queued.replay, queued: true };
}

module.exports = {
  createCommitment,
  cancelCommitment,
  failCloseOpportunity,
  sweepUnsuccessfulOpportunities,
  recordPartnerEscrowConfirmation,
  recheckCommitmentEligibility,
  approveClosingConditions,
  recordClosingApproval,
  closeOpportunity,
  releaseProceeds,
  recordDistribution,
  requestDistribution,
  getDistributionCapacity,
  formatCommitment,
  formatPosition,
};
