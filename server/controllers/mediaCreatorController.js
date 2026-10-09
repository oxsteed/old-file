'use strict';

const pool = require('../db');
const AppError = require('../utils/appError');
const { verifiedActorSql } = require('../services/mediaPublisherPolicy');
const mediaSafety = require('../services/mediaSafetyPolicy');
const creditService = require('../services/oxsteedCreditService');
const {
  transferCreditInTransaction,
  settleCreatorCreditInTransaction,
  chargeCreatorBoostInTransaction,
  ensureAccount,
} = creditService;
const { reserveFunds, releaseReservation, getActiveReservation } = require('../services/oxsteedCreditReservationService');

function asPositiveInt(value, code = 'media_creator_amount_invalid') {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new AppError('Amount must be a positive integer.', 400, code);
  return amount;
}

function text(value, max, field) {
  const valueText = typeof value === 'string' ? value.trim() : '';
  if (!valueText || valueText.length > max) throw new AppError(`${field} is required.`, 400, 'media_creator_input_invalid');
  return valueText;
}

// A Credit mutation and its marketplace state transition must commit as one
// unit. Treat a missing RETURNING row or ledger id as a failed transition so
// callers never receive a successful response for a payment that cannot be
// reconciled later.
function requireMutationRow(rows, message, code = 'media_creator_state_transition_failed') {
  if (!rows?.[0]) throw new AppError(message, 503, code);
  return rows[0];
}

function requireTransactionId(transfer) {
  const transactionId = transfer?.transaction?.id || transfer?.id;
  if (!transactionId) {
    throw new AppError('Credit settlement did not return a transaction.', 503, 'media_creator_credit_transition_failed');
  }
  return transactionId;
}

// A marketplace row stores the reservation it created. Resolve by business
// reference only as a recovery aid, then fail closed when the active hold does
// not match that durable link or the agreed amount.
function requireMatchingReservation(reservation, expectedReservationId, expectedAmountCents) {
  if (!reservation
    || String(reservation.id) !== String(expectedReservationId)
    || Number(reservation.amountCents) !== Number(expectedAmountCents)) {
    throw new AppError('The Credit reservation does not match this marketplace payment.', 409, 'media_creator_reservation_mismatch');
  }
  return reservation;
}

async function verifiedActor(client, userId, actorId = null) {
  const params = [userId];
  const actorFilter = actorId ? 'AND a.id = $2' : '';
  if (actorId) params.push(actorId);
  const { rows } = await client.query(
    `SELECT a.*
       FROM media_actors a
       JOIN users u ON u.id = a.owner_user_id
      WHERE a.owner_user_id = $1 ${actorFilter}
        AND a.actor_type IN ('helper','business','restaurant')
        AND u.is_active = TRUE AND u.is_banned = FALSE AND u.deleted_at IS NULL
        AND (${verifiedActorSql('a')})`, params
  );
  return rows[0] || null;
}

async function verifiedCreatorById(client, actorId) {
  const { rows } = await client.query(
    `SELECT owner_user_id FROM media_actors WHERE id = $1 AND actor_type IN ('helper','business','restaurant')`,
    [actorId]
  );
  return rows[0] ? verifiedActor(client, rows[0].owner_user_id, actorId) : null;
}

async function listGigs(req, res, next) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const { rows } = await pool.query(
      `SELECT g.*, a.handle AS owner_handle, a.display_name AS owner_name,
              a.avatar_url AS owner_avatar, a.verified_kind
         FROM media_creator_gigs g JOIN media_actors a ON a.id = g.owner_actor_id
        WHERE g.status = 'open'
          AND (${verifiedActorSql('a')})
        ORDER BY g.created_at DESC LIMIT $1`, [limit]
    );
    res.json({ gigs: rows });
  } catch (err) { next(err); }
}

