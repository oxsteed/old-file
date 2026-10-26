'use strict';

// Paid boosts and bulk-hiring events (careers spec §4.7 step 5, §18.1, Q20).
// A boost only changes how an opening shows to job seekers ("Promoted").
// Nothing here is read by ranking, talent search, caps or "Jobs for you".

const { AppError } = require('../../middleware/errorHandler');
const { BULK_NEUTRAL_STAGES } = require('../careerCatalog');
const { FieldErrors, text, idList, isValidTimeZone } = require('./validation');
const provider = require('./providers/billing');
const { locationsInScope } = require('./access');
const { recordEvent } = require('./applications');
const { notifyApplicant } = require('./notify');

const BOOST_PLANS = Object.freeze({ boost_7d: 7, boost_30d: 30 });
const HIRING_EVENT_MAX_DAYS = 120;
const BULK_MAX = 200;

function appUrl(path) {
  const base = String(process.env.CLIENT_URL || process.env.APP_URL || 'https://oxsteed.com').replace(/\/+$/, '');
  return `${base}${path}`;
}

function notConfigured(err) {
  if (err && err.code === 'provider_not_configured') {
    return new AppError('Paid careers features are not available yet', 503, 'provider_not_configured', { reason: err.reason });
  }
  return err;
}

async function createBoost(db, { access, actor, body, idempotencyKey, checkoutImpl = provider.createCheckout }) {
  const errors = new FieldErrors();
  const plan = String(body.plan || '');
  if (!BOOST_PLANS[plan]) errors.add('plan', 'Choose a boost');
  const openingId = Number(body.opening_id);
  if (!Number.isInteger(openingId)) errors.add('opening_id', 'Pick an opening');
  errors.throwIfAny();
  const { rows: [opening] } = await db.query(
    `SELECT id, status, location_ids, moderation_status FROM career_openings WHERE id = $1 AND business_id = $2 AND employer_type = 'business'`,
    [openingId, access.businessId]
  );
  if (!opening) throw new AppError('Opening not found', 404, 'not_found');
  if (!locationsInScope(access, opening.location_ids || [])) throw new AppError('Opening not found', 404, 'not_found');
  if (opening.status !== 'open' || opening.moderation_status !== 'ok') throw new AppError('Only open, live roles can be boosted', 409, 'opening_not_open');
  const key = idempotencyKey ? String(idempotencyKey).slice(0, 120) : null;
  if (key) {
    const { rows: [prior] } = await db.query('SELECT * FROM career_boosts WHERE business_id = $1 AND idempotency_key = $2', [access.businessId, key]);
    if (prior) return { boost: prior, replayed: true };
  }
  const days = BOOST_PLANS[plan];
  const { rows: [boost] } = await db.query(
    `INSERT INTO career_boosts (business_id, opening_id, plan, starts_at, ends_at, price_cents, status, idempotency_key, created_by)
     VALUES ($1, $2, $3, NOW(), NOW() + make_interval(days => $4::int), 0, 'pending_payment', $5, $6) RETURNING *`,
    [access.businessId, openingId, plan, days, key, actor.id]
  );
  let checkout;
  try {
    checkout = await checkoutImpl({
      plan, kind: 'boost', recordId: boost.id, businessId: access.businessId, idempotencyKey: key || `boost-${boost.id}`,
      successUrl: appUrl(`/business/${access.businessId}/careers?boost=${boost.id}&paid=1`),
      cancelUrl: appUrl(`/business/${access.businessId}/careers?boost=${boost.id}`),
    });
  } catch (err) {
    throw notConfigured(err);
  }
  const { rows: [updated] } = await db.query(
    `UPDATE career_boosts SET payment_ref = $2, price_cents = COALESCE($3, price_cents), currency = COALESCE(upper($4), currency)
      WHERE id = $1 RETURNING *`,
    [boost.id, checkout.sessionId, checkout.amountTotal, checkout.currency]
  );
  return { boost: updated, checkoutUrl: checkout.checkoutUrl };
}

