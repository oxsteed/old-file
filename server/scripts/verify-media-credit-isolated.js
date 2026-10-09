#!/usr/bin/env node
'use strict';

// Financial writes are deliberately confined to the seeded disposable compose
// database. Controllers and the shared Credit services run without mocks;
// this verifier proves SQL state/ledger behavior, not browser or middleware auth.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

function assertIsolated(env = process.env) {
  let database;
  try { database = new URL(env.DATABASE_URL); } catch { /* reject below */ }
  if (env.NODE_ENV !== 'test' || env.MEDIA_TEST_MODE !== 'true'
      || !/^oxsteed-credit-test-[a-z0-9-]+$/.test(env.CREDIT_TEST_PROJECT || '')
      || !database || !['postgres:', 'postgresql:'].includes(database.protocol)
      || database.hostname !== 'postgres' || database.pathname !== '/oxsteed_db'
      || database.username !== 'oxsteed' || (database.port && database.port !== '5432')
      || database.searchParams.get('sslmode') !== 'disable') {
    throw new Error('Media Credit verification requires the seeded disposable Media compose environment');
  }
}

async function invoke(controller, userId, body = {}, params = {}, idempotencyKey = randomUUID()) {
  let status = 200;
  let payload;
  let failure;
  const req = { user: { id: userId }, body, params, query: {}, ip: '127.0.0.1',
    get: name => name.toLowerCase() === 'idempotency-key' ? idempotencyKey : undefined };
  const res = { status(code) { status = code; return this; }, json(value) { payload = value; return this; } };
  await controller(req, res, error => { failure = error; });
  if (failure) throw failure;
  assert.notEqual(payload, undefined, 'controller must return a response');
  return { status, ...payload };
}

async function rejectsCode(operation, code) {
  await assert.rejects(operation, error => error.code === code,
    `operation must fail closed with ${code}`);
}