async function createGig(req, res, next) {
  const client = await pool.connect();
  try {
    const idempotencyKey = text(req.get('Idempotency-Key') || req.body?.idempotencyKey, 160, 'Idempotency-Key');
    await client.query('BEGIN');
    const actor = await verifiedActor(client, req.user.id, req.body?.ownerActorId || null);
    if (!actor) throw new AppError('A current verified Media business or restaurant actor is required.', 403, 'media_creator_unverified');
    const title = text(req.body?.title, 160, 'Title');
    const brief = text(req.body?.brief, 5000, 'Brief');
    const budget = asPositiveInt(req.body?.budgetCents);
    const maxApplications = Math.min(Math.max(Number(req.body?.maxApplications) || 25, 1), 100);
    const linkedPostId = req.body?.linkedPostId || null;
    const { rows: existingRows } = await client.query(
      `SELECT * FROM media_creator_gigs
        WHERE owner_user_id = $1 AND idempotency_key = $2
        FOR UPDATE`, [req.user.id, idempotencyKey]
    );
    if (existingRows[0]) {
      const existing = existingRows[0];
      if (String(existing.owner_actor_id) !== String(actor.id)
        || String(existing.title) !== title
        || String(existing.brief) !== brief
        || Number(existing.budget_cents) !== budget
        || Number(existing.max_applications) !== maxApplications
        || String(existing.linked_post_id || '') !== String(linkedPostId || '')) {
        throw new AppError('Gig idempotency key was already used for different details.', 409, 'media_creator_idempotency_conflict');
      }
      await client.query('COMMIT');
      return res.status(200).json({ gig: existing, replayed: true });
    }
    if (linkedPostId) {
      const { rows } = await client.query(
        `SELECT p.id FROM media_posts p
          WHERE p.id = $1 AND p.actor_id = $2 AND p.visibility = 'public'
            AND p.processing_status = 'ready' AND p.deleted_at IS NULL
            AND ${mediaSafety.publicPostSql('p')}`,
        [linkedPostId, actor.id]
      );
      if (!rows[0]) throw new AppError('The linked post is not owned by this verified actor.', 400, 'media_creator_post_invalid');
    }
    const { rows } = await client.query(
      `INSERT INTO media_creator_gigs
         (owner_user_id, owner_actor_id, linked_post_id, title, brief, budget_cents, max_applications, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.id, actor.id, linkedPostId, title, brief, budget, maxApplications, idempotencyKey]
    );
    await client.query('COMMIT');
    res.status(201).json({ gig: rows[0] });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}

async function applyToGig(req, res, next) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const actor = await verifiedActor(client, req.user.id, req.body?.actorId || null);
    if (!actor) throw new AppError('A current verified helper, business, or restaurant actor is required.', 403, 'media_creator_unverified');
    const pitch = text(req.body?.pitch, 3000, 'Pitch');
    const proposed = asPositiveInt(req.body?.proposedCents);
    const { rows: gigs } = await client.query(`SELECT * FROM media_creator_gigs WHERE id = $1 AND status = 'open' FOR UPDATE`, [req.params.gigId]);
    if (!gigs[0]) throw new AppError('Creator gig not found or closed.', 404, 'media_creator_gig_not_found');
    if (proposed > Number(gigs[0].budget_cents)) {
      throw new AppError('The proposed amount cannot exceed this gig budget.', 400, 'media_creator_amount_over_budget');
    }
    const { rows: existingRows } = await client.query(
      `SELECT * FROM media_creator_applications
        WHERE gig_id = $1 AND applicant_user_id = $2
        FOR UPDATE`, [req.params.gigId, req.user.id]
    );
    if (existingRows[0]) {
      const existing = existingRows[0];
      if (String(existing.applicant_actor_id) !== String(actor.id)
        || String(existing.pitch) !== pitch
        || Number(existing.proposed_cents) !== proposed
        || existing.status !== 'submitted') {
        throw new AppError('This creator application already moved forward or uses different details.', 409, 'media_creator_application_state_invalid');
      }
      await client.query('COMMIT');
      return res.status(200).json({ application: existing, replayed: true });
    }
    const { rows: count } = await client.query(`SELECT COUNT(*)::int AS count FROM media_creator_applications WHERE gig_id = $1`, [req.params.gigId]);
    if (count[0].count >= gigs[0].max_applications) throw new AppError('This gig is no longer accepting applications.', 409, 'media_creator_gig_full');
    const { rows } = await client.query(
      `INSERT INTO media_creator_applications
         (gig_id, applicant_user_id, applicant_actor_id, pitch, proposed_cents)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`, [req.params.gigId, req.user.id, actor.id, pitch, proposed]
    );
    await client.query('COMMIT');
    res.status(201).json({ application: rows[0] });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}

async function listApplications(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT ap.*, g.owner_user_id, a.handle AS applicant_handle, a.display_name AS applicant_name,
              d.id AS deliverable_id, d.post_id AS deliverable_post_id,
              d.status AS deliverable_status
         FROM media_creator_applications ap
         JOIN media_creator_gigs g ON g.id = ap.gig_id
         JOIN media_actors a ON a.id = ap.applicant_actor_id
         LEFT JOIN LATERAL (
           SELECT id, post_id, status FROM media_creator_deliverables
            WHERE application_id = ap.id ORDER BY submitted_at DESC LIMIT 1
         ) d ON TRUE
        WHERE ap.gig_id = $1 AND (g.owner_user_id = $2 OR ap.applicant_user_id = $2)
        ORDER BY ap.created_at DESC`, [req.params.gigId, req.user.id]
    );
    res.json({ applications: rows });
  } catch (err) { next(err); }
}