async function createHiringEvent(db, { access, actor, body, checkoutImpl = provider.createCheckout }) {
  const errors = new FieldErrors();
  const name = text(body.name, 160);
  if (!name) errors.add('name', 'Name the hiring event');
  const locationIds = idList(body.location_ids, 'location_ids', errors, 200) || [];
  const openingIds = idList(body.opening_ids, 'opening_ids', errors, 200) || [];
  if (!openingIds.length) errors.add('opening_ids', 'Pick at least one opening');
  const starts = new Date(body.starts_at || Date.now());
  const ends = new Date(body.ends_at);
  if (Number.isNaN(starts.getTime())) errors.add('starts_at', 'Pick a start');
  if (Number.isNaN(ends.getTime()) || ends <= starts) errors.add('ends_at', 'Pick an end after the start');
  else if ((ends - starts) / 86_400_000 > HIRING_EVENT_MAX_DAYS) errors.add('ends_at', `At most ${HIRING_EVENT_MAX_DAYS} days`);
  errors.throwIfAny();
  const { rows: openings } = await db.query(
    `SELECT id, location_ids FROM career_openings WHERE id = ANY($1) AND business_id = $2 AND employer_type = 'business'`,
    [openingIds, access.businessId]
  );
  if (openings.length !== openingIds.length) throw new AppError('Validation failed', 400, 'validation_failed', { opening_ids: 'Pick openings from this business' });
  for (const o of openings) if (!locationsInScope(access, o.location_ids || [])) throw new AppError('That opening is outside your hiring scope', 403, 'location_scope_forbidden');
  if (locationIds.length) {
    const { rows: stores } = await db.query(
      `SELECT l.id FROM restaurant_locations l JOIN food_restaurants fr ON fr.id = l.restaurant_id
        WHERE l.id = ANY($1) AND fr.business_id = $2`,
      [locationIds, access.businessId]
    );
    if (stores.length !== locationIds.length) throw new AppError('Validation failed', 400, 'validation_failed', { location_ids: 'Pick stores from this business' });
    if (!locationsInScope(access, locationIds)) throw new AppError('That store is outside your hiring scope', 403, 'location_scope_forbidden');
  }
  const { rows: [brand] } = await db.query('SELECT brand_id FROM food_restaurants WHERE business_id = $1 AND brand_id IS NOT NULL LIMIT 1', [access.businessId]);
  const { rows: [event] } = await db.query(
    `INSERT INTO career_hiring_events (business_id, brand_id, name, location_ids, opening_ids, starts_at, ends_at, plan, price_cents, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'hiring_event', 0, 'pending_payment', $8) RETURNING *`,
    [access.businessId, brand?.brand_id || null, name, locationIds, openingIds, starts.toISOString(), ends.toISOString(), actor.id]
  );
  let checkout;
  try {
    checkout = await checkoutImpl({
      plan: 'hiring_event', kind: 'hiring_event', recordId: event.id, businessId: access.businessId, idempotencyKey: `event-${event.id}`,
      successUrl: appUrl(`/business/${access.businessId}/careers?hiring_event=${event.id}&paid=1`),
      cancelUrl: appUrl(`/business/${access.businessId}/careers?hiring_event=${event.id}`),
    });
  } catch (err) {
    throw notConfigured(err);
  }
  const { rows: [updated] } = await db.query(
    `UPDATE career_hiring_events SET payment_ref = $2, price_cents = COALESCE($3, price_cents), currency = COALESCE(upper($4), currency)
      WHERE id = $1 RETURNING *`,
    [event.id, checkout.sessionId, checkout.amountTotal, checkout.currency]
  );
  return { hiringEvent: updated, checkoutUrl: checkout.checkoutUrl };
}

async function refreshPromotion(db, openingId) {
  await db.query(
    `UPDATE career_openings o
        SET promoted_until = sub.until, boost_id = sub.boost_id, updated_at = NOW()
       FROM (SELECT MAX(ends_at) AS until, (ARRAY_AGG(id ORDER BY ends_at DESC))[1] AS boost_id
               FROM career_boosts WHERE opening_id = $1 AND status = 'active' AND ends_at > NOW()) sub
      WHERE o.id = $1`,
    [openingId]
  );
}

