'use strict';
// Groups 5-6 items 203 (launch status), 204 (verification checklist),
// 205 (service publication checklist), 207 (regional offering rules),
// 210 (service pause controls). Read models are computed from live rows;
// nothing here publishes a business or changes admin review state.
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const { fail, invalid, text, int, isoDate } = require('./common');

const check = (key, ok, required = true) => ({ key, ok: Boolean(ok), required });

async function readiness(businessId) {
  const { rows: [b] } = await pool.query(`SELECT b.*, EXISTS(SELECT 1 FROM business_hours h WHERE h.business_id=b.id AND h.is_closed IS NOT TRUE) AS has_hours_rows
    FROM businesses b WHERE b.id=$1 AND b.deleted_at IS NULL`, [businessId]);
  if (!b) fail(404, 'not_found');
  const { rows: services } = await pool.query(`SELECT s.id, s.name, s.description, s.base_price_cents, s.price, s.duration_minutes, s.duration,
      s.is_active, s.allow_online_booking, s.paused_at, s.paused_until, s.pause_reason, s.region_mode,
      (SELECT COUNT(*)::int FROM business_service_staff ss WHERE ss.service_id=s.id AND ss.is_available IS NOT FALSE) AS staff_count
    FROM business_services s WHERE s.business_id=$1 AND s.deleted_at IS NULL ORDER BY s.sort_order, s.id`, [businessId]);
  const hours = b.has_hours_rows || (b.business_hours_json && Object.keys(b.business_hours_json).length > 0);
  const verification = [
    check('name', b.business_name && b.business_name.trim().length >= 2),
    check('description', b.description && b.description.trim().length >= 40),
    check('contact_phone', b.phone && String(b.phone).replace(/\D/g, '').length >= 7),
    check('address', b.address_city && b.address_state),
    check('service_area', (b.service_city && b.service_state) || Number(b.service_radius_miles) > 0),
    check('hours', hours),
    check('payouts', b.stripe_charges_enabled && b.stripe_payouts_enabled),
    check('logo', b.logo_url, false),
    check('cover_photo', b.cover_photo_url || b.cover_image_url, false),
    check('tax_id', b.ein, false),
    check('verified_badge', b.is_business_verified, false),
  ];
  const now = Date.now();
  const servicePublication = services.map(s => {
    const paused = Boolean(s.paused_at) && (!s.paused_until || new Date(s.paused_until).getTime() > now);
    const checks = [
      check('active', s.is_active !== false),
      check('not_paused', !paused),
      check('description', s.description && s.description.trim().length >= 20),
      check('price', Number(s.base_price_cents) > 0 || Number(s.price) > 0),
      check('duration', Number(s.duration_minutes) > 0 || (s.duration && String(s.duration).trim())),
      check('bookable_staff', s.allow_online_booking === false || s.staff_count > 0),
    ];
    return { id: s.id, name: s.name, paused, paused_until: s.paused_until, pause_reason: s.pause_reason, region_mode: s.region_mode,
      ready: checks.every(c => c.ok || !c.required), checks };
  });
  const requiredOk = verification.every(c => c.ok || !c.required);
  const anyServiceReady = servicePublication.some(s => s.ready);
  let status;
  if (b.is_hidden_by_admin) status = 'hidden';
  else if (b.is_listed && b.published_at) status = 'live';
  else if (requiredOk && anyServiceReady) status = 'ready_to_publish';
  else status = 'in_progress';
  const blockers = [
    ...verification.filter(c => c.required && !c.ok).map(c => `verification.${c.key}`),
    ...(anyServiceReady ? [] : ['services.none_ready']),
  ];
  return {
    business_id: b.id, status, setup_status: b.setup_status, published_at: b.published_at,
    hidden_reason: b.is_hidden_by_admin ? (b.hidden_reason || null) : null,
    verification, services: servicePublication, blockers,
    progress: { done: verification.filter(c => c.ok).length + servicePublication.filter(s => s.ready).length,
      total: verification.length + servicePublication.length },
  };
}

const STATE = /^[A-Z]{2}$/;
const POSTAL = /^[A-Z0-9]{1,10}$/;
function normalizeRegions(body) {
  const mode = body?.region_mode;
  if (!['everywhere', 'only', 'except'].includes(mode)) invalid('region_mode');
  const states = Array.isArray(body.region_states) ? [...new Set(body.region_states.map(v => String(v).trim().toUpperCase()))] : [];
  const prefixes = Array.isArray(body.region_postal_prefixes) ? [...new Set(body.region_postal_prefixes.map(v => String(v).replace(/\s/g, '').toUpperCase()))] : [];
  if (states.length > 60 || prefixes.length > 200 || states.some(v => !STATE.test(v)) || prefixes.some(v => !POSTAL.test(v))) invalid('regions');
  if (mode !== 'everywhere' && !states.length && !prefixes.length) invalid('regions');
  return mode === 'everywhere' ? { mode, states: [], prefixes: [] } : { mode, states, prefixes };
}