async function listMyApplications(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT ap.*, g.title AS gig_title, g.brief AS gig_brief, g.status AS gig_status,
              g.owner_user_id, d.id AS deliverable_id, d.post_id AS deliverable_post_id,
              d.status AS deliverable_status
         FROM media_creator_applications ap
         JOIN media_creator_gigs g ON g.id = ap.gig_id
         LEFT JOIN LATERAL (
           SELECT id, post_id, status FROM media_creator_deliverables
            WHERE application_id = ap.id ORDER BY submitted_at DESC LIMIT 1
         ) d ON TRUE
        WHERE ap.applicant_user_id = $1
        ORDER BY ap.updated_at DESC LIMIT 50`, [req.user.id]
    );
    res.json({ applications: rows });
  } catch (err) { next(err); }
}

async function awardApplication(req, res, next) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: currentRows } = await client.query(
      `SELECT ap.*, g.owner_user_id, g.status AS gig_status, g.budget_cents, g.currency_code,
              g.credit_reservation_id, g.award_amount_cents
         FROM media_creator_applications ap
         JOIN media_creator_gigs g ON g.id = ap.gig_id
        WHERE ap.id = $1 AND g.owner_user_id = $2
        FOR UPDATE OF ap, g`, [req.params.applicationId, req.user.id]
    );
    const current = currentRows[0];
    if (!current) throw new AppError('Application is not available to award.', 404, 'media_creator_application_not_found');
    // A lost response after a successful award is safely replayable.
    if (current.status === 'awarded' && current.gig_status === 'awarded' && current.credit_reservation_id) {
      await client.query('COMMIT');
      return res.json({ application: current, replayed: true });
    }
    if (current.gig_status !== 'open' || !['submitted', 'shortlisted'].includes(current.status)) {
      throw new AppError('Application is not available to award.', 409, 'media_creator_application_state_invalid');
    }
    const awardAmount = Number(current.proposed_cents);
    if (!Number.isSafeInteger(awardAmount) || awardAmount <= 0 || awardAmount > Number(current.budget_cents)) {
      throw new AppError('The application amount is not valid for this gig.', 409, 'media_creator_amount_invalid');
    }
    await creditService.assertCreditRailEnabled(client);
    await creditService.assertCreditRailNotFrozen(client);
    const ownerAccount = await ensureAccount(client, {
      accountType: 'customer_wallet', customerId: current.owner_user_id,
      currencyCode: current.currency_code, allowNonCustomerOwner: true,
    });
    const reservationResult = await reserveFunds(client, {
      accountId: ownerAccount.id,
      reservationType: 'media_creator_gig',
      referenceType: 'media_creator_gig',
      referenceId: current.gig_id,
      amountCents: awardAmount,
    });
    const { rows } = await client.query(
      `UPDATE media_creator_applications SET status = 'awarded', updated_at = NOW()
        WHERE id = $1 RETURNING *`, [current.id]
    );
    const awardedApplication = requireMutationRow(rows, 'The creator application could not be awarded.', 'media_creator_award_transition_failed');
    const { rows: gigRows } = await client.query(
      `UPDATE media_creator_gigs
          SET status = 'awarded', award_amount_cents = $2, credit_reservation_id = $3, updated_at = NOW()
        WHERE id = $1 AND status = 'open'
        RETURNING id, status, award_amount_cents, credit_reservation_id`, [current.gig_id, awardAmount, reservationResult.reservation.id]
    );
    requireMutationRow(gigRows, 'The creator gig could not be awarded.', 'media_creator_award_transition_failed');
    await client.query(
      `UPDATE media_creator_applications SET status = 'rejected', updated_at = NOW()
        WHERE gig_id = $1 AND id <> $2 AND status IN ('submitted','shortlisted')`, [current.gig_id, current.id]
    );
    await client.query('COMMIT');
    res.json({ application: awardedApplication, reservation: reservationResult.reservation });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}

async function submitDeliverable(req, res, next) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: applications } = await client.query(
      `SELECT ap.id, ap.status, ap.applicant_actor_id
         FROM media_creator_applications ap
        WHERE ap.id = $1 AND ap.applicant_user_id = $2
        FOR UPDATE`,
      [req.params.applicationId, req.user.id]
    );
    const application = applications[0];
    if (!application || application.status !== 'awarded') {
      throw new AppError('Only an awarded creator application can submit a deliverable.', 403, 'media_creator_deliverable_invalid');
    }
    const { rows: posts } = await client.query(
      `SELECT p.id FROM media_posts p
        JOIN media_creator_applications ap ON ap.applicant_actor_id = p.actor_id
        JOIN media_actors a ON a.id = p.actor_id
        WHERE ap.id = $1 AND ap.applicant_user_id = $2 AND ap.status = 'awarded'
          AND p.id = $3 AND p.visibility = 'public' AND p.processing_status = 'ready' AND p.deleted_at IS NULL
          AND (${verifiedActorSql('a')}) AND ${mediaSafety.publicPostSql('p')}`,
      [req.params.applicationId, req.user.id, req.body?.postId]
    );
    if (!posts[0]) throw new AppError('Only a published post owned by the awarded creator can be submitted.', 403, 'media_creator_deliverable_invalid');
    const { rows } = await client.query(
      `INSERT INTO media_creator_deliverables (application_id, post_id, note)
       VALUES ($1,$2,$3) ON CONFLICT (application_id, post_id) DO UPDATE SET note = EXCLUDED.note, status = 'submitted'
       RETURNING *`, [req.params.applicationId, req.body.postId, typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 2000) || null : null]
    );
    const { rows: deliveredApplicationRows } = await client.query(
      `UPDATE media_creator_applications SET status = 'delivered', updated_at = NOW()
        WHERE id = $1 AND status = 'awarded'
        RETURNING id, status`, [req.params.applicationId]
    );
    requireMutationRow(
      deliveredApplicationRows,
      'The creator application could not be marked delivered.',
      'media_creator_deliverable_transition_failed'
    );
    await client.query('COMMIT');
    res.status(201).json({ deliverable: rows[0] });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}

async function reviewDeliverable(req, res, next) {
  const requestedStatus = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
  if (!['approved', 'changes_requested', 'rejected'].includes(requestedStatus)) {
    return next(new AppError('Deliverable review status is invalid.', 400, 'media_creator_review_status_invalid'));
  }
  const status = requestedStatus;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: currentRows } = await client.query(
      `SELECT d.*, ap.applicant_user_id, ap.gig_id, ap.status AS application_status,
              g.owner_user_id, g.award_amount_cents, g.currency_code,
              g.credit_reservation_id, g.credit_transaction_id, g.status AS gig_status
         FROM media_creator_deliverables d
         JOIN media_creator_applications ap ON ap.id = d.application_id
         JOIN media_creator_gigs g ON g.id = ap.gig_id
        WHERE d.id = $1 AND g.owner_user_id = $2
        FOR UPDATE OF d, ap, g`, [req.params.deliverableId, req.user.id]
    );
    const current = currentRows[0];
    if (!current) throw new AppError('Deliverable not found.', 404, 'media_creator_deliverable_not_found');
    if (current.status === 'approved' && status === 'approved' && current.credit_transaction_id) {
      await client.query('COMMIT');
      return res.json({ deliverable: current, replayed: true });
    }
    if (current.status !== 'submitted') {
      throw new AppError('Only a submitted deliverable can be reviewed.', 409, 'media_creator_deliverable_state_invalid');
    }

    let transfer = null;
    let transactionId = current.credit_transaction_id;
    if (status === 'approved') {
      if (!current.credit_reservation_id || !current.award_amount_cents) {
        throw new AppError('This award has no active Credit reservation.', 409, 'media_creator_reservation_missing');
      }
      await creditService.assertCreditRailEnabled(client);
      await creditService.assertCreditRailNotFrozen(client);
      const reservation = requireMatchingReservation(await getActiveReservation(client, {
        referenceType: 'media_creator_gig', referenceId: current.gig_id,
      }), current.credit_reservation_id, current.award_amount_cents);
      await releaseReservation(client, {
        reservationId: reservation.id,
        reason: 'Approved Media creator deliverable',
      });
      transfer = await transferCreditInTransaction(client, {
        senderCustomerId: current.owner_user_id,
        recipientCustomerId: current.applicant_user_id,
        amountCents: current.award_amount_cents,
        currencyCode: current.currency_code,
        idempotencyKey: `media-creator-gig:${current.gig_id}`,
        actorUserId: current.owner_user_id,
        referenceType: 'media_creator_gig',
        referenceId: current.gig_id,
        requestIp: req.ip || null,
        description: 'OxSteed Media approved creator gig',
        metadata: { mediaCreatorGigId: current.gig_id, deliverableId: current.id },
        allowCreatorRecipient: true,
        allowCreatorSender: true,
      });
      transactionId = requireTransactionId(transfer);
    }

    const { rows } = await client.query(
      `UPDATE media_creator_deliverables SET status = $2, reviewed_at = NOW()
        WHERE id = $1 RETURNING *`, [current.id, status]
    );
    const reviewedDeliverable = requireMutationRow(rows, 'The deliverable review could not be saved.', 'media_creator_review_transition_failed');
    if (status === 'approved') {
      const { rows: approvedApplicationRows } = await client.query(
        `UPDATE media_creator_applications SET status = 'approved', updated_at = NOW()
          WHERE id = $1 RETURNING id, status`, [current.application_id]
      );
      requireMutationRow(approvedApplicationRows, 'The creator application could not be approved.', 'media_creator_review_transition_failed');
      const { rows: completedGigRows } = await client.query(
        `UPDATE media_creator_gigs SET status = 'completed', credit_transaction_id = $2, updated_at = NOW()
          WHERE id = $1 RETURNING id, status, credit_transaction_id`,
        [current.gig_id, transactionId]
      );
      requireMutationRow(completedGigRows, 'The creator gig could not be completed.', 'media_creator_review_transition_failed');
    } else if (status === 'changes_requested') {
      const { rows: returnedApplicationRows } = await client.query(
        `UPDATE media_creator_applications SET status = 'awarded', updated_at = NOW()
          WHERE id = $1 RETURNING id, status`, [current.application_id]
      );
      requireMutationRow(returnedApplicationRows, 'The creator application could not be returned for changes.', 'media_creator_review_transition_failed');
    } else {
      const { rows: rejectedApplicationRows } = await client.query(
        `UPDATE media_creator_applications SET status = 'rejected', updated_at = NOW()
          WHERE id = $1 RETURNING id, status`, [current.application_id]
      );
      requireMutationRow(rejectedApplicationRows, 'The creator application could not be rejected.', 'media_creator_review_transition_failed');
      if (current.credit_reservation_id) {
        await releaseReservation(client, {
          reservationId: current.credit_reservation_id,
          reason: 'Rejected Media creator deliverable',
        });
      }
      const { rows: cancelledGigRows } = await client.query(
        `UPDATE media_creator_gigs SET status = 'cancelled', updated_at = NOW()
          WHERE id = $1 RETURNING id, status`, [current.gig_id]
      );
      requireMutationRow(cancelledGigRows, 'The creator gig could not be cancelled.', 'media_creator_review_transition_failed');
    }
    await client.query('COMMIT');
    res.json({ deliverable: reviewedDeliverable, ...(transfer ? { transfer } : {}) });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}

async function createTip(req, res, next) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const amount = asPositiveInt(req.body?.amountCents);
    const idempotencyKey = text(req.get('Idempotency-Key') || req.body?.idempotencyKey, 160, 'Idempotency-Key');
    const actor = await verifiedCreatorById(client, req.body?.actorId);
    if (!actor) throw new AppError('Creator actor is not currently verified.', 404, 'media_creator_actor_not_found');
    if (String(actor.owner_user_id) === String(req.user.id)) throw new AppError('You cannot tip your own creator account.', 400, 'media_creator_self_payment');
    if (req.body?.postId) {
      const { rows: posts } = await client.query(
        `SELECT p.id FROM media_posts p
          WHERE p.id = $1 AND p.actor_id = $2 AND p.visibility = 'public'
            AND p.processing_status = 'ready' AND p.deleted_at IS NULL
            AND ${mediaSafety.publicPostSql('p')}`, [req.body.postId, actor.id]
      );
      if (!posts[0]) throw new AppError('The tip post is not available.', 404, 'media_creator_post_invalid');
    }
    const { rows: existingRows } = await client.query(
      `SELECT * FROM media_creator_tips WHERE from_user_id = $1 AND idempotency_key = $2 FOR UPDATE`,
      [req.user.id, idempotencyKey]
    );
    if (existingRows[0]) {
      const existing = existingRows[0];
      if (String(existing.creator_actor_id) !== String(actor.id)
        || Number(existing.amount_cents) !== amount
        || String(existing.post_id || '') !== String(req.body?.postId || '')) {
        throw new AppError('Tip idempotency key was already used for different payment details.', 409, 'media_creator_idempotency_conflict');
      }
      await client.query('COMMIT');
      return res.status(202).json({ tip: existing, replayed: true });
    }
    const { rows } = await client.query(
      `INSERT INTO media_creator_tips (from_user_id, creator_actor_id, post_id, amount_cents, idempotency_key)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, actor.id, req.body?.postId || null, amount, idempotencyKey]
    );
    const tip = requireMutationRow(rows, 'The creator tip could not be saved.', 'media_creator_tip_transition_failed');
    await client.query('COMMIT');
    res.status(202).json({ tip, next: 'Credit transfer authorization is required before settlement.' });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}

