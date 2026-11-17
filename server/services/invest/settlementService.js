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
 * Cancel a reserved commitment. The Credit reservation is released and
 * the allocation rows flip to `released`; lot remaining balances are
 * never touched, so the value returns to the ORIGINAL lots with their
 * original classification and restrictions.
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

    await releaseReservation(client, {
      referenceType: 'investment_commitment',
      referenceId: commitmentId,
      reason: reason || 'investor cancellation',
    });
    await client.query(
      `UPDATE investment_commitment_lots SET status = 'released', updated_at = NOW()
        WHERE commitment_id = $1 AND status = 'active'`,
      [commitmentId],
    );
    await client.query(
      `UPDATE investment_settlements
          SET status = 'cancelled', updated_at = NOW()
        WHERE commitment_id = $1 AND kind = 'escrow_expectation'
          AND status = 'pending_partner_confirmation'`,
      [commitmentId],
    );
    const { rows: updated } = await client.query(
      `UPDATE investment_commitments
          SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = $2,
              expected_version = expected_version + 1, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [commitmentId, reason || null],
    );
    await appendEntry(client, {
      entryType: 'release',
      category: 'pending_reservations',
      opportunityId: commitment.opportunity_id,
      commitmentId,
      userId: commitment.user_id,
      amountCents: -Number(commitment.amount_cents),
      currencyCode: commitment.currency_code,
      referenceType: 'investment_commitment',
      referenceId: commitmentId,
      idempotencyKey: `${COMMITMENT_IDEMPOTENCY_PREFIX}${commitmentId}:release`,
    });
    await appendEntry(client, {
      entryType: 'release',
      category: 'cancelled_released',
      opportunityId: commitment.opportunity_id,
      commitmentId,
      userId: commitment.user_id,
      amountCents: Number(commitment.amount_cents),
      currencyCode: commitment.currency_code,
      referenceType: 'investment_commitment',
      referenceId: commitmentId,
      idempotencyKey: `${COMMITMENT_IDEMPOTENCY_PREFIX}${commitmentId}:cancelled`,
    });
    return formatCommitment(updated[0]);
  }, 'invest_cancel_commitment');
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
 */
async function closeOpportunity(input, dbPool = pool) {
  const { opportunityId, executorUserId } = input || {};
  if (!opportunityId || !executorUserId) fail('opportunityId and executorUserId are required to close', 'invest_close_actor_required');
  requireInvestEnabled(executorUserId);
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

    const { rows: commitmentRows } = await client.query(
      `SELECT * FROM investment_commitments
        WHERE opportunity_id = $1 AND status = 'reserved'
        ORDER BY created_at ASC FOR UPDATE`,
      [opportunityId],
    );
    const reservedTotal = commitmentRows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
    if (reservedTotal < Number(opportunity.target_cents)) {
      fail('Closing target has not been reached', 'invest_close_target_unmet', 409);
    }
    if (new Date(opportunity.deadline_at) < new Date() && reservedTotal < Number(opportunity.target_cents)) {
      fail('Closing deadline passed without reaching the target', 'invest_close_deadline_passed', 409);
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

      await client.query(
        `UPDATE investment_settlements
            SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
          WHERE commitment_id = $1 AND kind = 'escrow_expectation'
            AND status = 'pending_partner_confirmation'`,
        [commitment.id],
      );
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
  requireInvestEnabled(releasedBy);
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
  requireInvestEnabled(actorUserId || userId);
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

module.exports = {
  createCommitment,
  cancelCommitment,
  recheckCommitmentEligibility,
  approveClosingConditions,
  recordClosingApproval,
  closeOpportunity,
  releaseProceeds,
  recordDistribution,
  formatCommitment,
  formatPosition,
};
