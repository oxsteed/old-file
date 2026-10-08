'use strict';

const pool = require('../db');
const AppError = require('../utils/appError');
const { verifiedActorSql } = require('../services/mediaPublisherPolicy');
const creditService = require('../services/oxsteedCreditService');
const { transferCreatorCredit } = creditService;

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
        WHERE g.status = 'open' ORDER BY g.created_at DESC LIMIT $1`, [limit]
    );
    res.json({ gigs: rows });
  } catch (err) { next(err); }
}

async function createGig(req, res, next) {
  const client = await pool.connect();
  try {
    const actor = await verifiedActor(client, req.user.id, req.body?.ownerActorId || null);
    if (!actor) throw new AppError('A current verified Media business or restaurant actor is required.', 403, 'media_creator_unverified');
    const title = text(req.body?.title, 160, 'Title');
    const brief = text(req.body?.brief, 5000, 'Brief');
    const budget = asPositiveInt(req.body?.budgetCents);
    const maxApplications = Math.min(Math.max(Number(req.body?.maxApplications) || 25, 1), 100);
    const linkedPostId = req.body?.linkedPostId || null;
    await client.query('BEGIN');
    if (linkedPostId) {
      const { rows } = await client.query(
        `SELECT id FROM media_posts WHERE id = $1 AND actor_id = $2 AND visibility = 'public' AND processing_status = 'ready'`,
        [linkedPostId, actor.id]
      );
      if (!rows[0]) throw new AppError('The linked post is not owned by this verified actor.', 400, 'media_creator_post_invalid');
    }
    const { rows } = await client.query(
      `INSERT INTO media_creator_gigs
         (owner_user_id, owner_actor_id, linked_post_id, title, brief, budget_cents, max_applications)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, actor.id, linkedPostId, title, brief, budget, maxApplications]
    );
    await client.query('COMMIT');
    res.status(201).json({ gig: rows[0] });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}

async function applyToGig(req, res, next) {
  const client = await pool.connect();
  try {
    const actor = await verifiedActor(client, req.user.id, req.body?.actorId || null);
    if (!actor) throw new AppError('A current verified helper, business, or restaurant actor is required.', 403, 'media_creator_unverified');
    const pitch = text(req.body?.pitch, 3000, 'Pitch');
    const proposed = asPositiveInt(req.body?.proposedCents);
    const { rows: gigs } = await client.query(`SELECT * FROM media_creator_gigs WHERE id = $1 AND status = 'open' FOR UPDATE`, [req.params.gigId]);
    if (!gigs[0]) throw new AppError('Creator gig not found or closed.', 404, 'media_creator_gig_not_found');
    const { rows: count } = await client.query(`SELECT COUNT(*)::int AS count FROM media_creator_applications WHERE gig_id = $1`, [req.params.gigId]);
    if (count[0].count >= gigs[0].max_applications) throw new AppError('This gig is no longer accepting applications.', 409, 'media_creator_gig_full');
    const { rows } = await client.query(
      `INSERT INTO media_creator_applications
         (gig_id, applicant_user_id, applicant_actor_id, pitch, proposed_cents)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (gig_id, applicant_user_id) DO UPDATE SET pitch = EXCLUDED.pitch,
         proposed_cents = EXCLUDED.proposed_cents, status = 'submitted', updated_at = NOW()
       RETURNING *`, [req.params.gigId, req.user.id, actor.id, pitch, proposed]
    );
    res.status(201).json({ application: rows[0] });
  } catch (err) { next(err); }
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
    const { rows } = await client.query(
      `UPDATE media_creator_applications ap SET status = 'awarded', updated_at = NOW()
        FROM media_creator_gigs g
       WHERE ap.id = $1 AND ap.gig_id = g.id AND g.owner_user_id = $2 AND g.status = 'open'
       RETURNING ap.*, g.id AS gig_id`, [req.params.applicationId, req.user.id]
    );
    if (!rows[0]) throw new AppError('Application is not available to award.', 404, 'media_creator_application_not_found');
    await client.query(`UPDATE media_creator_gigs SET status = 'awarded', updated_at = NOW() WHERE id = $1`, [rows[0].gig_id]);
    await client.query(`UPDATE media_creator_applications SET status = 'rejected', updated_at = NOW() WHERE gig_id = $1 AND id <> $2 AND status IN ('submitted','shortlisted')`, [rows[0].gig_id, rows[0].id]);
    await client.query('COMMIT');
    res.json({ application: rows[0] });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}