async function createSponsorship(req, res, next) {
  const client = await pool.connect();
  try {
    const amount = asPositiveInt(req.body?.amountCents);
    const brief = text(req.body?.brief, 3000, 'Brief');
    const idempotencyKey = text(req.get('Idempotency-Key') || req.body?.idempotencyKey, 160, 'Idempotency-Key');
    await client.query('BEGIN');
    const actor = await verifiedCreatorById(client, req.body?.actorId);
    if (!actor) throw new AppError('Creator actor is not currently verified.', 404, 'media_creator_actor_not_found');
    if (String(actor.owner_user_id) === String(req.user.id)) throw new AppError('You cannot sponsor your own creator account.', 400, 'media_creator_self_payment');
    if (req.body?.postId) {
      const { rows: posts } = await client.query(
        `SELECT p.id FROM media_posts p
          WHERE p.id = $1 AND p.actor_id = $2 AND p.visibility = 'public'
            AND p.processing_status = 'ready' AND p.deleted_at IS NULL
            AND ${mediaSafety.publicPostSql('p')}`, [req.body.postId, actor.id]
      );
      if (!posts[0]) throw new AppError('The sponsorship post is not available.', 404, 'media_creator_post_invalid');
    }
    const { rows: existingRows } = await client.query(
      `SELECT * FROM media_creator_sponsorships
        WHERE sponsor_user_id = $1 AND idempotency_key = $2
        FOR UPDATE`,
      [req.user.id, idempotencyKey]
    );
    if (existingRows[0]) {
      const existing = existingRows[0];
      if (String(existing.creator_actor_id) !== String(actor.id)
        || Number(existing.amount_cents) !== amount
        || String(existing.brief) !== brief
        || String(existing.post_id || '') !== String(req.body?.postId || '')) {
        throw new AppError('Sponsorship idempotency key was already used for different offer details.', 409, 'media_creator_idempotency_conflict');
      }
      await client.query('COMMIT');
      return res.status(202).json({ sponsorship: existing, replayed: true });
    }
    const { rows } = await client.query(
      `INSERT INTO media_creator_sponsorships
         (sponsor_user_id, creator_actor_id, post_id, brief, amount_cents, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, actor.id, req.body?.postId || null, brief, amount, idempotencyKey]
    );
    const sponsorship = requireMutationRow(rows, 'The creator sponsorship could not be saved.', 'media_creator_sponsorship_transition_failed');
    await client.query('COMMIT');
    res.status(202).json({ sponsorship, next: 'Credit transfer authorization is required before settlement.' });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}

async function listSponsorships(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, a.handle AS creator_handle, a.display_name AS creator_name,
              a.owner_user_id AS creator_user_id
         FROM media_creator_sponsorships s
         JOIN media_actors a ON a.id = s.creator_actor_id
        WHERE s.sponsor_user_id = $1 OR a.owner_user_id = $1
        ORDER BY s.created_at DESC LIMIT 50`, [req.user.id]
    );
    res.json({ sponsorships: rows });
  } catch (err) { next(err); }
}

