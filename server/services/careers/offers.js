'use strict';

// Offers (careers spec §4.4 step 5–6, §6.7, C-02, C-03, Q17).
// Only the candidate can accept. A conditional offer (background check)
// can be accepted, but the hire is final only once the check is clear.

const { AppError } = require('../../middleware/errorHandler');
const { COMPENSATION_PERIODS, TEAM_ROLES } = require('../careerCatalog');
const { FieldErrors, text, money } = require('./validation');
const { assertCanHireRole, assertLocationsInScope } = require('./access');
const { assertAdult, isIdentityVerified } = require('./ageGate');
const { hourlyEquivalent } = require('./matching');
const { recordEvent } = require('./applications');
const { stampDecision } = require('./retention');
const { notifyApplicant, notifyHiringTeam, notifyUser } = require('./notify');

const DEFAULT_EXPIRY_DAYS = 5;
const MAX_EXPIRY_DAYS = 30;
const OFFERABLE_STAGES = Object.freeze(['received', 'screening', 'interview', 'assessment', 'offer']);

function formatPay(cents, period, currency, locale = 'en') {
  const amount = Number(cents) / 100;
  let s;
  try { s = new Intl.NumberFormat(locale, { style: 'currency', currency: currency || 'USD' }).format(amount); } catch { s = `${amount.toFixed(2)} ${currency || ''}`.trim(); }
  return `${s} / ${period}`;
}

function parseStartDate(value, errors) {
  if (value === undefined || value === null || value === '') { errors.add('start_date', 'Pick a start date'); return null; }
  const v = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) { errors.add('start_date', 'Enter a valid date'); return null; }
  // Allow "today" anywhere on earth (UTC-12).
  const earliest = new Date(Date.now() - 12 * 3600_000).toISOString().slice(0, 10);
  if (v < earliest) { errors.add('start_date', 'Pick a start date in the future'); return null; }
  return v;
}

function parseFirstShift(raw, errors, locationId) {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'object') { errors.add('first_shift', 'Invalid first shift'); return null; }
  const date = String(raw.date || '');
  const start = String(raw.start || '');
  const end = String(raw.end || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) errors.add('first_shift.date', 'Pick a date');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) errors.add('first_shift.start', 'Use HH:MM');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) errors.add('first_shift.end', 'Use HH:MM');
  if (start && end && start === end) errors.add('first_shift.end', 'End must differ from start');
  return { date, start, end, location_id: locationId || null };
}

/**
 * Validate offer terms against the opening (§4.4 step 5). Returns the
 * values and whether the pay is above the posted range.
 */