async function submitDeliverable(req, res, next) {
  try {
    const { rows: posts } = await pool.query(
      `SELECT p.id FROM media_posts p JOIN media_creator_applications ap ON ap.applicant_actor_id = p.actor_id
        WHERE ap.id = $1 AND ap.applicant_user_id = $2 AND ap.status = 'awarded'
          AND p.id = $3 AND p.visibility = 'public' AND p.processing_status = 'ready'`,
      [req.params.applicationId, req.user.id, req.body?.postId]
    );
    if (!posts[0]) throw new AppError('Only a published post owned by the awarded creator can be submitted.', 403, 'media_creator_deliverable_invalid');
    const { rows } = await pool.query(
      `INSERT INTO media_creator_deliverables (application_id, post_id, note)
       VALUES ($1,$2,$3) ON CONFLICT (application_id, post_id) DO UPDATE SET note = EXCLUDED.note, status = 'submitted'
       RETURNING *`, [req.params.applicationId, req.body.postId, typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 2000) || null : null]
    );
    await pool.query(`UPDATE media_creator_applications SET status = 'delivered', updated_at = NOW() WHERE id = $1`, [req.params.applicationId]);
    res.status(201).json({ deliverable: rows[0] });
  } catch (err) { next(err); }
}

async function reviewDeliverable(req, res, next) {
  const status = req.body?.status === 'changes_requested' ? 'changes_requested' : req.body?.status === 'rejected' ? 'rejected' : 'approved';
  try {
    const { rows } = await pool.query(
      `UPDATE media_creator_deliverables d SET status = $2, reviewed_at = NOW()
        FROM media_creator_applications ap JOIN media_creator_gigs g ON g.id = ap.gig_id
       WHERE d.id = $1 AND d.application_id = ap.id AND g.owner_user_id = $3
       RETURNING d.*`, [req.params.deliverableId, status, req.user.id]
    );
    if (!rows[0]) throw new AppError('Deliverable not found.', 404, 'media_creator_deliverable_not_found');
    if (status === 'approved') await pool.query(`UPDATE media_creator_applications SET status = 'approved', updated_at = NOW() WHERE id = (SELECT application_id FROM media_creator_deliverables WHERE id = $1)`, [req.params.deliverableId]);
    res.json({ deliverable: rows[0] });
  } catch (err) { next(err); }
}

async function createTip(req, res, next) {
  const client = await pool.connect();
  try {
    const amount = asPositiveInt(req.body?.amountCents);
    const idempotencyKey = text(req.get('Idempotency-Key') || req.body?.idempotencyKey, 160, 'Idempotency-Key');
    const actor = await verifiedCreatorById(client, req.body?.actorId);
    if (!actor) throw new AppError('Creator actor is not currently verified.', 404, 'media_creator_actor_not_found');
    const { rows } = await client.query(
      `INSERT INTO media_creator_tips (from_user_id, creator_actor_id, post_id, amount_cents, idempotency_key)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (from_user_id, idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key RETURNING *`,
      [req.user.id, actor.id, req.body?.postId || null, amount, idempotencyKey]
    );
    res.status(202).json({ tip: rows[0], next: 'Credit transfer authorization is required before settlement.' });
  } catch (err) { next(err); }
  finally { client.release(); }
}

