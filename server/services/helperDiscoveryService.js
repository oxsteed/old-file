'use strict';
const pool = require('../db');
const access = require('./access/accessService');
const { withTransaction } = require('../utils/transaction');
const AppError = require('../utils/appError');
const jobStatus = require('./jobStatusPolicy');
const availability = require('./helperAvailabilityService');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status, code) => { throw new AppError(code, status, code); };
async function helper(db, id) {
  if (!(await access.can(id, 'helper.offer_services', undefined, db)).allowed) fail(403, 'access_required');
}
async function preferences(userId) {
  await helper(pool, userId);
  const { rows: [row] } = await pool.query('SELECT opportunity_radius_miles, discovery_version FROM helper_profiles WHERE user_id=$1', [userId]);
  return row || { opportunity_radius_miles: 25, discovery_version: 1 };
}
async function save(userId, body) {
  if (!Number.isInteger(body?.opportunity_radius_miles) || body.opportunity_radius_miles < 1 || body.opportunity_radius_miles > 250 || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) fail(400, 'validation_failed');
  return withTransaction(pool, async db => {
    await helper(db, userId);
    await db.query('INSERT INTO helper_profiles(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING', [userId]);
    const { rows: [row] } = await db.query(`UPDATE helper_profiles SET opportunity_radius_miles=$2, discovery_version=discovery_version+1 WHERE user_id=$1 AND discovery_version=$3 RETURNING opportunity_radius_miles,discovery_version`, [userId, body.opportunity_radius_miles, body.expectedVersion]);
    if (!row) fail(409, 'discovery_version_conflict');
    return row;
  }, 'helper_discovery_save');
}
async function preview(userId, jobId) {
  if (!UUID.test(jobId || '')) fail(400, 'validation_failed');
  await helper(pool, userId);
  // Only public/open jobs or the helper's own assignment. Never return billing,
  // exact coordinates, contact details, or the customer's private notes.
  // Group 4 Slice B (165): the preview also answers distance and pay, the
  // two things the helper needs to judge "is this worth it for me". Distance
  // is a rounded one-decimal mile figure computed server-side from the
  // helper's saved service location and the job's point (null when either
  // side has no location); no coordinates leave the server. Budget is the
  // job's own listed range, which the job page already shows to bidders.
  const { rows: [job] } = await pool.query(`SELECT id,client_id,assigned_helper_id,status,requirements,required_skills,scheduled_start_at,scheduled_end_at,estimated_duration_hours,location_point,budget_min,budget_max FROM jobs WHERE id=$1 AND deleted_at IS NULL`, [jobId]);
  if (!job || (!jobStatus.isBiddable(job.status) && String(job.assigned_helper_id) !== String(userId))) fail(404, 'not_found');
  let distanceMiles = null;
  const { rows: [loc] } = await pool.query(
    `SELECT ST_Distance(j.location_point, COALESCE(hp.service_location, ST_SetSRID(ST_MakePoint(hp.service_lng, hp.service_lat), 4326)::geography)) / 1609.344 AS miles
       FROM jobs j, helper_profiles hp
      WHERE j.id = $1 AND hp.user_id = $2`,
    [jobId, userId],
  );
  if (loc && loc.miles !== null && loc.miles !== undefined && Number.isFinite(Number(loc.miles))) {
    distanceMiles = Math.round(Number(loc.miles) * 10) / 10;
  }
  const own = String(job.client_id) === String(userId);
  let schedule = 'unknown';
  if (job.scheduled_start_at && (job.scheduled_end_at || Number(job.estimated_duration_hours) > 0)) {
    const start = new Date(job.scheduled_start_at);
    const end = job.scheduled_end_at ? new Date(job.scheduled_end_at) : new Date(start.getTime() + Number(job.estimated_duration_hours) * 3600000);
    if (start > new Date() && end > start) {
      const timeZone = await availability.getHelperTimeZone(userId, pool) || 'UTC';
      const slot = await availability.isSlotFree(userId, start.toISOString(), end.toISOString(), pool, timeZone);
      schedule = slot.free ? 'available' : 'conflict';
    }
  }
  const labels = input => Array.isArray(input) ? input.slice(0, 50).map(value => typeof value === 'string' ? value.slice(0, 200) : typeof value?.label === 'string' ? value.label.slice(0, 200) : '').filter(Boolean) : [];
  return { can_bid_now: !own && jobStatus.isBiddable(job.status), schedule, requirements: labels(job.requirements), required_skills: labels(job.required_skills), advisory: true, distance_miles: distanceMiles, budget_min: job.budget_min === null || job.budget_min === undefined ? null : Number(job.budget_min), budget_max: job.budget_max === null || job.budget_max === undefined ? null : Number(job.budget_max) };
}
module.exports = { preferences, save, preview };