function parseOffer(body, app, { settings = null } = {}) {
  const errors = new FieldErrors();
  const payPeriod = body.pay_period || app.opening_period;
  if (!COMPENSATION_PERIODS.includes(payPeriod)) errors.add('pay_period', 'Choose a pay period');
  const pay = money(body.pay, 'pay', errors);
  if (pay === null) errors.add('pay', 'Pay is required');
  const payCents = pay == null || pay === undefined ? null : Math.round(pay * 100);
  const openingStores = (app.opening_location_ids || []).map(Number);
  let locationId = body.location_id == null || body.location_id === '' ? null : Number(body.location_id);
  if (locationId != null && !Number.isInteger(locationId)) errors.add('location_id', 'Pick a store');
  if (openingStores.length) {
    if (locationId == null && openingStores.length === 1) locationId = openingStores[0];
    if (locationId == null) errors.add('location_id', 'Pick the store this offer is for');
    else if (!openingStores.includes(locationId)) errors.add('location_id', 'Pick a store listed on this opening');
  }
  const teamRole = app.employer_type === 'business' ? (body.team_role || app.opening_team_role || 'employee') : null;
  if (teamRole && !TEAM_ROLES.includes(teamRole)) errors.add('team_role', 'Unsupported role');
  const startDate = parseStartDate(body.start_date, errors);
  const days = body.expires_in_days == null || body.expires_in_days === '' ? DEFAULT_EXPIRY_DAYS : Number(body.expires_in_days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) errors.add('expires_in_days', `Between 1 and ${MAX_EXPIRY_DAYS} days`);
  const firstShift = parseFirstShift(body.first_shift, errors, locationId);
  if (firstShift && startDate && firstShift.date < startDate) errors.add('first_shift.date', 'The first shift can\'t be before the start date');

  // Pay range check in the opening's own period (or an hourly equivalent).
  const min = app.compensation_min == null ? null : Number(app.compensation_min);
  const max = app.compensation_max == null ? null : Number(app.compensation_max);
  let aboveRange = false;
  if (pay != null && (min != null || max != null)) {
    const same = payPeriod === app.opening_period;
    const offerValue = same ? pay : hourlyEquivalent(pay, payPeriod);
    const lo = min == null ? null : (same ? min : hourlyEquivalent(min, app.opening_period));
    const hi = max == null ? null : (same ? max : hourlyEquivalent(max, app.opening_period));
    if (lo != null && offerValue != null && offerValue + 1e-9 < lo) errors.add('pay', 'Pay must be inside the posted range');
    if (hi != null && offerValue != null && offerValue > hi + 1e-9) aboveRange = true;
  }
  const outsideReason = text(body.outside_posted_range_reason, 300) || null;
  if (aboveRange && !outsideReason) errors.add('outside_posted_range_reason', 'Say why this offer is above the posted range');

  const conditions = ['identity_verified'];
  const wantsCheck = Boolean(app.background_check_required && settings?.background_checks_enabled);
  if (wantsCheck) conditions.push('background_check');
  if ((app.required_credentials || []).length) conditions.push('documents');
  if (app.opening_employer_model === 'oxsteed_eor') conditions.push('eor_enrollment');

  errors.throwIfAny();
  return {
    title: text(body.title, 200) || app.opening_title,
    payCents, payPeriod, locationId, teamRole,
    jobRoleCode: text(body.job_role_code, 80) || app.opening_job_role || null,
    startDate, expiresInDays: days, firstShift, aboveRange, outsideReason, conditions,
    isConditional: conditions.includes('background_check'),
    employerModel: app.opening_employer_model || 'direct',
  };
}

async function loadOfferForUpdate(db, offerId) {
  if (!/^\d+$/.test(String(offerId))) throw new AppError('Offer not found', 404, 'not_found');
  const { rows: [offer] } = await db.query('SELECT * FROM career_offers WHERE id = $1 FOR UPDATE', [offerId]);
  if (!offer) throw new AppError('Offer not found', 404, 'not_found');
  return offer;
}

/**
 * Create an offer. Above-range offers wait for the owner or a brand admin
 * unless the actor is one (Q17). One live offer per application.
 */
async function createOffer(db, { app, access, actor, body, settings }) {
  if (!OFFERABLE_STAGES.includes(app.stage)) throw new AppError('Offers can only be made on active applications', 409, 'invalid_transition');
  if (app.is_guest && !app.user_id) {
    // Guests can receive an offer, but must create an account (with
    // identity verification) to accept it; the notice says so.
  }
  const v = parseOffer(body, app, { settings });
  if (access?.kind !== 'platform' && v.teamRole) assertCanHireRole(access, v.teamRole);
  if (access?.kind !== 'platform' && v.locationId) assertLocationsInScope(access, [v.locationId]);
  const needsApproval = v.aboveRange && !access?.canApproveAboveRange;
  let offer;
  try {
    ({ rows: [offer] } = await db.query(
      `INSERT INTO career_offers (
         application_id, title, currency_code, compensation, compensation_period, start_date, expires_at, team_role,
         status, created_by, location_id, job_role_code, pay_cents, pay_period, outside_posted_range_reason,
         first_shift, conditions, employer_model, above_range, above_range_approved_by, above_range_approved_at, is_conditional
       ) VALUES ($1,$2,$3,$4,$5,$6, NOW() + make_interval(days => $7::int), $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING *`,
      [
        app.id, v.title, app.opening_currency || 'USD', v.payCents / 100, v.payPeriod, v.startDate, v.expiresInDays, v.teamRole,
        needsApproval ? 'awaiting_approval' : 'pending', actor.id, v.locationId, v.jobRoleCode, v.payCents, v.payPeriod, v.outsideReason,
        v.firstShift ? JSON.stringify(v.firstShift) : null, v.conditions, v.employerModel, v.aboveRange,
        v.aboveRange && !needsApproval ? actor.id : null, v.aboveRange && !needsApproval ? new Date() : null, v.isConditional,
      ]
    ));
  } catch (err) {
    if (err.code === '23505') throw new AppError('This application already has a live offer', 409, 'offer_exists');
    throw err;
  }
  if (app.stage !== 'offer') {
    await db.query(`UPDATE career_applications SET stage = 'offer', updated_at = NOW() WHERE id = $1`, [app.id]);
  }
  await recordEvent(db, { applicationId: app.id, actorId: actor.id, from: app.stage, to: 'offer', metadata: { offer_id: offer.id, status: offer.status } });
  if (needsApproval) {
    await notifyApprovers(db, app, offer);
  } else {
    await notifyOfferMade(db, app, offer);
  }
  return offer;
}