async function acceptSponsorship(req, res, next) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: offerRows } = await client.query(
      `SELECT s.*, a.owner_user_id AS creator_user_id
         FROM media_creator_sponsorships s
         JOIN media_actors a ON a.id = s.creator_actor_id
        WHERE s.id = $1
        FOR UPDATE OF s`, [req.params.sponsorshipId]
    );
    const offer = offerRows[0];
    if (!offer) throw new AppError('Sponsorship offer is not available.', 404, 'media_creator_sponsorship_not_found');
    if (offer.status === 'accepted' && offer.credit_reservation_id) {
      await client.query('COMMIT');
      return res.json({ sponsorship: offer, replayed: true });
    }
    if (offer.status !== 'pending_credit' || String(offer.creator_user_id) !== String(req.user.id)) {
      throw new AppError('Sponsorship offer is not available.', 409, 'media_creator_sponsorship_state_invalid');
    }
    const actor = await verifiedCreatorById(client, offer.creator_actor_id);
    if (!actor || String(actor.owner_user_id) !== String(req.user.id)) throw new AppError('Creator verification is no longer active.', 409, 'media_creator_unverified');
    await creditService.assertCreditRailEnabled(client);
    await creditService.assertCreditRailNotFrozen(client);
    const sponsorAccount = await ensureAccount(client, {
      accountType: 'customer_wallet', customerId: offer.sponsor_user_id,
      currencyCode: offer.currency_code, allowNonCustomerOwner: true,
    });
    const reservationResult = await reserveFunds(client, {
      accountId: sponsorAccount.id,
      reservationType: 'media_creator_sponsorship',
      referenceType: 'media_creator_sponsorship',
      referenceId: offer.id,
      amountCents: offer.amount_cents,
    });
    const { rows } = await client.query(
      `UPDATE media_creator_sponsorships
          SET status = 'accepted', credit_reservation_id = $2, updated_at = NOW()
        WHERE id = $1 AND status = 'pending_credit'
        RETURNING *`, [offer.id, reservationResult.reservation.id]
    );
    const acceptedSponsorship = requireMutationRow(rows, 'The sponsorship acceptance could not be saved.', 'media_creator_sponsorship_transition_failed');
    await client.query('COMMIT');
    res.json({ sponsorship: acceptedSponsorship, reservation: reservationResult.reservation, replayed: reservationResult.replayed });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}