async function main() {
  assertIsolated(); // Must precede loading the pool or any financial service.
  const fixtures = require('./media-isolated-fixtures');
  const pool = require('../db');
  const credit = require('../services/oxsteedCreditService');
  const controller = require('../controllers/mediaCreatorController');
  const workAdmin = require('../controllers/mediaCreatorWorkAdminController');
  const disputeService = require('../services/oxsteedCreditDisputeService');
  const sanctions = require('../services/sanctionsScreeningService');
  const { admin, helper, business, customer, blocked } = fixtures.personas;
  const runId = `media-credit-${Date.now()}-${randomUUID()}`;
  const key = suffix => `${runId}:${suffix}`;
  const checks = [];
  const postIds = [];
  let frozen = false;
  const call = (name, user, body, params, idempotencyKey) => invoke(controller[name], user, body, params, idempotencyKey);
  const row = async (sql, params = []) => (await pool.query(sql, params)).rows[0];
  const amounts = async user => {
    const account = await row(`SELECT balance_cents, reserved_cents FROM oxsteed_credit_accounts
      WHERE account_type='customer_wallet' AND customer_id=$1 AND currency_code='USD'`, [user]);
    return { balance: Number(account?.balance_cents || 0), reserved: Number(account?.reserved_cents || 0) };
  };
  async function publicPost(actorId) {
    const result = await row(`INSERT INTO media_posts (actor_id,body,visibility,processing_status,csam_status)
      VALUES ($1,$2,'public','ready','passed') RETURNING id`, [actorId, `${runId} synthetic deliverable`]);
    postIds.push(result.id);
    return result.id;
  }
  async function gig(amount, suffix) {
    const created = await call('createGig', business,
      { title: `Synthetic ${suffix}`, brief: 'Isolated creator accounting verification', budgetCents: amount }, {}, key(suffix));
    const applied = await call('applyToGig', helper,
      { pitch: 'Synthetic creator application', proposedCents: amount }, { gigId: created.gig.id });
    return { gig: created.gig, application: applied.application };
  }
  async function sponsorship(amount, suffix) {
    const created = await call('createSponsorship', customer,
      { actorId: helperActor.id, amountCents: amount, brief: `Synthetic ${suffix}` }, {}, key(suffix));
    await call('acceptSponsorship', helper, {}, { sponsorshipId: created.sponsorship.id });
    return created.sponsorship;
  }
  let helperActor;
  try {
    await fixtures.seed(pool);
    const fixtureUsers = await row(`SELECT COUNT(*)::int AS count FROM users
      WHERE id=ANY($1::uuid[]) AND email LIKE '%@example.test'`, [[admin, helper, business, customer, blocked]]);
    assert.equal(fixtureUsers.count, 5, 'all financial actors must be synthetic seeded identities');
    const initialTotals = (await pool.query(`SELECT currency_code,SUM(balance_cents)::text AS total
      FROM oxsteed_credit_accounts GROUP BY currency_code ORDER BY currency_code`)).rows;
    const restaurantWallets = (await pool.query(`SELECT id,balance_cents,reserved_cents FROM food_customer_wallet_accounts ORDER BY id`)).rows;
    const entriesBefore = await row(`SELECT COALESCE(MAX(id),0)::text AS max_id,
      md5(COALESCE(string_agg(row_to_json(e)::text,'|' ORDER BY id),'')) AS digest
      FROM oxsteed_credit_transaction_entries e`);
    helperActor = await row(`SELECT id FROM media_actors WHERE owner_user_id=$1 AND actor_type='helper'`, [helper]);
    assert(helperActor, 'synthetic helper must have an actor');
    const postId = await publicPost(helperActor.id);

    // The isolated image deliberately has no paid screening provider. Obtain
    // fresh persisted manual-review hits and record synthetic admin clearance
    // through the real audited service, as the base Credit fixture does.
    for (const subjectId of [customer, business, helper]) {
      const screening = await sanctions.screenSubjectIfStale(pool, { subjectType: 'customer', subjectId });
      if (screening.result === 'hit' && !screening.cleared_at) {
        await rejectsCode(() => sanctions.assertSanctionsClear(pool, { subjectType: 'customer', subjectId }), 'credit_sanctions_match');
        await sanctions.decideSanctionsScreening({ screeningId: screening.id, decision: 'clear', actorUserId: admin,
          reason: 'Synthetic disposable Media accounting screening review' });
      }
      await sanctions.assertSanctionsClear(pool, { subjectType: 'customer', subjectId });
    }
    checks.push('persisted-sanctions-review-before-financial-activity');

    await credit.setCreditRailStatus({ enabled: true, actorUserId: admin, reason: 'Synthetic Media accounting verification only' });
    await credit.loadCustomerCredit({ customerId: customer, amountCents: 10000, currencyCode: 'USD',
      idempotencyKey: key('load'), actorUserId: admin, reason: 'Synthetic Media funding',
      referenceType: 'isolated_media_funding', referenceId: key('load-reference') });
    await credit.settleCreatorCredit({ senderCustomerId: customer, recipientCustomerId: business,
      amountCents: 3000, currencyCode: 'USD', idempotencyKey: key('business-funding'), actorUserId: customer,
      referenceType: 'isolated_media_funding', referenceId: key('business-reference') });

    // Award/replay must reserve once. Revisions retain the reservation until
    // approval, whose concurrent retries must all resolve to one settlement.
    const beforeGig = await amounts(business);
    const paidGig = await gig(400, 'paid-gig');
    const awarded = await call('awardApplication', business, {}, { applicationId: paidGig.application.id });
    await call('awardApplication', business, {}, { applicationId: paidGig.application.id });
    await call('acceptApplication', helper, {}, { applicationId: paidGig.application.id });
    assert((await call('acceptApplication', helper, {}, { applicationId: paidGig.application.id })).replayed);
    assert.deepEqual(await amounts(business), { balance: beforeGig.balance, reserved: beforeGig.reserved + 400 });
    let submitted = await call('submitDeliverable', helper, { postId }, { applicationId: paidGig.application.id });
    await call('reviewDeliverable', business, { status: 'changes_requested' }, { deliverableId: submitted.deliverable.id });
    assert.equal((await amounts(business)).reserved, beforeGig.reserved + 400);
    submitted = await call('submitDeliverable', helper, { postId, note: 'Requested revision' }, { applicationId: paidGig.application.id });
    // Seeded text-only posts simulate a later safety removal. These SQL
    // transitions test settlement authorization, not scanner clearance.
    await pool.query(`UPDATE media_posts SET visibility='removed' WHERE id=$1`, [postId]);
    await rejectsCode(() => call('reviewDeliverable', business, { status: 'approved' },
      { deliverableId: submitted.deliverable.id }), 'media_creator_deliverable_invalid');
    assert.equal((await amounts(business)).reserved, beforeGig.reserved + 400, 'failed approval must retain funds');
    await pool.query(`UPDATE media_posts SET visibility='public' WHERE id=$1`, [postId]);
    const approvals = await Promise.all([
      call('reviewDeliverable', business, { status: 'approved' }, { deliverableId: submitted.deliverable.id }),
      call('reviewDeliverable', business, { status: 'approved' }, { deliverableId: submitted.deliverable.id }),
    ]);
    assert(approvals.some(result => result.replayed), 'concurrent approval must recover a posted settlement');
    assert.deepEqual(await amounts(business), { balance: beforeGig.balance - 400, reserved: beforeGig.reserved });
    assert.equal((await row(`SELECT COUNT(*)::int AS count FROM oxsteed_credit_transactions
      WHERE reference_type='media_creator_gig' AND reference_id=$1`, [paidGig.gig.id])).count, 1);
    assert.equal((await row(`SELECT status FROM oxsteed_credit_reservations WHERE id=$1`, [awarded.reservation.id])).status, 'released');
    checks.push('gig-reserve-revision-concurrent-approval-single-settlement');

    const cancelledGig = await gig(150, 'cancelled-gig');
    await call('awardApplication', business, {}, { applicationId: cancelledGig.application.id });
    await Promise.all([call('cancelGig', business, {}, { gigId: cancelledGig.gig.id }),
      call('cancelGig', business, {}, { gigId: cancelledGig.gig.id })]);
    assert.equal((await amounts(business)).reserved, beforeGig.reserved);
    assert.equal((await row(`SELECT COUNT(*)::int AS count FROM oxsteed_credit_transactions
      WHERE reference_type='media_creator_gig' AND reference_id=$1`, [cancelledGig.gig.id])).count, 0);
    checks.push('gig-concurrent-cancellation-single-release');

    const beforeSponsor = await amounts(customer);
    const paidSponsor = await sponsorship(300, 'paid-sponsorship');
    assert.deepEqual(await amounts(customer), { balance: beforeSponsor.balance, reserved: beforeSponsor.reserved + 300 });
    await rejectsCode(() => call('settleSponsorship', customer, {}, { sponsorshipId: paidSponsor.id }),
      'media_creator_sponsorship_deliverable_required');
    await call('submitSponsorshipDeliverable', helper, { postId }, { sponsorshipId: paidSponsor.id });
    await call('requestSponsorshipChanges', customer, { reason: 'Synthetic revision request' }, { sponsorshipId: paidSponsor.id });
    assert.equal((await amounts(customer)).reserved, beforeSponsor.reserved + 300);
    await call('submitSponsorshipDeliverable', helper, { postId, note: 'Requested sponsorship revision' }, { sponsorshipId: paidSponsor.id });
    await pool.query(`UPDATE media_posts SET visibility='removed' WHERE id=$1`, [postId]);
    await rejectsCode(() => call('settleSponsorship', customer, {}, { sponsorshipId: paidSponsor.id }),
      'media_creator_sponsorship_deliverable_invalid');
    assert.equal((await amounts(customer)).reserved, beforeSponsor.reserved + 300);
    await pool.query(`UPDATE media_posts SET visibility='public' WHERE id=$1`, [postId]);
    await Promise.all([call('settleSponsorship', customer, {}, { sponsorshipId: paidSponsor.id }),
      call('settleSponsorship', customer, {}, { sponsorshipId: paidSponsor.id })]);
    assert.deepEqual(await amounts(customer), { balance: beforeSponsor.balance - 300, reserved: beforeSponsor.reserved });
    assert.equal((await row(`SELECT COUNT(*)::int AS count FROM oxsteed_credit_transactions
      WHERE reference_type='media_creator_sponsorship' AND reference_id=$1`, [paidSponsor.id])).count, 1);
    const cancelledSponsor = await sponsorship(120, 'cancelled-sponsorship');
    await Promise.all([call('cancelSponsorship', customer, {}, { sponsorshipId: cancelledSponsor.id }),
      call('cancelSponsorship', helper, {}, { sponsorshipId: cancelledSponsor.id })]);
    assert.equal((await amounts(customer)).reserved, beforeSponsor.reserved);
    const tooLarge = await call('createSponsorship', customer,
      { actorId: helperActor.id, amountCents: (await amounts(customer)).balance + 1, brief: 'Insufficient funds' }, {}, key('insufficient'));
    await rejectsCode(() => call('acceptSponsorship', helper, {}, { sponsorshipId: tooLarge.sponsorship.id }), 'credit_insufficient_funds');
    assert.equal((await amounts(customer)).reserved, beforeSponsor.reserved, 'failed reserve must roll back');
    const suspendedOffer = await call('createSponsorship', customer,
      { actorId: helperActor.id, amountCents: 30, brief: 'Suspended wallet denial' }, {}, key('suspended-wallet'));
    await credit.updateCustomerCreditAccountStatus({ customerId: customer, status: 'suspended', currencyCode: 'USD',
      actorUserId: admin, reason: 'Synthetic wallet suspension' });
    try {
      await rejectsCode(() => call('acceptSponsorship', helper, {}, { sponsorshipId: suspendedOffer.sponsorship.id }), 'credit_account_inactive');
      assert.equal((await amounts(customer)).reserved, beforeSponsor.reserved);
    } finally {
      await credit.updateCustomerCreditAccountStatus({ customerId: customer, status: 'active', currencyCode: 'USD',
        actorUserId: admin, reason: 'Synthetic wallet suspension recovery' });
    }
    checks.push('sponsorship-reserve-revisions-safety-recheck-settle-cancel-insufficient-suspended-funds');

    // Delivered work cannot be unilaterally cancelled into a free payout
    // release. An audited administrator resolves the contest; resume keeps
    // funds reserved and requires fresh creator submission and buyer review.
    const heldBeforeContest = await amounts(customer);
    const contestedSponsor = await sponsorship(60, 'contested-sponsorship');
    await call('submitSponsorshipDeliverable', helper, { postId }, { sponsorshipId: contestedSponsor.id });
    const contest = await call('cancelSponsorship', customer, { reason: 'Synthetic delivered-work contest' }, { sponsorshipId: contestedSponsor.id });
    assert.equal(contest.status, 202);
    assert.equal(contest.workReview.status, 'open');
    assert.equal((await amounts(customer)).reserved, heldBeforeContest.reserved + 60);
    await rejectsCode(() => call('settleSponsorship', customer, {}, { sponsorshipId: contestedSponsor.id }),
      'media_creator_work_review_pending');
    const releaseDecision = { decision: 'release', reason: 'Synthetic audited cancellation release' };
    await invoke(workAdmin.resolveWorkReview, admin, releaseDecision, { reviewId: contest.workReview.id });
    assert((await invoke(workAdmin.resolveWorkReview, admin, releaseDecision, { reviewId: contest.workReview.id })).replayed);
    await rejectsCode(() => invoke(workAdmin.resolveWorkReview, admin,
      { decision: 'resume', reason: releaseDecision.reason }, { reviewId: contest.workReview.id }), 'media_creator_work_review_conflict');
    assert.equal((await amounts(customer)).reserved, heldBeforeContest.reserved);
    assert.equal((await row(`SELECT COUNT(*)::int AS count FROM admin_audit_log
      WHERE target_id=$1 AND action='media_creator_work_released' AND admin_id=$2`, [contest.workReview.id, admin])).count, 1);

    const heldBeforeGigContest = await amounts(business);
    const contestedGig = await gig(70, 'contested-gig');
    await call('awardApplication', business, {}, { applicationId: contestedGig.application.id });
    await call('acceptApplication', helper, {}, { applicationId: contestedGig.application.id });
    const contestDelivery = await call('submitDeliverable', helper, { postId }, { applicationId: contestedGig.application.id });
    const gigContest = await call('reviewDeliverable', business,
      { status: 'rejected', reason: 'Synthetic disputed deliverable quality' }, { deliverableId: contestDelivery.deliverable.id });
    assert.equal(gigContest.status, 202);
    assert.equal((await amounts(business)).reserved, heldBeforeGigContest.reserved + 70);
    const resumeDecision = { decision: 'resume', reason: 'Synthetic admin authorized revision' };
    await invoke(workAdmin.resolveWorkReview, admin, resumeDecision, { reviewId: gigContest.workReview.id });
    assert.equal((await amounts(business)).reserved, heldBeforeGigContest.reserved + 70);
    const resumedDelivery = await call('submitDeliverable', helper, { postId, note: 'Admin-authorized revised work' },
      { applicationId: contestedGig.application.id });
    await call('reviewDeliverable', business, { status: 'approved' }, { deliverableId: resumedDelivery.deliverable.id });
    assert.deepEqual(await amounts(business), { balance: heldBeforeGigContest.balance - 70, reserved: heldBeforeGigContest.reserved });
    assert.equal((await row(`SELECT COUNT(*)::int AS count FROM admin_audit_log
      WHERE target_id=$1 AND action='media_creator_work_resumed' AND admin_id=$2`, [gigContest.workReview.id, admin])).count, 1);
    checks.push('contested-work-preserves-reservations-admin-release-resume-audit-replay');

    const tipBody = { actorId: helperActor.id, amountCents: 125 };
    const tip = await call('createTip', customer, tipBody, {}, key('tip'));
    assert((await call('createTip', customer, tipBody, {}, key('tip'))).replayed);
    await rejectsCode(() => call('createTip', customer, { ...tipBody, amountCents: 126 }, {}, key('tip')),
      'media_creator_idempotency_conflict');
    await rejectsCode(() => call('createTip', customer, { ...tipBody, currencyCode: 'JPY' }, {}, key('tip')),
      'media_creator_idempotency_conflict');
    await rejectsCode(() => call('createTip', blocked, tipBody, {}, key('blocked-tip')), 'media_creator_actor_not_found');
    const tipPayerBefore = await amounts(customer);
    const tipCreatorBefore = await amounts(helper);
    const tipPayments = await Promise.all([call('settleTip', customer, {}, { tipId: tip.tip.id }),
      call('settleTip', customer, {}, { tipId: tip.tip.id })]);
    assert(tipPayments.some(result => result.replayed));
    assert.deepEqual(await amounts(customer), { balance: tipPayerBefore.balance - 125, reserved: tipPayerBefore.reserved });
    assert.deepEqual(await amounts(helper), { balance: tipCreatorBefore.balance + 125, reserved: tipCreatorBefore.reserved });
    const tipRow = await row(`SELECT credit_transaction_id FROM media_creator_tips WHERE id=$1`, [tip.tip.id]);
    assert.equal((await row(`SELECT COUNT(*)::int AS count FROM oxsteed_credit_transactions
      WHERE reference_type='media_creator_tip' AND reference_id=$1`, [tip.tip.id])).count, 1);
    checks.push('tip-replay-payload-conflict-block-concurrent-single-payment');

    const creatorBalance = (await amounts(helper)).balance;
    const boostPayerBefore = await amounts(customer);
    const revenueBefore = Number((await row(`SELECT balance_cents FROM oxsteed_credit_accounts
      WHERE account_type='platform_revenue' AND currency_code='USD'`))?.balance_cents || 0);
    const boost = await call('createBoost', customer, { amountCents: 200 }, { postId }, key('boost'));
    await Promise.all([call('settleBoost', customer, {}, { boostId: boost.boost.id }),
      call('settleBoost', customer, {}, { boostId: boost.boost.id })]);
    const boostRow = await row(`SELECT b.*,a.account_type AS recipient_type,tx.amount_cents AS charged
      FROM media_post_boosts b JOIN oxsteed_credit_transactions tx ON tx.id=b.credit_transaction_id
      JOIN oxsteed_credit_accounts a ON a.id=tx.credit_account_id WHERE b.id=$1`, [boost.boost.id]);
    assert.equal(boostRow.status, 'active');
    assert.equal(boostRow.recipient_type, 'platform_revenue');
    assert.equal(Number(boostRow.charged), 200);
    assert.equal(new Date(boostRow.ends_at) - new Date(boostRow.starts_at), 24 * 60 * 60 * 1000);
    assert.equal((await amounts(helper)).balance, creatorBalance, 'boost cannot pay the creator');
    assert.deepEqual(await amounts(customer), { balance: boostPayerBefore.balance - 200, reserved: boostPayerBefore.reserved });
    assert.equal(Number((await row(`SELECT balance_cents FROM oxsteed_credit_accounts
      WHERE account_type='platform_revenue' AND currency_code='USD'`)).balance_cents), revenueBefore + 200);
    await rejectsCode(() => call('cancelBoost', customer, {}, { boostId: boost.boost.id }), 'media_boost_cancel_invalid');
    const raceBoost = await call('createBoost', customer, { amountCents: 80 }, { postId }, key('race-boost'));
    const race = await Promise.allSettled([call('settleBoost', customer, {}, { boostId: raceBoost.boost.id }),
      call('cancelBoost', customer, {}, { boostId: raceBoost.boost.id })]);
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1, 'settle/cancel race must have one winner');
    const raceRow = await row(`SELECT status,credit_transaction_id FROM media_post_boosts WHERE id=$1`, [raceBoost.boost.id]);
    assert.equal(Boolean(raceRow.credit_transaction_id), raceRow.status === 'active');
    checks.push('boost-platform-revenue-24h-replay-settle-cancel-race');

    const frozenTip = await call('createTip', customer, { actorId: helperActor.id, amountCents: 40 }, {}, key('frozen-tip'));
    await credit.freezeCreditRail({ actorUserId: admin, reason: 'Synthetic Media freeze test' });
    frozen = true;
    await rejectsCode(() => call('settleTip', customer, {}, { tipId: frozenTip.tip.id }), 'credit_rail_frozen');
    assert((await call('settleTip', customer, {}, { tipId: tip.tip.id })).replayed, 'lost response must recover while frozen');
    await credit.unfreezeCreditRail({ actorUserId: admin, reason: 'Synthetic Media freeze recovery' });
    frozen = false;
    await call('settleTip', customer, {}, { tipId: frozenTip.tip.id });
    checks.push('freeze-denial-and-posted-response-recovery');

    for (const [currencyCode, amountCents] of [['JPY', 1], ['KWD', 1001]]) {
      await credit.loadCustomerCredit({ customerId: customer, amountCents: amountCents + 20, currencyCode,
        idempotencyKey: key(`load-${currencyCode}`), actorUserId: admin, reason: 'Synthetic currency boundary funding',
        referenceType: 'isolated_media_funding', referenceId: key(`currency-${currencyCode}`) });
      const input = { senderCustomerId: customer, recipientCustomerId: helper, amountCents, currencyCode,
        idempotencyKey: key(`currency-settle-${currencyCode}`), actorUserId: customer,
        referenceType: 'isolated_media_currency', referenceId: key(`settlement-${currencyCode}`) };
      await credit.settleCreatorCredit(input);
      assert((await credit.settleCreatorCredit(input)).replayed);
      await rejectsCode(() => credit.settleCreatorCredit({ ...input, amountCents: amountCents + 1 }), 'credit_idempotency_conflict');
      const currencyRow = await row(`SELECT amount_cents,currency_code FROM oxsteed_credit_transactions WHERE idempotency_key=$1`, [input.idempotencyKey]);
      assert.equal(Number(currencyRow.amount_cents), amountCents);
      assert.equal(currencyRow.currency_code, currencyCode);
      assert.equal(credit.formatCreditAmount(amountCents, currencyCode), currencyCode === 'JPY' ? 1 : 1.001);
    }
    await assert.rejects(() => credit.settleCreatorCredit({ senderCustomerId: customer, recipientCustomerId: helper,
      amountCents: 1.5, currencyCode: 'USD', idempotencyKey: key('fraction'), actorUserId: customer,
      referenceType: 'isolated_media_currency', referenceId: key('fraction') }));
    checks.push('jpy-and-kwd-integer-minor-units-fraction-denial');

    // A settlement dispute uses the existing audited compensation rail. This
    // is an explicit administrative adjustment, not a fabricated purchase refund.
    const dispute = await call('openCreatorDispute', customer,
      { description: 'Synthetic settled tip dispute', reasonCode: 'incorrect_amount' }, { kind: 'tip', id: tip.tip.id }, key('dispute'));
    const disputeId = dispute.dispute.id;
    const resolution = { disputeId, adminId: admin, reason: 'Synthetic admin compensation decision' };
    await disputeService.resolveDisputeWithCompensation({ ...resolution, decision: 'in_review' });
    const compensated = await disputeService.resolveDisputeWithCompensation({ ...resolution, decision: 'resolved_customer', compensationCents: 100 });
    assert.equal(compensated.compensation.amountCents, 100);
    assert((await disputeService.resolveDisputeWithCompensation({ ...resolution, decision: 'resolved_customer', compensationCents: 100 })).replayed);
    assert.equal((await row(`SELECT COUNT(*)::int AS count FROM oxsteed_credit_transactions
      WHERE idempotency_key=$1`, [`credit-dispute-compensation:${disputeId}`])).count, 1);
    assert.equal((await row(`SELECT COUNT(*)::int AS count FROM oxsteed_credit_audit_events
      WHERE resource_type='credit_dispute' AND resource_id=$1 AND actor_user_id=$2
        AND action_type='credit.dispute.status_changed'`, [String(disputeId), admin])).count, 2);
    const unchangedTip = await row(`SELECT amount_cents FROM oxsteed_credit_transactions WHERE id=$1`, [tipRow.credit_transaction_id]);
    assert.equal(Number(unchangedTip.amount_cents), 125);
    checks.push('audited-dispute-compensation-single-posting-original-ledger-preserved');

    const businessBeforeCompensation = await amounts(business);
    const gigDispute = await call('openCreatorDispute', business,
      { description: 'Synthetic business-payer gig dispute', reasonCode: 'incorrect_amount' },
      { kind: 'gig', id: paidGig.gig.id }, key('gig-dispute'));
    await rejectsCode(() => call('openCreatorDispute', helper,
      { description: 'Recipient cannot dispute the payer payment', reasonCode: 'incorrect_amount' },
      { kind: 'gig', id: paidGig.gig.id }, key('recipient-gig-dispute')), 'media_creator_dispute_payment_not_found');
    const gigDisputeId = gigDispute.dispute.id;
    const gigResolution = { disputeId: gigDisputeId, adminId: admin, reason: 'Synthetic business-payer compensation' };
    await disputeService.resolveDisputeWithCompensation({ ...gigResolution, decision: 'in_review' });
    await disputeService.resolveDisputeWithCompensation({ ...gigResolution, decision: 'resolved_customer', compensationCents: 40 });
    assert.deepEqual(await amounts(business), { balance: businessBeforeCompensation.balance + 40, reserved: businessBeforeCompensation.reserved });
    assert((await disputeService.resolveDisputeWithCompensation({ ...gigResolution, decision: 'resolved_customer', compensationCents: 40 })).replayed);
    const unrelated = await credit.settleCreatorCredit({ senderCustomerId: business, recipientCustomerId: helper,
      amountCents: 1, currencyCode: 'USD', actorUserId: business, idempotencyKey: key('non-marketplace'),
      referenceType: 'isolated_unrelated_transfer', referenceId: key('unrelated') });
    await rejectsCode(() => credit.openCreditDispute({ customerId: business, actorUserId: business,
      transactionId: unrelated.transaction.id, reasonCode: 'incorrect_amount', description: 'Scope must reject unrelated transfer',
      idempotencyKey: key('unrelated-dispute'), allowMediaCreatorOwner: true }), 'credit_transaction_not_found');
    checks.push('business-payer-gig-dispute-compensation-recipient-nonmedia-denial');

    const finalTotals = (await pool.query(`SELECT currency_code,SUM(balance_cents)::text AS total
      FROM oxsteed_credit_accounts GROUP BY currency_code ORDER BY currency_code`)).rows;
    const initialByCurrency = new Map(initialTotals.map(item => [item.currency_code, BigInt(item.total)]));
    for (const item of finalTotals) assert.equal(BigInt(item.total), initialByCurrency.get(item.currency_code) || 0n,
      `all-account ${item.currency_code} balance conservation must include treasury and platform revenue`);
    assert.deepEqual((await pool.query(`SELECT id,balance_cents,reserved_cents FROM food_customer_wallet_accounts ORDER BY id`)).rows,
      restaurantWallets, 'Media must not mutate restaurant-scoped wallet balances or holds');
    const entriesAfter = await row(`SELECT md5(COALESCE(string_agg(row_to_json(e)::text,'|' ORDER BY id),'')) AS digest
      FROM oxsteed_credit_transaction_entries e WHERE id <= $1`, [entriesBefore.max_id]);
    assert.equal(entriesAfter.digest, entriesBefore.digest, 'pre-existing ledger entries must remain unchanged');
    const brokenEntries = await row(`SELECT COUNT(*)::int AS count FROM (
      SELECT tx.id FROM oxsteed_credit_transactions tx
      LEFT JOIN oxsteed_credit_transaction_entries e ON e.transaction_id=tx.id
      WHERE tx.idempotency_key LIKE $1 OR tx.idempotency_key=ANY($2::text[])
        OR tx.reference_id=ANY($3::text[])
      GROUP BY tx.id HAVING COUNT(e.id)<>2
        OR SUM(CASE WHEN e.entry_side='credit' THEN e.amount_cents ELSE -e.amount_cents END)<>0
    ) invalid`, [`${runId}%`, [disputeId, gigDisputeId].map(id => `credit-dispute-compensation:${id}`),
      [paidGig.gig.id, contestedGig.gig.id, paidSponsor.id, tip.tip.id, frozenTip.tip.id, boost.boost.id, raceBoost.boost.id]]);
    assert.equal(brokenEntries.count, 0, 'each financial transition requires exactly two balanced ledger entries');
    const inconsistentReserved = await row(`SELECT COUNT(*)::int AS count FROM oxsteed_credit_accounts a
      WHERE a.reserved_cents <> COALESCE((SELECT SUM(h.amount_cents) FROM oxsteed_credit_holds h
        WHERE h.account_id=a.id AND h.status='active'),0)
        + COALESCE((SELECT SUM(r.amount_cents) FROM oxsteed_credit_reservations r
          WHERE r.account_id=a.id AND r.status='active'),0)`);
    assert.equal(inconsistentReserved.count, 0, 'reserved totals must equal active holds plus reservations');
    checks.push('global-conservation-double-entry-append-only-restaurant-isolation-reservation-reconciliation');
    console.log(JSON.stringify({ ok: true, isolated: true, workflows: checks, realDatabase: true,
      middlewareAuthenticationVerified: false, totals: finalTotals }, null, 2));
  } finally {
    if (frozen) await credit.unfreezeCreditRail({ actorUserId: admin, reason: 'Synthetic verifier cleanup' }).catch(() => {});
    await credit.setCreditRailStatus({ enabled: false, actorUserId: admin, reason: 'Synthetic Media verifier cleanup' }).catch(() => {});
    // Preserve synthetic marketplace and journal rows for failure investigation.
    // Do not delete financial evidence or attempt to undo it with SQL.
    if (postIds.length) await pool.query(`UPDATE media_posts SET deleted_at=NOW() WHERE id=ANY($1::uuid[])`, [postIds]).catch(() => {});
    await pool.end();
  }
}

if (require.main === module) main().catch(error => {
  console.error(`Isolated Media Credit verification failed: ${error.message} (${error.code || 'no_code'})`);
  process.exitCode = 1;
});

module.exports = { assertIsolated, invoke, rejectsCode, main };