async function createSponsorship(req, res, next) {
  const client = await pool.connect();
  try {
    const amount = asPositiveInt(req.body?.amountCents);
    const brief = text(req.body?.brief, 3000, 'Brief');
    const actor = await verifiedCreatorById(client, req.body?.actorId);
    if (!actor) throw new AppError('Creator actor is not currently verified.', 404, 'media_creator_actor_not_found');
    const { rows } = await client.query(
      `INSERT INTO media_creator_sponsorships (sponsor_user_id, creator_actor_id, post_id, brief, amount_cents)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.user.id, actor.id, req.body?.postId || null, brief, amount]
    );
    res.status(202).json({ sponsorship: rows[0], next: 'Credit transfer authorization is required before settlement.' });
  } catch (err) { next(err); }
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
    const { rows: offerRows } = await client.query(
      `SELECT creator_actor_id FROM media_creator_sponsorships
        WHERE id = $1 AND status = 'pending_credit'`, [req.params.sponsorshipId]
    );
    if (!offerRows[0]) throw new AppError('Sponsorship offer is not available.', 404, 'media_creator_sponsorship_not_found');
    const actor = await verifiedCreatorById(client, offerRows[0].creator_actor_id);
    if (!actor || actor.owner_user_id !== req.user.id) throw new AppError('Creator verification is no longer active.', 409, 'media_creator_unverified');
    const { rows } = await pool.query(
      `UPDATE media_creator_sponsorships s SET status = 'accepted', updated_at = NOW()
        FROM media_actors a
       WHERE s.id = $1 AND s.creator_actor_id = a.id AND a.owner_user_id = $2
         AND s.status = 'pending_credit' RETURNING s.*`,
      [req.params.sponsorshipId, req.user.id]
    );
    if (!rows[0]) throw new AppError('Sponsorship offer is not available.', 404, 'media_creator_sponsorship_not_found');
    res.json({ sponsorship: rows[0] });
  } catch (err) { next(err); }
  finally { client.release(); }
}

async function settleSponsorship(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, a.owner_user_id AS creator_user_id
         FROM media_creator_sponsorships s JOIN media_actors a ON a.id = s.creator_actor_id
        WHERE s.id = $1 AND s.sponsor_user_id = $2 AND s.status = 'accepted'`,
      [req.params.sponsorshipId, req.user.id]
    );
    const sponsorship = rows[0];
    if (!sponsorship) throw new AppError('Sponsorship is not ready for settlement.', 409, 'media_creator_sponsorship_not_ready');
    const verificationClient = await pool.connect();
    try {
      const currentActor = await verifiedCreatorById(verificationClient, sponsorship.creator_actor_id);
      if (!currentActor) throw new AppError('Creator verification is no longer active.', 409, 'media_creator_unverified');
    } finally { verificationClient.release(); }
    const transfer = await transferCreatorCredit({
      senderCustomerId: req.user.id, recipientCustomerId: sponsorship.creator_user_id,
      amountCents: sponsorship.amount_cents, currencyCode: sponsorship.currency_code,
      idempotencyKey: `media-sponsorship:${sponsorship.id}`, actorUserId: req.user.id,
      referenceType: 'media_creator_sponsorship', referenceId: sponsorship.id,
      requestIp: req.ip || null, description: 'OxSteed Media creator sponsorship',
      metadata: { mediaSponsorshipId: sponsorship.id },
    });
    const { rows: updated } = await pool.query(
      `UPDATE media_creator_sponsorships SET status = 'completed', updated_at = NOW()
        WHERE id = $1 AND status = 'accepted' RETURNING *`, [sponsorship.id]
    );
    res.json({ sponsorship: updated[0] || sponsorship, transfer });
  } catch (err) { next(err); }
}

async function cancelSponsorship(req, res, next) {
  try {
    const { rows } = await pool.query(
      `UPDATE media_creator_sponsorships s SET status = 'cancelled', updated_at = NOW()
        FROM media_actors a
       WHERE s.id = $1
         AND (s.sponsor_user_id = $2 OR (a.id = s.creator_actor_id AND a.owner_user_id = $2))
         AND s.status IN ('pending_credit','accepted')
       RETURNING s.*`, [req.params.sponsorshipId, req.user.id]
    );
    if (!rows[0]) throw new AppError('Sponsorship cannot be cancelled.', 409, 'media_creator_sponsorship_cancel_invalid');
    res.json({ sponsorship: rows[0] });
  } catch (err) { next(err); }
}