/** Verified Stripe event → activate or cancel the paid record. Idempotent. */
async function applyStripeEvent(db, event) {
  const obj = event?.data?.object || {};
  const kind = obj.metadata?.careers_kind;
  const recordId = Number(obj.metadata?.careers_record_id);
  if (!kind || !Number.isInteger(recordId)) return { ignored: true };
  const paid = event.type === 'checkout.session.completed' && (obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required');
  const failed = ['checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type);
  const asyncPaid = event.type === 'checkout.session.async_payment_succeeded';
  if (!paid && !failed && !asyncPaid) return { ignored: true };
  if (kind === 'boost') {
    const { rows: [boost] } = await db.query('SELECT * FROM career_boosts WHERE id = $1 AND payment_ref = $2 FOR UPDATE', [recordId, obj.id]);
    if (!boost) return { ignored: true, reason: 'unknown_boost' };
    if (failed) {
      if (boost.status === 'pending_payment') await db.query(`UPDATE career_boosts SET status = 'cancelled' WHERE id = $1`, [boost.id]);
      return { boost: boost.id, status: 'cancelled' };
    }
    if (boost.status !== 'pending_payment') return { boost: boost.id, status: boost.status, duplicate: true };
    const days = BOOST_PLANS[boost.plan] || 7;
    await db.query(
      `UPDATE career_boosts SET status = 'active', starts_at = NOW(), ends_at = NOW() + make_interval(days => $2::int),
              price_cents = COALESCE($3, price_cents)
        WHERE id = $1`,
      [boost.id, days, obj.amount_total ?? null]
    );
    await refreshPromotion(db, boost.opening_id);
    return { boost: boost.id, status: 'active' };
  }
  if (kind === 'hiring_event') {
    const { rows: [ev] } = await db.query('SELECT * FROM career_hiring_events WHERE id = $1 AND payment_ref = $2 FOR UPDATE', [recordId, obj.id]);
    if (!ev) return { ignored: true, reason: 'unknown_hiring_event' };
    if (failed) {
      if (ev.status === 'pending_payment') await db.query(`UPDATE career_hiring_events SET status = 'cancelled' WHERE id = $1`, [ev.id]);
      return { hiringEvent: ev.id, status: 'cancelled' };
    }
    if (ev.status !== 'pending_payment') return { hiringEvent: ev.id, status: ev.status, duplicate: true };
    await db.query(`UPDATE career_hiring_events SET status = 'active', price_cents = COALESCE($2, price_cents) WHERE id = $1`, [ev.id, obj.amount_total ?? null]);
    await db.query(`UPDATE career_openings SET hiring_event_id = $1, updated_at = NOW() WHERE id = ANY($2) AND business_id = $3`, [ev.id, ev.opening_ids, ev.business_id]);
    return { hiringEvent: ev.id, status: 'active' };
  }
  return { ignored: true };
}

/** End expired boosts and hiring events (careerBoostExpiryJob). */
async function sweepExpired(db) {
  const { rows: boosts } = await db.query(
    `UPDATE career_boosts SET status = 'ended' WHERE status = 'active' AND ends_at <= NOW() RETURNING opening_id`
  );
  for (const openingId of new Set(boosts.map((b) => b.opening_id))) await refreshPromotion(db, openingId);
  await db.query(
    `UPDATE career_openings SET promoted_until = NULL, boost_id = NULL
      WHERE promoted_until IS NOT NULL AND promoted_until <= NOW()`
  );
  const { rows: events } = await db.query(
    `UPDATE career_hiring_events SET status = 'ended' WHERE status = 'active' AND ends_at <= NOW() RETURNING id`
  );
  if (events.length) {
    await db.query('UPDATE career_openings SET hiring_event_id = NULL WHERE hiring_event_id = ANY($1)', [events.map((e) => e.id)]);
  }
  // Unpaid checkouts older than a day are abandoned.
  await db.query(`UPDATE career_boosts SET status = 'cancelled' WHERE status = 'pending_payment' AND created_at < NOW() - INTERVAL '1 day'`);
  await db.query(`UPDATE career_hiring_events SET status = 'cancelled' WHERE status = 'pending_payment' AND created_at < NOW() - INTERVAL '1 day'`);
  return { boostsEnded: boosts.length, eventsEnded: events.length };
}

/**
 * Bulk neutral moves (§4.7 step 5, §8 #11): only screening/interview/
 * assessment, only on openings in an active hiring event. No bulk reject.
 */
async function bulkMove(db, { access, actor, applicationIds, toStage, isInScope }) {
  if (!BULK_NEUTRAL_STAGES.includes(toStage)) {
    throw new AppError('Bulk actions only cover neutral moves', 400, 'validation_failed', { to_stage: 'Choose screening, interview or assessment' });
  }
  const ids = [...new Set((applicationIds || []).map(Number).filter(Number.isInteger))].slice(0, BULK_MAX);
  if (!ids.length) throw new AppError('Validation failed', 400, 'validation_failed', { application_ids: 'Pick applications' });
  const { rows: apps } = await db.query(
    `SELECT a.*, o.business_id, o.hiring_event_id, o.title AS opening_title, o.location_ids AS opening_location_ids,
            b.business_name AS employer_name, he.status AS hiring_event_status
       FROM career_applications a
       JOIN career_openings o ON o.id = a.opening_id
       JOIN businesses b ON b.id = o.business_id
       LEFT JOIN career_hiring_events he ON he.id = o.hiring_event_id
      WHERE a.id = ANY($1) AND o.business_id = $2
      ORDER BY a.id FOR UPDATE OF a`,
    [ids, access.businessId]
  );
  if (apps.length !== ids.length || apps.some((a) => !isInScope(a))) throw new AppError('Application not found', 404, 'not_found');
  if (apps.some((a) => a.hiring_event_status !== 'active')) {
    throw new AppError('Bulk moves are part of a hiring event', 402, 'hiring_event_required');
  }
  const { STAGE_TRANSITIONS } = require('../careerCatalog');
  const moved = [];
  const skipped = [];
  for (const app of apps) {
    if (!(STAGE_TRANSITIONS[app.stage] || []).includes(toStage)) { skipped.push({ id: app.id, stage: app.stage }); continue; }
    await db.query('UPDATE career_applications SET stage = $2, updated_at = NOW() WHERE id = $1', [app.id, toStage]);
    await recordEvent(db, { applicationId: app.id, actorId: actor.id, from: app.stage, to: toStage, metadata: { bulk: true, hiring_event_id: app.hiring_event_id } });
    await notifyApplicant(db, app, {
      type: 'career_stage_changed', params: { openingTitle: app.opening_title, employerName: app.employer_name },
      deliveryKey: `career_stage:${app.id}:${toStage}`,
    });
    moved.push(app.id);
  }
  return { moved, skipped };
}

async function createInterviewSlots(db, { access, hiringEventId, body }) {
  const { rows: [ev] } = await db.query(
    `SELECT * FROM career_hiring_events WHERE id = $1 AND business_id = $2 AND status = 'active'`, [hiringEventId, access.businessId]
  );
  if (!ev) throw new AppError('Hiring event not found', 404, 'not_found');
  const slots = Array.isArray(body.slots) ? body.slots.slice(0, 100) : [];
  const errors = new FieldErrors();
  if (!slots.length) errors.add('slots', 'Add at least one slot');
  const clean = slots.map((s, i) => {
    const starts = new Date(s.starts_at);
    if (Number.isNaN(starts.getTime()) || starts < new Date()) errors.add(`slots.${i}.starts_at`, 'Pick a future time');
    const tz = s.timezone || 'UTC';
    if (!isValidTimeZone(tz)) errors.add(`slots.${i}.timezone`, 'Use an IANA time zone');
    const duration = Number(s.duration_minutes || 30);
    if (!Number.isInteger(duration) || duration < 10 || duration > 240) errors.add(`slots.${i}.duration_minutes`, '10 to 240');
    const capacity = Number(s.capacity || 5);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) errors.add(`slots.${i}.capacity`, '1 to 200');
    const locationId = s.location_id == null ? null : Number(s.location_id);
    if (locationId != null && ev.location_ids.length && !ev.location_ids.map(Number).includes(locationId)) errors.add(`slots.${i}.location_id`, 'Pick a store in this event');
    return { starts, tz, duration, capacity, locationId };
  });
  errors.throwIfAny();
  const created = [];
  for (const s of clean) {
    const { rows: [slot] } = await db.query(
      `INSERT INTO career_interview_slots (hiring_event_id, location_id, starts_at, duration_minutes, capacity, timezone)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [ev.id, s.locationId, s.starts.toISOString(), s.duration, s.capacity, s.tz]
    );
    created.push(slot);
  }
  return created;
}

async function lockSlot(db, { slotId, businessId }) {
  const { rows: [slot] } = await db.query(
    `SELECT s.*, (SELECT COUNT(*)::int FROM career_interviews i WHERE i.group_slot_id = s.id AND i.cancelled_at IS NULL) AS booked
       FROM career_interview_slots s JOIN career_hiring_events e ON e.id = s.hiring_event_id
      WHERE s.id = $1 AND e.business_id = $2 AND e.status = 'active'
      FOR UPDATE OF s`,
    [slotId, businessId]
  );
  if (!slot) throw new AppError('Interview slot not found', 404, 'not_found');
  if (slot.booked >= slot.capacity) throw new AppError('This slot is full', 409, 'slot_full');
  return slot;
}

module.exports = {
  BOOST_PLANS,
  createBoost,
  createHiringEvent,
  applyStripeEvent,
  sweepExpired,
  refreshPromotion,
  bulkMove,
  createInterviewSlots,
  lockSlot,
};
