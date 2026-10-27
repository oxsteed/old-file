'use strict';

// Public endpoints (careers spec §7 "Public") and Jobs for you (§10.3).

const { AppError } = require('../../middleware/errorHandler');
const { handle, tx, pool, requireUser, ipHash } = require('./common');
const { getCareerCatalog } = require('../../services/careerCatalog');
const openings = require('../../services/careers/openings');
const applications = require('../../services/careers/applications');
const { sendCareerEmail } = require('../../services/careers/notify');
const { jobsForYou, credentialCodes, haversineKm } = require('../../services/careers/matching');
const { factsForViewer } = require('../../services/careers/profileFacts');

// Strip internal fields from public payloads.
function publicOpening(o) {
  if (!o) return o;
  const { is_accepting: _a, ...rest } = o;
  return { ...rest, is_promoted: Boolean(o.is_promoted) };
}

exports.getCatalog = (_req, res) => res.json({ catalog: getCareerCatalog() });

exports.listOpenings = handle(async (req, res) => {
  const result = await openings.listPublic(pool, req.query || {});
  res.json({ ...result, openings: result.openings.map(publicOpening), promoted: result.promoted.map(publicOpening) });
});

// Store names and cities only (public storefront facts) so applicants can
// pick preferred stores (§4.3 step 2).
async function withLocations(opening) {
  const ids = (opening.location_ids || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return { ...opening, locations: [] };
  const { rows } = await pool.query(
    `SELECT id, name, address_city AS city, address_state AS region FROM restaurant_locations
      WHERE id = ANY($1::bigint[]) AND status IS DISTINCT FROM 'closed' ORDER BY name`,
    [ids]
  );
  return { ...opening, locations: rows };
}

exports.getOpening = handle(async (req, res) => {
  const opening = await openings.getPublic(pool, { id: req.params.id });
  if (!opening) throw new AppError('Opening not found', 404, 'not_found');
  res.json({ opening: await withLocations(publicOpening(opening)) });
});

exports.getOpeningBySlug = handle(async (req, res) => {
  const opening = await openings.getPublic(pool, { employerSlug: req.params.employerSlug, slug: req.params.slug });
  if (!opening) throw new AppError('Opening not found', 404, 'not_found');
  res.json({ opening: await withLocations(publicOpening(opening)) });
});

/**
 * The opening an application goes to, with the internal fields apply
 * needs. Internal postings (§4.5 step 3) are open to the business's own
 * active team members only.
 */
async function applyTarget(db, id, user) {
  let opening = await openings.getPublic(db, { id });
  if (!opening && user && /^\d+$/.test(String(id))) {
    const { rows: [internal] } = await db.query(
      `SELECT o.id FROM career_openings o
         JOIN businesses b ON b.id = o.business_id AND b.deleted_at IS NULL AND b.is_active = TRUE
         JOIN business_members bm ON bm.business_id = o.business_id AND bm.member_id = $2 AND bm.status = 'active'
        WHERE o.id = $1 AND o.is_internal = TRUE AND o.status = 'open' AND o.moderation_status = 'ok'`,
      [id, user.id]
    );
    if (internal) {
      const { rows: [row] } = await db.query(
        `SELECT o.*, b.business_name AS employer_name, TRUE AS is_accepting
           FROM career_openings o JOIN businesses b ON b.id = o.business_id WHERE o.id = $1`,
        [id]
      );
      opening = row;
    }
  }
  if (!opening) throw new AppError('Opening not found', 404, 'not_found');
  const { rows: [extra] } = await db.query(
    'SELECT created_by, hide_identity_until_offer, location_ids FROM career_openings WHERE id = $1', [opening.id]
  );
  return { ...opening, ...extra };
}

exports.apply = handle(async (req, res) => {
  const user = requireUser(req);
  const application = await tx(async (c) => {
    const opening = await applyTarget(c, req.params.id, user);
    return applications.applyAsUser(c, { opening, user, body: req.body || {}, req });
  }, 'career_apply');
  res.status(201).json({
    application: { id: application.id, opening_id: application.opening_id, stage: application.stage, applicant_number: application.applicant_number },
  });
});

exports.guestStart = handle(async (req, res) => {
  const result = await tx(async (c) => {
    const opening = await applyTarget(c, req.params.id, null);
    return applications.startGuestApplication(c, {
      opening,
      body: req.body || {},
      ipHash: ipHash(req),
      sendEmail: ({ to, token, locale }) => sendCareerEmail({
        to, lang: locale, type: 'career_guest_confirm',
        params: { openingTitle: opening.title, employerName: opening.employer_name },
        actionUrl: `/careers/${opening.id}/confirm?token=${encodeURIComponent(token)}`,
      }),
    });
  }, 'career_guest_start');
  res.status(202).json(result);
});

exports.guestConfirm = handle(async (req, res) => {
  const token = String(req.body?.token || '');
  const result = await tx(async (c) => {
    const opening = await openings.getPublic(c, { id: req.params.id, includeClosed: true });
    if (!opening) throw new AppError('Opening not found', 404, 'not_found');
    const { rows: [extra] } = await c.query('SELECT created_by, location_ids FROM career_openings WHERE id = $1', [opening.id]);
    return applications.confirmGuestApplication(c, { opening: { ...opening, ...extra }, token });
  }, 'career_guest_confirm');
  res.status(result.replayed ? 200 : 201).json({ confirmed: true, replayed: result.replayed });
});

/** GET /me/jobs-for-you: near the worker's postal centre, scored with reasons. */
exports.jobsForYou = handle(async (req, res) => {
  const user = requireUser(req);
  const { rows: [p] } = await pool.query(
    `SELECT p.*, gc.postal_code, gc.country, gc.lat, gc.lng
       FROM career_profiles p LEFT JOIN geo_postal_centroids gc ON gc.id = p.postal_centroid_id
      WHERE p.user_id = $1`,
    [user.id]
  );
  if (!p?.postal_code) return res.json({ openings: [], needs_postal_code: true });
  const list = await openings.listPublic(pool, { near: p.postal_code, country: p.country, radius_km: p.travel_radius_km || 25, limit: 50 });
  const ids = list.openings.map((o) => o.id);
  const coords = new Map();
  if (ids.length) {
    const { rows } = await pool.query(
      `SELECT o.id, COALESCE(gc.lat, rl.latitude) AS lat, COALESCE(gc.lng, rl.longitude) AS lng
         FROM career_openings o
         LEFT JOIN geo_postal_centroids gc ON gc.id = o.postal_centroid_id
         LEFT JOIN LATERAL (SELECT latitude, longitude FROM restaurant_locations WHERE id = ANY(o.location_ids) AND latitude IS NOT NULL LIMIT 1) rl ON TRUE
        WHERE o.id = ANY($1)`,
      [ids]
    );
    for (const r of rows) if (r.lat != null) coords.set(Number(r.id), { lat: Number(r.lat), lng: Number(r.lng) });
  }
  const { facts } = await factsForViewer(pool, user.id, { includeHidden: true });
  const codes = credentialCodes(facts);
  const scored = [];
  for (const o of list.openings) {
    const c = coords.get(Number(o.id));
    const distanceKm = c && p.lat != null ? haversineKm({ lat: Number(p.lat), lng: Number(p.lng) }, c) : null;
    const fit = jobsForYou(o, p, { distanceKm, factsCodes: codes });
    if (fit.excluded) continue;
    scored.push({ ...publicOpening(o), match: { score: fit.score, reasons: fit.reasons, distance_km: distanceKm == null ? null : Math.round(distanceKm) } });
  }
  // Promoted openings never enter this list (R10).
  scored.sort((a, b) => b.match.score - a.match.score || new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at));
  res.json({ openings: scored });
});