async function listCreatorPayments(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT 'tip'::text AS kind, t.id, t.status, t.amount_cents, t.currency_code,
                t.credit_transaction_id, t.created_at, tx.posted_at,
                t.from_user_id AS payer_user_id, a.owner_user_id AS creator_user_id,
                t.post_id, dispute.id AS dispute_id, dispute.status AS dispute_status,
                dispute.resolution AS dispute_resolution
           FROM media_creator_tips t
           JOIN media_actors a ON a.id = t.creator_actor_id
           LEFT JOIN oxsteed_credit_transactions tx ON tx.id = t.credit_transaction_id
           LEFT JOIN LATERAL (
             SELECT d.id, d.status, d.resolution
               FROM oxsteed_credit_disputes d
              WHERE d.transaction_id = t.credit_transaction_id
              ORDER BY d.opened_at DESC, d.id DESC
              LIMIT 1
           ) dispute ON TRUE
          WHERE t.from_user_id = $1 OR a.owner_user_id = $1
         UNION ALL
         SELECT 'sponsorship'::text AS kind, s.id, s.status, s.amount_cents, s.currency_code,
                s.credit_transaction_id, s.created_at, tx.posted_at,
                s.sponsor_user_id AS payer_user_id, a.owner_user_id AS creator_user_id,
                s.post_id, dispute.id AS dispute_id, dispute.status AS dispute_status,
                dispute.resolution AS dispute_resolution
           FROM media_creator_sponsorships s
           JOIN media_actors a ON a.id = s.creator_actor_id
           LEFT JOIN oxsteed_credit_transactions tx ON tx.id = s.credit_transaction_id
           LEFT JOIN LATERAL (
             SELECT d.id, d.status, d.resolution
               FROM oxsteed_credit_disputes d
              WHERE d.transaction_id = s.credit_transaction_id
              ORDER BY d.opened_at DESC, d.id DESC
              LIMIT 1
           ) dispute ON TRUE
          WHERE s.sponsor_user_id = $1 OR a.owner_user_id = $1
         UNION ALL
         SELECT 'boost'::text AS kind, b.id, b.status, b.amount_cents, b.currency_code,
                b.credit_transaction_id, b.created_at, tx.posted_at,
                b.purchaser_user_id AS payer_user_id, a.owner_user_id AS creator_user_id,
                b.post_id, dispute.id AS dispute_id, dispute.status AS dispute_status,
                dispute.resolution AS dispute_resolution
           FROM media_post_boosts b
           JOIN media_posts p ON p.id = b.post_id
           JOIN media_actors a ON a.id = p.actor_id
           LEFT JOIN oxsteed_credit_transactions tx ON tx.id = b.credit_transaction_id
           LEFT JOIN LATERAL (
             SELECT d.id, d.status, d.resolution
               FROM oxsteed_credit_disputes d
              WHERE d.transaction_id = b.credit_transaction_id
              ORDER BY d.opened_at DESC, d.id DESC
              LIMIT 1
           ) dispute ON TRUE
          WHERE b.purchaser_user_id = $1 OR a.owner_user_id = $1
       ) payments
      ORDER BY created_at DESC, id DESC
      LIMIT 100`, [req.user.id]
    );
    res.json({ payments: rows });
  } catch (err) { next(err); }
}

async function submitSponsorshipDeliverable(req, res, next) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: sponsorshipRows } = await client.query(
      `SELECT s.*, a.owner_user_id AS creator_user_id
         FROM media_creator_sponsorships s
         JOIN media_actors a ON a.id = s.creator_actor_id
        WHERE s.id = $1
        FOR UPDATE OF s`, [req.params.sponsorshipId]
    );
    const sponsorship = sponsorshipRows[0];
    if (!sponsorship) throw new AppError('Sponsorship was not found.', 404, 'media_creator_sponsorship_not_found');
    if (String(sponsorship.creator_user_id) !== String(req.user.id)) {
      throw new AppError('Only the verified creator can submit this deliverable.', 403, 'media_creator_sponsorship_forbidden');
    }
    if (!['accepted', 'delivered'].includes(sponsorship.status)) {
      throw new AppError('This sponsorship is not accepting a deliverable.', 409, 'media_creator_sponsorship_state_invalid');
    }
    const postId = req.body?.postId;
    const { rows: posts } = await client.query(
      `SELECT p.id
         FROM media_posts p
         JOIN media_actors a ON a.id = p.actor_id
        WHERE p.id = $1 AND p.actor_id = $2 AND p.visibility = 'public'
          AND p.processing_status = 'ready' AND p.deleted_at IS NULL
          AND (${verifiedActorSql('a')}) AND ${mediaSafety.publicPostSql('p')}`,
      [postId, sponsorship.creator_actor_id]
    );
    if (!posts[0]) throw new AppError('Only a published post owned by the creator can be submitted.', 403, 'media_creator_sponsorship_deliverable_invalid');
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 2000) || null : null;
    const { rows } = await client.query(
      `UPDATE media_creator_sponsorships
          SET status = 'delivered', delivery_post_id = $2, delivery_note = $3, updated_at = NOW()
        WHERE id = $1 AND status IN ('accepted','delivered')
        RETURNING *`, [sponsorship.id, postId, note]
    );
    const deliveredSponsorship = requireMutationRow(rows, 'The sponsorship deliverable could not be saved.', 'media_creator_sponsorship_transition_failed');
    await client.query('COMMIT');
    res.status(201).json({ sponsorship: deliveredSponsorship });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}

async function settleSponsorship(req, res, next) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT s.*, a.owner_user_id AS creator_user_id
         FROM media_creator_sponsorships s JOIN media_actors a ON a.id = s.creator_actor_id
        WHERE s.id = $1 AND s.sponsor_user_id = $2
        FOR UPDATE OF s`, [req.params.sponsorshipId, req.user.id]
    );
    const sponsorship = rows[0];
    if (!sponsorship) throw new AppError('Sponsorship is not ready for settlement.', 409, 'media_creator_sponsorship_not_ready');
    if (sponsorship.status === 'completed' && sponsorship.credit_transaction_id) {
      await client.query('COMMIT');
      return res.json({ sponsorship, replayed: true });
    }
    if (sponsorship.status !== 'delivered') throw new AppError('The creator must submit an approved deliverable before settlement.', 409, 'media_creator_sponsorship_deliverable_required');
    const currentActor = await verifiedCreatorById(client, sponsorship.creator_actor_id);
    if (!currentActor) throw new AppError('Creator verification is no longer active.', 409, 'media_creator_unverified');
    await creditService.assertCreditRailEnabled(client);
    await creditService.assertCreditRailNotFrozen(client);
    const reservation = requireMatchingReservation(await getActiveReservation(client, {
      referenceType: 'media_creator_sponsorship', referenceId: sponsorship.id,
    }), sponsorship.credit_reservation_id, sponsorship.amount_cents);
    await releaseReservation(client, {
      reservationId: reservation.id,
      reason: 'Approved Media creator sponsorship deliverable',
    });
    const transfer = await settleCreatorCreditInTransaction(client, {
      senderCustomerId: sponsorship.sponsor_user_id,
      recipientCustomerId: sponsorship.creator_user_id,
      amountCents: sponsorship.amount_cents,
      currencyCode: sponsorship.currency_code,
      idempotencyKey: `media-sponsorship:${sponsorship.id}`,
      actorUserId: req.user.id,
      referenceType: 'media_creator_sponsorship',
      referenceId: sponsorship.id,
      requestIp: req.ip || null,
      description: 'OxSteed Media approved creator sponsorship',
      metadata: { mediaSponsorshipId: sponsorship.id, deliveryPostId: sponsorship.delivery_post_id },
    });
    const transactionId = requireTransactionId(transfer);
    const { rows: updated } = await client.query(
      `UPDATE media_creator_sponsorships
          SET status = 'completed', credit_transaction_id = $2, updated_at = NOW()
        WHERE id = $1 AND status = 'delivered'
        RETURNING *`, [sponsorship.id, transactionId]
    );
    const completedSponsorship = requireMutationRow(updated, 'The sponsorship settlement could not be saved.', 'media_creator_sponsorship_transition_failed');
    await client.query('COMMIT');
    res.json({ sponsorship: completedSponsorship, transfer });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}