async function notifyOfferMade(db, app, offer) {
  await notifyApplicant(db, app, {
    type: 'career_offer_received',
    params: { openingTitle: app.opening_title, employerName: app.employer_name, pay: formatPay(offer.pay_cents, offer.pay_period, offer.currency_code, app.locale), guest: !app.user_id },
    actionUrl: app.user_id ? `/careers/me?offer=${offer.id}` : '/signup?next=/careers/me',
    deliveryKey: `career_offer:${offer.id}`,
  });
}

// The owner, brand admins (business-wide managers) are the approvers (Q17).
async function notifyApprovers(db, app, offer) {
  if (app.employer_type === 'platform') {
    return notifyHiringTeam(db, openingShape(app), { type: 'career_offer_needs_approval', params: { openingTitle: app.opening_title }, deliveryKey: `career_offer_approval:${offer.id}` });
  }
  const { rows } = await db.query(
    `SELECT b.user_id FROM businesses b WHERE b.id = $1
     UNION
     SELECT bm.member_id FROM career_hiring_scopes s
       JOIN business_members bm ON bm.id = s.membership_id AND bm.status = 'active' AND bm.role = 'manager'
      WHERE s.business_id = $1 AND s.scope_level = 'brand' AND s.revoked_at IS NULL`,
    [app.business_id]
  );
  for (const r of rows) {
    if (!r.user_id) continue;
    await notifyUser(db, {
      userId: r.user_id, type: 'career_offer_needs_approval', params: { openingTitle: app.opening_title },
      actionUrl: `/business/${app.business_id}/careers?offer=${offer.id}`, deliveryKey: `career_offer_approval:${offer.id}:${r.user_id}`,
    });
  }
  return rows.length;
}

function openingShape(app) {
  return { employer_type: app.employer_type, business_id: app.business_id, created_by: app.opening_created_by, location_ids: app.opening_location_ids };
}

async function approveAboveRange(db, { offer, app, access, actor }) {
  if (!access?.canApproveAboveRange) throw new AppError('Only the owner or a brand admin can approve pay above the posted range', 403, 'approval_forbidden');
  if (offer.status !== 'awaiting_approval') throw new AppError('This offer is not waiting for approval', 409, 'invalid_transition');
  const { rows: [updated] } = await db.query(
    `UPDATE career_offers SET status = 'pending', above_range_approved_by = $2, above_range_approved_at = NOW(),
            expires_at = GREATEST(expires_at, NOW() + INTERVAL '1 day')
      WHERE id = $1 RETURNING *`,
    [offer.id, actor.id]
  );
  await recordEvent(db, { applicationId: app.id, actorId: actor.id, from: app.stage, to: app.stage, metadata: { offer_id: offer.id, above_range_approved: true } });
  await notifyOfferMade(db, app, updated);
  return updated;
}