async function lockService(db, businessId, serviceId, expectedVersion) {
  const id = int(serviceId, { min: 1, field: 'service' });
  const { rows: [s] } = await db.query('SELECT * FROM business_services WHERE id=$1 AND business_id=$2 AND deleted_at IS NULL FOR UPDATE', [id, businessId]);
  if (!s) fail(404, 'not_found');
  if (expectedVersion !== undefined && int(expectedVersion, { field: 'expectedVersion' }) !== s.offering_version) fail(409, 'offering_changed');
  return s;
}

async function setRegions(businessId, actorId, serviceId, body) {
  const r = normalizeRegions(body);
  return withTransaction(pool, async db => {
    await lockService(db, businessId, serviceId, body?.expectedVersion);
    const { rows: [s] } = await db.query(`UPDATE business_services SET region_mode=$3, region_states=$4, region_postal_prefixes=$5,
      offering_version=offering_version+1, updated_at=NOW() WHERE id=$1 AND business_id=$2
      RETURNING id, region_mode, region_states, region_postal_prefixes, offering_version`, [serviceId, businessId, r.mode, r.states, r.prefixes]);
    await db.query("INSERT INTO business_service_offering_history(service_id,business_id,actor_id,event,detail) VALUES($1,$2,$3,'regions_changed',$4)",
      [serviceId, businessId, actorId, JSON.stringify(r)]);
    return s;
  }, 'business_service_regions');
}

async function pause(businessId, actorId, serviceId, body) {
  const reason = text(body?.reason, 300);
  const until = body?.paused_until ? isoDate(body.paused_until, 'paused_until') : null;
  if (until && new Date(until).getTime() <= Date.now()) invalid('paused_until');
  return withTransaction(pool, async db => {
    await lockService(db, businessId, serviceId, body?.expectedVersion);
    const { rows: [s] } = await db.query(`UPDATE business_services SET paused_at=NOW(), paused_until=$3, pause_reason=$4, paused_by=$5,
      offering_version=offering_version+1, updated_at=NOW() WHERE id=$1 AND business_id=$2
      RETURNING id, paused_at, paused_until, pause_reason, offering_version`, [serviceId, businessId, until, reason, actorId]);
    await db.query("INSERT INTO business_service_offering_history(service_id,business_id,actor_id,event,detail) VALUES($1,$2,$3,'paused',$4)",
      [serviceId, businessId, actorId, JSON.stringify({ reason, paused_until: until })]);
    return s;
  }, 'business_service_pause');
}

async function resume(businessId, actorId, serviceId, body) {
  return withTransaction(pool, async db => {
    const cur = await lockService(db, businessId, serviceId, body?.expectedVersion);
    if (!cur.paused_at) return { id: cur.id, paused_at: null, paused_until: null, pause_reason: null, offering_version: cur.offering_version };
    const { rows: [s] } = await db.query(`UPDATE business_services SET paused_at=NULL, paused_until=NULL, pause_reason=NULL, paused_by=NULL,
      offering_version=offering_version+1, updated_at=NOW() WHERE id=$1 AND business_id=$2
      RETURNING id, paused_at, paused_until, pause_reason, offering_version`, [serviceId, businessId]);
    await db.query("INSERT INTO business_service_offering_history(service_id,business_id,actor_id,event) VALUES($1,$2,$3,'resumed')", [serviceId, businessId, actorId]);
    return s;
  }, 'business_service_resume');
}

async function offerings(businessId) {
  const { rows: services } = await pool.query(`SELECT id, name, is_active, paused_at, paused_until, pause_reason, region_mode, region_states,
      region_postal_prefixes, offering_version FROM business_services WHERE business_id=$1 AND deleted_at IS NULL ORDER BY sort_order, id`, [businessId]);
  const { rows: history } = await pool.query(`SELECT h.service_id, h.event, h.detail, h.created_at, u.first_name, u.last_name
    FROM business_service_offering_history h LEFT JOIN users u ON u.id=h.actor_id WHERE h.business_id=$1 ORDER BY h.id DESC LIMIT 100`, [businessId]);
  return { services, history };
}

// Booking-time enforcement (customer bookings only; staff-created walk-ins
// bypass, decision D-203). Called with the locked service row.
function assertBookable(service, location) {
  const paused = service.paused_at && (!service.paused_until || new Date(service.paused_until).getTime() > Date.now());
  if (paused) fail(409, 'service_paused', 'This service is paused');
  const mode = service.region_mode || 'everywhere';
  if (mode === 'everywhere') return;
  const state = String(location?.state || '').trim().toUpperCase();
  const postal = String(location?.postal_code || '').replace(/\s/g, '').toUpperCase();
  if (!state && !postal) fail(422, 'service_area_required', 'Add your service address to book this service');
  const hit = (service.region_states || []).includes(state) || (service.region_postal_prefixes || []).some(p => postal && postal.startsWith(p));
  if ((mode === 'only' && !hit) || (mode === 'except' && hit)) fail(422, 'outside_service_area', 'This service is not offered in your area');
}

module.exports = { readiness, setRegions, pause, resume, offerings, assertBookable, normalizeRegions };