async function cancelSponsorship(req, res, next) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT s.*, a.owner_user_id AS creator_user_id
         FROM media_creator_sponsorships s JOIN media_actors a ON a.id = s.creator_actor_id
        WHERE s.id = $1
        FOR UPDATE OF s`, [req.params.sponsorshipId]
    );
    const sponsorship = rows[0];
    if (!sponsorship) throw new AppError('Sponsorship cannot be cancelled.', 404, 'media_creator_sponsorship_not_found');
    const isParty = String(sponsorship.sponsor_user_id) === String(req.user.id)
      || String(sponsorship.creator_user_id) === String(req.user.id);
    if (!isParty) {
      throw new AppError('Sponsorship cannot be cancelled.', 409, 'media_creator_sponsorship_cancel_invalid');
    }
    if (sponsorship.status === 'cancelled') {
      await client.query('COMMIT');
      return res.json({ sponsorship, replayed: true });
    }
    if (!['pending_credit', 'accepted', 'delivered'].includes(sponsorship.status)) {
      throw new AppError('Sponsorship cannot be cancelled.', 409, 'media_creator_sponsorship_cancel_invalid');
    }
    if (sponsorship.credit_reservation_id) {
      await releaseReservation(client, {
        reservationId: sponsorship.credit_reservation_id,
        reason: 'Media creator sponsorship cancelled',
      });
    }
    const { rows: updated } = await client.query(
      `UPDATE media_creator_sponsorships SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1 AND status IN ('pending_credit','accepted','delivered') RETURNING *`, [sponsorship.id]
    );
    const cancelledSponsorship = requireMutationRow(updated, 'The sponsorship cancellation could not be saved.', 'media_creator_sponsorship_transition_failed');
    await client.query('COMMIT');
    res.json({ sponsorship: cancelledSponsorship });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}

async function cancelGig(req, res, next) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM media_creator_gigs
        WHERE id = $1 AND owner_user_id = $2
        FOR UPDATE`, [req.params.gigId, req.user.id]
    );
    const gig = rows[0];
    if (!gig) throw new AppError('Creator gig not found.', 404, 'media_creator_gig_not_found');
    if (['completed', 'cancelled'].includes(gig.status)) {
      await client.query('COMMIT');
      return res.json({ gig, replayed: true });
    }
    if (gig.credit_reservation_id) {
      await releaseReservation(client, {
        reservationId: gig.credit_reservation_id,
        reason: 'Media creator gig cancelled',
      });
    }
    const { rows: updated } = await client.query(
      `UPDATE media_creator_gigs SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1 AND status NOT IN ('completed','cancelled') RETURNING *`, [gig.id]
    );
    const cancelledGig = requireMutationRow(updated, 'The creator gig cancellation could not be saved.', 'media_creator_gig_transition_failed');
    await client.query(
      `UPDATE media_creator_applications SET status = 'rejected', updated_at = NOW()
        WHERE gig_id = $1 AND status IN ('submitted','shortlisted','awarded','delivered')`, [gig.id]
    );
    await client.query('COMMIT');
    res.json({ gig: cancelledGig });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}

async function createBoost(req, res, next) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const amount = asPositiveInt(req.body?.amountCents);
    const idempotencyKey = text(req.get('Idempotency-Key') || req.body?.idempotencyKey, 160, 'Idempotency-Key');
    const { rows: posts } = await client.query(
      `SELECT p.id
         FROM media_posts p
         JOIN media_actors a ON a.id = p.actor_id
        WHERE p.id = $1 AND p.visibility = 'public' AND p.processing_status = 'ready'
          AND p.deleted_at IS NULL AND ${mediaSafety.publicPostSql('p')}
          AND (${verifiedActorSql('a')})`, [req.params.postId]
    );
    if (!posts[0]) throw new AppError('Only a published, safety-cleared post can be boosted.', 409, 'media_boost_post_not_ready');
    const { rows: existingRows } = await client.query(
      `SELECT * FROM media_post_boosts WHERE purchaser_user_id = $1 AND idempotency_key = $2 FOR UPDATE`,
      [req.user.id, idempotencyKey]
    );
    if (existingRows[0]) {
      const existing = existingRows[0];
      if (String(existing.post_id) !== String(req.params.postId) || Number(existing.amount_cents) !== amount) {
        throw new AppError('Boost idempotency key was already used for different payment details.', 409, 'media_creator_idempotency_conflict');
      }
      await client.query('COMMIT');
      return res.status(202).json({ boost: existing, replayed: true, disclosure: { amountCents: amount, currencyCode: existing.currency_code } });
    }
    const { rows } = await client.query(
      `INSERT INTO media_post_boosts (post_id, purchaser_user_id, amount_cents, idempotency_key)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.postId, req.user.id, amount, idempotencyKey]
    );
    await client.query('COMMIT');
    res.status(202).json({ boost: rows[0], disclosure: { amountCents: amount, currencyCode: rows[0]?.currency_code || 'USD' }, next: 'Boost activates only after a completed Credit settlement.' });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}

async function settleBoost(req, res, next) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT b.*, p.visibility, p.processing_status
         FROM media_post_boosts b JOIN media_posts p ON p.id = b.post_id
         JOIN media_actors a ON a.id = p.actor_id
        WHERE b.id = $1 AND b.purchaser_user_id = $2
          AND p.deleted_at IS NULL AND ${mediaSafety.publicPostSql('p')}
          AND (${verifiedActorSql('a')})
        FOR UPDATE OF b`, [req.params.boostId, req.user.id]
    );
    const boost = rows[0];
    if (!boost) throw new AppError('Boost is not ready for settlement.', 404, 'media_boost_not_found');
    if (['scheduled', 'active', 'completed'].includes(boost.status) && boost.credit_transaction_id) {
      await client.query('COMMIT');
      return res.json({ boost, replayed: true });
    }
    if (boost.status !== 'pending_credit') throw new AppError('Boost is not ready for settlement.', 409, 'media_boost_not_ready');
    if (boost.visibility !== 'public' || boost.processing_status !== 'ready') throw new AppError('The boosted post is no longer available.', 409, 'media_boost_post_not_ready');
    const transfer = await chargeCreatorBoostInTransaction(client, {
      senderCustomerId: req.user.id,
      amountCents: boost.amount_cents,
      currencyCode: boost.currency_code,
      idempotencyKey: `media-boost:${boost.id}`,
      actorUserId: req.user.id,
      referenceType: 'media_post_boost', referenceId: boost.id,
      requestIp: req.ip || null,
      description: 'OxSteed Media paid post boost',
      metadata: { mediaBoostId: boost.id, postId: boost.post_id },
    });
    const { rows: updated } = await client.query(
      `UPDATE media_post_boosts
          SET status = 'active', credit_transaction_id = $2, starts_at = NOW(), ends_at = NOW() + INTERVAL '24 hours'
        WHERE id = $1 AND status = 'pending_credit' RETURNING *`,
      [boost.id, requireTransactionId(transfer)]
    );
    const activeBoost = requireMutationRow(updated, 'The boost payment could not be activated.', 'media_boost_transition_failed');
    await client.query('COMMIT');
    res.json({ boost: activeBoost, transfer });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}