async function createBoost(req, res, next) {
  try {
    const amount = asPositiveInt(req.body?.amountCents);
    const idempotencyKey = text(req.get('Idempotency-Key') || req.body?.idempotencyKey, 160, 'Idempotency-Key');
    const { rows: posts } = await pool.query(`SELECT id FROM media_posts WHERE id = $1 AND visibility = 'public' AND processing_status = 'ready'`, [req.params.postId]);
    if (!posts[0]) throw new AppError('Only a published, safety-cleared post can be boosted.', 409, 'media_boost_post_not_ready');
    const { rows } = await pool.query(
      `INSERT INTO media_post_boosts (post_id, purchaser_user_id, amount_cents, idempotency_key)
       VALUES ($1,$2,$3,$4) ON CONFLICT (purchaser_user_id, idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key RETURNING *`,
      [req.params.postId, req.user.id, amount, idempotencyKey]
    );
    res.status(202).json({ boost: rows[0], next: 'Boost activates only after a completed Credit settlement.' });
  } catch (err) { next(err); }
}

async function settleBoost(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM media_post_boosts WHERE id = $1 AND purchaser_user_id = $2 AND status = 'pending_credit'`,
      [req.params.boostId, req.user.id]
    );
    const boost = rows[0];
    if (!boost) throw new AppError('Boost is not ready for settlement.', 409, 'media_boost_not_ready');
    const { rows: ownerRows } = await pool.query(
      `SELECT a.owner_user_id FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
        WHERE p.id = $1 AND p.visibility = 'public' AND p.processing_status = 'ready'`, [boost.post_id]
    );
    if (!ownerRows[0]) throw new AppError('The boosted post is no longer available.', 409, 'media_boost_post_not_ready');
    const transfer = await transferCreatorCredit({
      senderCustomerId: req.user.id, recipientCustomerId: ownerRows[0].owner_user_id,
      amountCents: boost.amount_cents, currencyCode: boost.currency_code,
      idempotencyKey: `media-boost:${boost.id}`, actorUserId: req.user.id,
      referenceType: 'media_post_boost', referenceId: boost.id,
      requestIp: req.ip || null, description: 'OxSteed Media post boost',
      metadata: { mediaBoostId: boost.id, postId: boost.post_id },
    });
    const { rows: updated } = await pool.query(
      `UPDATE media_post_boosts SET status = 'scheduled', starts_at = NOW(), ends_at = NOW() + INTERVAL '24 hours'
        WHERE id = $1 RETURNING *`, [boost.id]
    );
    res.json({ boost: updated[0], transfer });
  } catch (err) { next(err); }
}

async function cancelBoost(req, res, next) {
  try {
    const { rows } = await pool.query(
      `UPDATE media_post_boosts SET status = 'cancelled'
        WHERE id = $1 AND purchaser_user_id = $2 AND status = 'pending_credit' RETURNING *`,
      [req.params.boostId, req.user.id]
    );
    if (!rows[0]) throw new AppError('Boost cannot be cancelled after settlement.', 409, 'media_boost_cancel_invalid');
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
                       AND tx.transaction_type = 'transfer'
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
                 AND tx.transaction_type = 'transfer'
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
  try {
    const { rows } = await pool.query(
      `SELECT t.*, a.owner_user_id AS creator_user_id
         FROM media_creator_tips t JOIN media_actors a ON a.id = t.creator_actor_id
        WHERE t.id = $1 AND t.from_user_id = $2`, [req.params.tipId, req.user.id]
    );
    const tip = rows[0];
    if (!tip) throw new AppError('Tip not found.', 404, 'media_creator_tip_not_found');
    if (tip.status === 'posted') return res.json({ tip });
    const verificationClient = await pool.connect();
    try {
      const currentActor = await verifiedCreatorById(verificationClient, tip.creator_actor_id);
      if (!currentActor) throw new AppError('Creator verification is no longer active.', 409, 'media_creator_unverified');
    } finally { verificationClient.release(); }
    const transfer = await transferCreatorCredit({
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
    const { rows: updated } = await pool.query(
      `UPDATE media_creator_tips SET status = 'posted', credit_transaction_id = $2 WHERE id = $1 RETURNING *`,
      [tip.id, transfer.transaction?.id || transfer.id || null]
    );
    res.json({ tip: updated[0], transfer });
  } catch (err) { next(err); }
}

module.exports = {
  listGigs, createGig, applyToGig, listApplications, listMyApplications, awardApplication,
  submitDeliverable, reviewDeliverable, createTip, createSponsorship, listSponsorships, createBoost,
  settleTip,
  acceptSponsorship, settleSponsorship, cancelSponsorship, settleBoost, cancelBoost,
  openCreatorDispute,
};