async function withdrawOffer(db, { offer, app, actor, reason = 'employer_withdrew' }) {
  if (!['pending', 'awaiting_approval'].includes(offer.status) && !(offer.status === 'accepted' && app.stage === 'offer')) {
    throw new AppError('This offer can no longer be withdrawn', 409, 'invalid_transition');
  }
  const { rows: [updated] } = await db.query(
    `UPDATE career_offers SET status = 'withdrawn', decided_at = NOW(), withdrawn_reason = $2 WHERE id = $1 RETURNING *`,
    [offer.id, String(reason).slice(0, 80)]
  );
  await db.query(
    `UPDATE career_background_checks SET status = 'cancelled', updated_at = NOW()
      WHERE offer_id = $1 AND status IN ('invited','consented','pending')`,
    [offer.id]
  );
  await recordEvent(db, { applicationId: app.id, actorId: actor.id, from: app.stage, to: app.stage, metadata: { offer_id: offer.id, offer_withdrawn: true } });
  if (offer.status !== 'awaiting_approval') {
    await notifyApplicant(db, app, {
      type: 'career_offer_withdrawn', params: { openingTitle: app.opening_title, employerName: app.employer_name },
      deliveryKey: `career_offer_withdrawn:${offer.id}`,
    });
  }
  return updated;
}

function termsSnapshot(offer, app) {
  return {
    title: offer.title, pay_cents: Number(offer.pay_cents), pay_period: offer.pay_period, currency_code: offer.currency_code,
    start_date: offer.start_date, location_id: offer.location_id, team_role: offer.team_role, job_role_code: offer.job_role_code,
    first_shift: offer.first_shift, conditions: offer.conditions, employer_model: offer.employer_model,
    employer_name: app.employer_name, accepted_at: new Date().toISOString(),
  };
}

async function backgroundCheckClear(db, offerId) {
  const { rows: [check] } = await db.query(
    `SELECT status FROM career_background_checks WHERE offer_id = $1 AND status <> 'cancelled' ORDER BY id DESC LIMIT 1`,
    [offerId]
  );
  return check?.status === 'clear';
}

/**
 * The candidate accepts or declines (§7 POST /offers/:id/decide). Checks
 * the owner, stage, expiry and conditions; acceptance needs 18+ and a
 * verified identity (Didit). Returns { offer, application, hire }.
 */