async function cancelBoost(req, res, next) {
  try {
    const { rows } = await pool.query(
      `UPDATE media_post_boosts SET status = 'cancelled'
        WHERE id = $1 AND purchaser_user_id = $2 AND status = 'pending_credit' RETURNING *`,
      [req.params.boostId, req.user.id]
    );
    if (!rows[0]) {
      const { rows: existing } = await pool.query(
        `SELECT * FROM media_post_boosts WHERE id = $1 AND purchaser_user_id = $2`,
        [req.params.boostId, req.user.id]
      );
      if (existing[0]?.status === 'cancelled') return res.json({ boost: existing[0], replayed: true });
      throw new AppError('Boost cannot be cancelled after settlement.', 409, 'media_boost_cancel_invalid');
    }
    res.json({ boost: rows[0] });
  } catch (err) { next(err); }
}

/**
 * Open a Credit dispute for a settled creator payment.  The caller is always
 * resolved from the creator payment row, so a client cannot submit an
 * arbitrary ledger transaction id or dispute another customer's transfer.
 * The shared Credit dispute service owns idempotency, one-open-case rules,
 * audit history, and the eventual admin resolution path.
 */
async function openCreatorDispute(req, res, next) {
  try {
    const kind = String(req.params.kind || '').trim().toLowerCase();
    const id = String(req.params.id || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new AppError('Creator payment was not found.', 404, 'media_creator_dispute_payment_not_found');
    }
    const queries = {
      tip: `SELECT t.id, t.from_user_id AS payer_user_id, t.credit_transaction_id AS transaction_id,
                   t.status AS payment_status
              FROM media_creator_tips t
             WHERE t.id = $1 AND t.from_user_id = $2 AND t.status = 'posted'`,
      sponsorship: `SELECT s.id, s.sponsor_user_id AS payer_user_id, tx.id AS transaction_id,
                           s.status AS payment_status
                      FROM media_creator_sponsorships s
                      JOIN oxsteed_credit_transactions tx
                        ON tx.reference_type = 'media_creator_sponsorship'
                       AND tx.reference_id = s.id::text
                       AND tx.transaction_type = 'settlement'
                       AND tx.status = 'posted'
                     WHERE s.id = $1 AND s.sponsor_user_id = $2
                       AND s.status IN ('completed','delivered')
                     ORDER BY tx.posted_at DESC NULLS LAST, tx.id DESC LIMIT 1`,
      boost: `SELECT b.id, b.purchaser_user_id AS payer_user_id, tx.id AS transaction_id,
                     b.status AS payment_status
                FROM media_post_boosts b
                JOIN oxsteed_credit_transactions tx
                  ON tx.reference_type = 'media_post_boost'
                 AND tx.reference_id = b.id::text
                 AND tx.transaction_type = 'settlement'
                 AND tx.status = 'posted'
               WHERE b.id = $1 AND b.purchaser_user_id = $2
                 AND b.status IN ('scheduled','active','completed')
               ORDER BY tx.posted_at DESC NULLS LAST, tx.id DESC LIMIT 1`,
    };
    if (!queries[kind]) throw new AppError('Unsupported creator payment type.', 400, 'media_creator_dispute_type_invalid');
    const { rows } = await pool.query(queries[kind], [id, req.user.id]);
    const payment = rows[0];
    if (!payment?.transaction_id) throw new AppError('This creator payment is not eligible for a dispute.', 404, 'media_creator_dispute_payment_not_found');
    const description = text(req.body?.description, 4000, 'Description');
    const idempotencyKey = text(req.get('Idempotency-Key') || req.body?.idempotencyKey, 160, 'Idempotency-Key');
    const result = await creditService.openCreditDispute({
      customerId: req.user.id,
      transactionId: payment.transaction_id,
      reasonCode: text(req.body?.reasonCode || 'media_creator_dispute', 60, 'Reason'),
      description,
      actorUserId: req.user.id,
      idempotencyKey,
      requestIp: req.ip || null,
      // The current Credit schema deliberately limits dispute types. Keep
      // creator disputes in that audited path until a dedicated marketplace
      // dispute taxonomy is approved and migrated.
      disputeType: 'incorrect_amount',
    });
    res.status(result.replayed ? 200 : 201).json({ ...result, payment: { kind, id, status: payment.payment_status } });
  } catch (err) { next(err); }
}

async function settleTip(req, res, next) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT t.*, a.owner_user_id AS creator_user_id
         FROM media_creator_tips t JOIN media_actors a ON a.id = t.creator_actor_id
        WHERE t.id = $1 AND t.from_user_id = $2
        FOR UPDATE OF t`, [req.params.tipId, req.user.id]
    );
    const tip = rows[0];
    if (!tip) throw new AppError('Tip not found.', 404, 'media_creator_tip_not_found');
    if (tip.status === 'posted' && tip.credit_transaction_id) {
      await client.query('COMMIT');
      return res.json({ tip, replayed: true });
    }
    if (tip.status !== 'pending_credit') throw new AppError('Tip is not ready for settlement.', 409, 'media_creator_tip_state_invalid');
    const currentActor = await verifiedCreatorById(client, tip.creator_actor_id);
    if (!currentActor) throw new AppError('Creator verification is no longer active.', 409, 'media_creator_unverified');
    const transfer = await settleCreatorCreditInTransaction(client, {
      senderCustomerId: req.user.id,
      recipientCustomerId: tip.creator_user_id,
      amountCents: tip.amount_cents,
      currencyCode: tip.currency_code,
      idempotencyKey: `media-tip:${tip.id}`,
      actorUserId: req.user.id,
      referenceType: 'media_creator_tip',
      referenceId: tip.id,
      requestIp: req.ip || null,
      description: 'OxSteed Media creator tip',
      metadata: { mediaTipId: tip.id, postId: tip.post_id || null },
    });
    const { rows: updated } = await client.query(
      `UPDATE media_creator_tips SET status = 'posted', credit_transaction_id = $2
        WHERE id = $1 AND status = 'pending_credit' RETURNING *`,
      [tip.id, requireTransactionId(transfer)]
    );
    const postedTip = requireMutationRow(updated, 'The tip settlement could not be saved.', 'media_creator_tip_transition_failed');
    await client.query('COMMIT');
    res.json({ tip: postedTip, transfer });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}

module.exports = {
  listGigs, createGig, applyToGig, listApplications, listMyApplications, listCreatorPayments, awardApplication,
  submitDeliverable, reviewDeliverable, cancelGig, createTip, createSponsorship, listSponsorships, createBoost,
  settleTip, submitSponsorshipDeliverable,
  acceptSponsorship, settleSponsorship, cancelSponsorship, settleBoost, cancelBoost,
  openCreatorDispute,
};
