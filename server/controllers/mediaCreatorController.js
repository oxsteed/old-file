'use strict';

const pool = require('../db');
const AppError = require('../utils/appError');
const { transferCreatorCredit } = require('../services/oxsteedCreditService');

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
        AND CASE
          WHEN a.actor_type = 'helper' THEN u.is_verified = TRUE
          WHEN a.actor_type = 'business' THEN EXISTS (
            SELECT 1 FROM businesses b WHERE b.user_id = a.owner_user_id
              AND (a.business_id IS NULL OR b.id = a.business_id)
              AND b.is_active = TRUE
              AND b.is_business_verified = TRUE AND b.deleted_at IS NULL)
          WHEN a.actor_type = 'restaurant' THEN EXISTS (
            SELECT 1 FROM food_restaurants r WHERE r.owner_user_id = a.owner_user_id
              AND (a.restaurant_id IS NULL OR r.id = a.restaurant_id)
              AND r.is_verified = TRUE AND r.status <> 'suspended')
          ELSE FALSE END`, params
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
      `SELECT ap.*, g.owner_user_id, a.handle AS applicant_handle, a.display_name AS applicant_name
         FROM media_creator_applications ap
         JOIN media_creator_gigs g ON g.id = ap.gig_id
         JOIN media_actors a ON a.id = ap.applicant_actor_id
        WHERE ap.gig_id = $1 AND (g.owner_user_id = $2 OR ap.applicant_user_id = $2)
        ORDER BY ap.created_at DESC`, [req.params.gigId, req.user.id]
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
  listGigs, createGig, applyToGig, listApplications, awardApplication,
  submitDeliverable, reviewDeliverable, createTip, createSponsorship, createBoost,
  settleTip,
};