async function decideOffer(db, { offerId, user, decision, startRun }) {
  if (!['accept', 'decline'].includes(decision)) throw new AppError('Validation failed', 400, 'validation_failed', { decision: 'accept or decline' });
  const offer = await loadOfferForUpdate(db, offerId);
  const { rows: [app] } = await db.query(
    `SELECT a.*, o.title AS opening_title, o.employer_type, o.business_id, o.created_by AS opening_created_by,
            o.location_ids AS opening_location_ids,
            CASE WHEN o.employer_type = 'platform' THEN 'OxSteed' ELSE b.business_name END AS employer_name
       FROM career_applications a JOIN career_openings o ON o.id = a.opening_id
       LEFT JOIN businesses b ON b.id = o.business_id
      WHERE a.id = $1 FOR UPDATE OF a`,
    [offer.application_id]
  );
  // 404, not 403: an offer that isn't yours doesn't exist for you.
  if (!app || !app.user_id || app.user_id !== user.id) throw new AppError('Offer not found', 404, 'not_found');
  if (offer.status !== 'pending') throw new AppError('This offer is no longer open', 409, 'offer_not_pending');
  if (offer.expires_at && new Date(offer.expires_at) <= new Date()) {
    await db.query(`UPDATE career_offers SET status = 'expired', decided_at = NOW() WHERE id = $1`, [offer.id]);
    throw new AppError('This offer has expired', 410, 'offer_expired');
  }
  if (app.stage !== 'offer') throw new AppError('This application is not at the offer stage', 409, 'invalid_transition');

  if (decision === 'decline') {
    const { rows: [updated] } = await db.query(`UPDATE career_offers SET status = 'declined', decided_at = NOW() WHERE id = $1 RETURNING *`, [offer.id]);
    await db.query(`UPDATE career_applications SET stage = 'offer_declined', updated_at = NOW() WHERE id = $1`, [app.id]);
    await recordEvent(db, { applicationId: app.id, actorId: user.id, from: 'offer', to: 'offer_declined', metadata: { offer_id: offer.id } });
    await stampDecision(db, app.id, { decidedBy: user.id });
    await notifyHiringTeam(db, openingShape(app), {
      type: 'career_offer_declined', params: { openingTitle: app.opening_title, applicantNumber: app.applicant_number },
      deliveryKey: `career_offer_declined:${offer.id}`,
    });
    return { offer: updated, application: { ...app, stage: 'offer_declined' }, hire: null };
  }

  await assertAdult(db, user.id);
  if (!(await isIdentityVerified(db, user.id))) {
    throw new AppError('Verify your identity before accepting this offer', 403, 'identity_verification_required');
  }
  const { rows: [updated] } = await db.query(
    `UPDATE career_offers SET status = 'accepted', decided_at = NOW(), accepted_terms_snapshot = $2 WHERE id = $1 RETURNING *`,
    [offer.id, JSON.stringify(termsSnapshot(offer, app))]
  );
  await recordEvent(db, { applicationId: app.id, actorId: user.id, from: 'offer', to: 'offer', metadata: { offer_id: offer.id, accepted: true } });
  const conditional = (offer.conditions || []).includes('background_check');
  if (conditional && !(await backgroundCheckClear(db, offer.id))) {
    await notifyHiringTeam(db, openingShape(app), {
      type: 'career_offer_accepted', params: { openingTitle: app.opening_title, applicantNumber: app.applicant_number, conditional: true },
      deliveryKey: `career_offer_accepted:${offer.id}`,
    });
    return { offer: updated, application: app, hire: null, pendingConditions: ['background_check'] };
  }
  const hire = await finalizeHire(db, { app, offer: updated, actorId: user.id, startRun });
  return { offer: updated, application: { ...app, stage: 'hired' }, hire };
}

/**
 * Make the hire final: stage hired, retention clock, notify the team and
 * create the onboarding run for business hires (platform hires have none).
 * Called on acceptance, or from the Checkr webhook when a check clears.
 */
async function finalizeHire(db, { app, offer, actorId = null, startRun }) {
  const { rows: [current] } = await db.query('SELECT stage FROM career_applications WHERE id = $1 FOR UPDATE', [app.id]);
  if (current.stage === 'hired') return { alreadyHired: true };
  if (current.stage !== 'offer') throw new AppError('This application is not at the offer stage', 409, 'invalid_transition');
  await db.query(`UPDATE career_applications SET stage = 'hired', updated_at = NOW() WHERE id = $1`, [app.id]);
  await recordEvent(db, { applicationId: app.id, actorId, from: 'offer', to: 'hired', metadata: { offer_id: offer.id } });
  await stampDecision(db, app.id, { decidedBy: actorId });
  await notifyHiringTeam(db, openingShape(app), {
    type: 'career_offer_accepted', params: { openingTitle: app.opening_title, applicantNumber: app.applicant_number },
    deliveryKey: `career_hired:${offer.id}`,
  });
  let run = null;
  if (app.employer_type === 'business' && typeof startRun === 'function') {
    run = await startRun(db, { app, offer });
  }
  return { alreadyHired: false, runId: run?.id || null };
}

/** Expire overdue offers and warn 24 h ahead (§6.7; run by careerOfferExpiryJob). */
async function sweepOffers(db) {
  const { rows: expired } = await db.query(
    `UPDATE career_offers SET status = 'expired', decided_at = NOW()
      WHERE status = 'pending' AND expires_at <= NOW()
      RETURNING id, application_id`
  );
  for (const o of expired) {
    const { rows: [app] } = await db.query(
      `SELECT a.*, o.title AS opening_title, o.employer_type, o.business_id, o.created_by AS opening_created_by,
              o.location_ids AS opening_location_ids,
              CASE WHEN o.employer_type = 'platform' THEN 'OxSteed' ELSE b.business_name END AS employer_name
         FROM career_applications a JOIN career_openings o ON o.id = a.opening_id LEFT JOIN businesses b ON b.id = o.business_id
        WHERE a.id = $1`,
      [o.application_id]
    );
    if (!app) continue;
    await recordEvent(db, { applicationId: app.id, actorId: null, from: app.stage, to: app.stage, metadata: { offer_id: o.id, expired: true } });
    await notifyApplicant(db, app, { type: 'career_offer_expired', params: { openingTitle: app.opening_title, employerName: app.employer_name }, deliveryKey: `career_offer_expired:${o.id}` });
    await notifyHiringTeam(db, openingShape(app), { type: 'career_offer_expired', params: { openingTitle: app.opening_title, employerName: app.employer_name }, deliveryKey: `career_offer_expired_team:${o.id}` });
  }
  const { rows: warn } = await db.query(
    `UPDATE career_offers SET expiry_warned_at = NOW()
      WHERE status = 'pending' AND expiry_warned_at IS NULL AND expires_at > NOW() AND expires_at <= NOW() + INTERVAL '24 hours'
      RETURNING id, application_id`
  );
  for (const o of warn) {
    const { rows: [app] } = await db.query(
      `SELECT a.*, o.title AS opening_title, o.employer_type, o.business_id, o.created_by AS opening_created_by, o.location_ids AS opening_location_ids,
              CASE WHEN o.employer_type = 'platform' THEN 'OxSteed' ELSE b.business_name END AS employer_name
         FROM career_applications a JOIN career_openings o ON o.id = a.opening_id LEFT JOIN businesses b ON b.id = o.business_id
        WHERE a.id = $1`,
      [o.application_id]
    );
    if (!app) continue;
    await notifyApplicant(db, app, { type: 'career_offer_expiring', params: { openingTitle: app.opening_title, employerName: app.employer_name }, deliveryKey: `career_offer_expiring:${o.id}` });
    await notifyHiringTeam(db, openingShape(app), { type: 'career_offer_expiring', params: { openingTitle: app.opening_title, employerName: app.employer_name }, deliveryKey: `career_offer_expiring_team:${o.id}` });
  }
  const { rowCount: invitationsExpired } = await db.query(
    `UPDATE career_invitations SET status = 'expired' WHERE status IN ('sent','viewed') AND expires_at <= NOW()`
  );
  return { expired: expired.length, warned: warn.length, invitationsExpired: invitationsExpired || 0 };
}

async function offerForCandidate(db, { offerId, userId }) {
  if (!/^\d+$/.test(String(offerId))) throw new AppError('Offer not found', 404, 'not_found');
  const { rows: [row] } = await db.query(
    `SELECT of.*, a.user_id, a.stage AS application_stage, o.title AS opening_title, o.employer_type,
            CASE WHEN o.employer_type = 'platform' THEN 'OxSteed' ELSE b.business_name END AS employer_name,
            l.name AS location_name, o.timezone,
            (SELECT status FROM career_background_checks c WHERE c.offer_id = of.id AND c.status <> 'cancelled' ORDER BY c.id DESC LIMIT 1) AS background_check_status
       FROM career_offers of
       JOIN career_applications a ON a.id = of.application_id
       JOIN career_openings o ON o.id = a.opening_id
       LEFT JOIN businesses b ON b.id = o.business_id
       LEFT JOIN restaurant_locations l ON l.id = of.location_id
      WHERE of.id = $1 AND a.user_id = $2 AND of.status <> 'awaiting_approval'`,
    [offerId, userId]
  );
  if (!row) throw new AppError('Offer not found', 404, 'not_found');
  delete row.created_by; delete row.above_range_approved_by; delete row.outside_posted_range_reason;
  return row;
}

module.exports = {
  DEFAULT_EXPIRY_DAYS,
  MAX_EXPIRY_DAYS,
  OFFERABLE_STAGES,
  formatPay,
  parseOffer,
  loadOfferForUpdate,
  createOffer,
  approveAboveRange,
  withdrawOffer,
  decideOffer,
  finalizeHire,
  sweepOffers,
  offerForCandidate,
  backgroundCheckClear,
};
