'use strict';

// "Talent you know", "Find workers" and invitations to apply
// (careers spec §4.3, §4.10, §9.2, §10.5, Q5, Q19).

const { AppError } = require('../../middleware/errorHandler');
const { INVITATION_REASONS } = require('../careerCatalog');
const { FieldErrors, text, bool, codeList } = require('./validation');
const { factsForViewer } = require('./profileFacts');
const { logAccess } = require('./shareLedger');
const { rehireStatus } = require('../team/membership');
const { notifyUser } = require('./notify');
const { locationsInScope } = require('./access');

const BUSINESS_DAILY_CAP = 50;
const WORKER_MONTHLY_CAP = 3;
const INVITATION_TTL_DAYS = 14;
const SEARCH_PAGE = 25;
const SEARCH_MAX_RADIUS_KM = 100;
const SEARCHES_PER_10_MIN = 30;
const SCRAPE_SUBJECTS_PER_DAY = 1000;
const KNOWN_VISIBILITY = ['known_businesses', 'searchable'];

// Never part of talent lists or search (§4.10 step 3).
const NEVER_LISTED = new Set(['background_check', 'rehire_eligible']);

function cleanMessage(value) {
  const raw = text(value, 2000).replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return raw.slice(0, 500) || null;
}

async function invitationUsage(db, businessId, userId = null) {
  const { rows: [u] } = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM career_invitations WHERE business_id = $1 AND created_at > NOW() - INTERVAL '24 hours') AS today,
       (SELECT COUNT(*)::int FROM career_invitations WHERE business_id = $1 AND user_id = $2 AND created_at > NOW() - INTERVAL '30 days') AS pair`,
    [businessId, userId]
  );
  return {
    sentToday: u.today,
    remainingToday: Math.max(0, BUSINESS_DAILY_CAP - u.today),
    sentToWorker30d: userId ? u.pair : null,
    remainingForWorker: userId ? Math.max(0, WORKER_MONTHLY_CAP - u.pair) : null,
  };
}

// People who worked with this business: completed its jobs, worked its
// published shifts, or were on its team. Most recent work first.
const KNOWN_SQL = `
  WITH biz AS (SELECT id, user_id FROM businesses WHERE id = $1),
  worked AS (
    SELECT j.assigned_helper_id AS user_id, MAX(j.completed_at) AS last_at, COUNT(*)::int AS jobs, 0 AS shifts, FALSE AS former
      FROM jobs j, biz
     WHERE j.client_id = biz.user_id AND j.status = 'completed' AND j.deleted_at IS NULL AND j.assigned_helper_id IS NOT NULL
     GROUP BY j.assigned_helper_id
    UNION ALL
    SELECT s.user_id, MAX((s.shift_date)::timestamptz), 0, COUNT(*)::int, FALSE
      FROM business_staff_shifts s
     WHERE s.business_id = $1 AND s.user_id IS NOT NULL AND s.published_at IS NOT NULL AND s.shift_date < CURRENT_DATE
     GROUP BY s.user_id
    UNION ALL
    SELECT r.user_id, MAX(r.removed_at), 0, 0, TRUE
      FROM staff_offboarding_records r
     WHERE r.business_id = $1 AND r.user_id IS NOT NULL AND r.rehired_at IS NULL
     GROUP BY r.user_id
  ),
  known AS (
    SELECT user_id, MAX(last_at) AS last_worked_at, SUM(jobs)::int AS jobs_for_business,
           SUM(shifts)::int AS shifts_for_business, BOOL_OR(former) AS former_staff
      FROM worked GROUP BY user_id
  )
  SELECT k.*, u.first_name, u.last_name, p.headline, p.skill_codes, p.desired_roles, p.languages,
         sc.visibility
    FROM known k
    JOIN users u ON u.id = k.user_id AND u.deleted_at IS NULL AND COALESCE(u.is_banned, FALSE) = FALSE
    JOIN career_profile_share_current sc ON sc.user_id = k.user_id AND sc.visibility = ANY($2)
    LEFT JOIN career_profiles p ON p.user_id = k.user_id
   WHERE NOT EXISTS (SELECT 1 FROM career_profile_mutes m WHERE m.user_id = k.user_id AND m.business_id = $1)
     AND NOT EXISTS (SELECT 1 FROM business_members bm WHERE bm.business_id = $1 AND bm.member_id = k.user_id AND bm.status = 'active')
`;

async function isKnownTo(db, businessId, userId) {
  const { rows } = await db.query(`${KNOWN_SQL} AND k.user_id = $3`, [businessId, KNOWN_VISIBILITY, userId]);
  if (!rows[0]) return null;
  if (rows[0].former_staff && (await rehireStatus(db, { businessId, userId })).blocked) return null;
  return rows[0];
}

async function sharedFacts(db, userId) {
  const { facts } = await factsForViewer(db, userId, { businessId: null });
  return facts.filter((f) => !NEVER_LISTED.has(f.fact_type)).map((f) => ({
    fact_type: f.fact_type, category: f.category, value: f.value, sample_size: f.sample_size, source: f.source,
  }));
}

/** GET /employer/talent: people who allow it, most recent work first, then name. */
async function talentYouKnow(db, { access, viewer, limit = 50, offset = 0 }) {
  const { rows } = await db.query(
    `${KNOWN_SQL} ORDER BY k.last_worked_at DESC NULLS LAST, lower(u.last_name), lower(u.first_name), k.user_id
      LIMIT $3 OFFSET $4`,
    [access.businessId, KNOWN_VISIBILITY, Math.min(100, Math.max(1, Number(limit) || 50)), Math.max(0, Number(offset) || 0)]
  );
  const people = [];
  for (const r of rows) {
    // Former staff appear only if eligible for rehire.
    if (r.former_staff && (await rehireStatus(db, { businessId: access.businessId, userId: r.user_id })).blocked) continue;
    const facts = await sharedFacts(db, r.user_id);
    const { rows: [own] } = await db.query(
      `SELECT COUNT(*)::int AS n, AVG(rv.rating)::numeric(3,2) AS avg
         FROM reviews rv JOIN businesses b ON b.id = $1
        WHERE rv.reviewee_id = $2 AND rv.reviewer_id = b.user_id`,
      [access.businessId, r.user_id]
    );
    await logAccess(db, { viewerUserId: viewer.id, businessId: access.businessId, subjectUserId: r.user_id, context: 'talent_pool', factTypes: facts.map((f) => f.fact_type) });
    people.push({
      user_id: r.user_id,
      display_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      headline: r.headline,
      skill_codes: r.skill_codes || [],
      desired_roles: r.desired_roles || [],
      languages: r.languages || [],
      last_worked_at: r.last_worked_at,
      history: { jobs_for_business: r.jobs_for_business, shifts_for_business: r.shifts_for_business, former_staff: r.former_staff, your_ratings: { count: own.n, average: own.avg == null ? null : Number(own.avg) } },
      facts,
    });
  }
  return { people, usage: await invitationUsage(db, access.businessId) };
}

async function assertSearchAllowed(db, access) {
  const { rows: [biz] } = await db.query('SELECT is_business_verified FROM businesses WHERE id = $1', [access.businessId]);
  if (!biz?.is_business_verified) throw new AppError('Only verified businesses can search for workers', 403, 'business_not_verified');
  const { rows: [lock] } = await db.query(
    'SELECT reason, locked_at FROM career_talent_search_locks WHERE business_id = $1 AND released_at IS NULL', [access.businessId]
  );
  if (lock) throw new AppError('Worker search is paused for this business pending review', 423, 'talent_search_locked');
}

/**
 * GET /employer/talent/search: area (radius around one of the business's
 * stores) and skill only. Ordered by distance, then recent activity —
 * never rating (§10.5). Every result view goes to the access log.
 */
async function searchWorkers(db, { access, viewer, query }) {
  await assertSearchAllowed(db, access);
  const errors = new FieldErrors();
  const locationId = Number(query.near_location);
  if (!Number.isInteger(locationId) || locationId <= 0) errors.add('near_location', 'Pick one of your stores');
  const radius = query.radius_km == null || query.radius_km === '' ? 25 : Number(query.radius_km);
  if (!Number.isFinite(radius) || radius < 1 || radius > SEARCH_MAX_RADIUS_KM) errors.add('radius_km', `Between 1 and ${SEARCH_MAX_RADIUS_KM} km`);
  const skills = codeList(query.skill, 10);
  errors.throwIfAny();
  const { rows: [store] } = await db.query(
    `SELECT l.id, l.latitude, l.longitude FROM restaurant_locations l
       JOIN food_restaurants fr ON fr.id = l.restaurant_id
      WHERE l.id = $1 AND fr.business_id = $2`,
    [locationId, access.businessId]
  );
  if (!store) throw new AppError('Store not found', 404, 'not_found');
  if (!locationsInScope(access, [locationId])) throw new AppError('That store is outside your hiring scope', 403, 'location_scope_forbidden');
  if (store.latitude == null || store.longitude == null) {
    throw new AppError('Validation failed', 400, 'validation_failed', { near_location: 'This store has no map location yet' });
  }

  // Rate limit and scraping guard. Each search writes its result views in
  // one statement, so distinct created_at values count searches.
  const { rows: [usage] } = await db.query(
    `SELECT COUNT(DISTINCT created_at) FILTER (WHERE created_at > NOW() - INTERVAL '10 minutes')::int AS searches,
            COUNT(DISTINCT subject_user_id)::int AS subjects
       FROM career_profile_access_log
      WHERE business_id = $1 AND context = 'talent_search' AND created_at > NOW() - INTERVAL '24 hours'`,
    [access.businessId]
  );
  if (usage.subjects >= SCRAPE_SUBJECTS_PER_DAY) {
    await db.query(
      `INSERT INTO career_talent_search_locks (business_id, reason) VALUES ($1, 'scraping_pattern')
       ON CONFLICT (business_id) DO UPDATE SET reason = EXCLUDED.reason, locked_at = NOW(), released_at = NULL, reviewed_by = NULL`,
      [access.businessId]
    );
    throw new AppError('Worker search is paused for this business pending review', 423, 'talent_search_locked');
  }
  if (usage.searches >= SEARCHES_PER_10_MIN) throw new AppError('Too many searches. Try again in a few minutes.', 429, 'talent_search_rate_limited');

  const page = Math.max(0, Number(query.page) || 0);
  const params = [access.businessId, store.longitude, store.latitude, radius * 1000, skills, SEARCH_PAGE + 1, page * SEARCH_PAGE];
  const { rows } = await db.query(
    `SELECT p.user_id, u.first_name, u.last_name, p.headline, p.skill_codes, p.desired_roles, p.desired_employment,
            p.languages, p.last_active_at,
            ST_Distance(gc.geog, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) AS distance_m
       FROM career_profiles p
       JOIN career_profile_share_current sc ON sc.user_id = p.user_id AND sc.visibility = 'searchable'
       JOIN users u ON u.id = p.user_id AND u.deleted_at IS NULL AND COALESCE(u.is_banned, FALSE) = FALSE
       JOIN geo_postal_centroids gc ON gc.id = p.postal_centroid_id
      WHERE ST_DWithin(gc.geog, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)
        AND NOT EXISTS (SELECT 1 FROM career_profile_mutes m WHERE m.user_id = p.user_id AND m.business_id = $1)
        AND NOT EXISTS (SELECT 1 FROM business_members bm WHERE bm.business_id = $1 AND bm.member_id = p.user_id AND bm.status = 'active')
        AND (cardinality($5::text[]) = 0
             OR p.skill_codes && $5::text[]
             OR p.desired_roles && $5::text[]
             OR EXISTS (SELECT 1 FROM career_profile_facts f
                         WHERE f.user_id = p.user_id AND f.fact_type IN ('certificate','badge','training_completed')
                           AND COALESCE(f.value->>'code', f.category) = ANY($5::text[])
                           AND NOT (f.fact_type = ANY(COALESCE(sc.hidden_fact_types, '{}')))))
      ORDER BY distance_m ASC, p.last_active_at DESC NULLS LAST, p.user_id
      LIMIT $6 OFFSET $7`,
    params
  );
  const hasMore = rows.length > SEARCH_PAGE;
  const results = [];
  const shown = rows.slice(0, SEARCH_PAGE);
  for (const r of shown) {
    const facts = await sharedFacts(db, r.user_id);
    results.push({
      user_id: r.user_id,
      display_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      headline: r.headline,
      skill_codes: r.skill_codes || [],
      desired_roles: r.desired_roles || [],
      desired_employment: r.desired_employment || [],
      languages: r.languages || [],
      // Rounded so search never pinpoints anyone.
      distance_km: Math.max(1, Math.round(Number(r.distance_m) / 1000)),
      facts,
    });
  }
  if (results.length) {
    await db.query(
      `INSERT INTO career_profile_access_log (viewer_user_id, business_id, subject_user_id, context, fact_types)
       SELECT $1, $2, x.user_id, 'talent_search', x.fact_types
         FROM jsonb_to_recordset($3::jsonb) AS x(user_id uuid, fact_types text[])`,
      [viewer.id, access.businessId, JSON.stringify(results.map((r) => ({ user_id: r.user_id, fact_types: r.facts.map((f) => f.fact_type) })))]
    );
  }
  return { results, page, hasMore, usage: await invitationUsage(db, access.businessId) };
}

/**
 * POST /employer/invitations. Caps (Q19): 50 per business per 24 h, 3 per
 * business and worker per 30 days, enforced under a per-business lock.
 */
async function sendInvitation(db, { access, actor, body }) {
  const errors = new FieldErrors();
  const userId = String(body.user_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(userId)) errors.add('user_id', 'Pick a person');
  const source = body.source === 'talent_search' ? 'talent_search' : 'talent_you_know';
  const reason = String(body.reason_code || '');
  if (!INVITATION_REASONS.includes(reason)) errors.add('reason_code', 'Choose a reason');
  if (!bool(body.permissible_purpose_certified)) errors.add('permissible_purpose_certified', 'Certify that this invitation is for employment');
  const openingId = body.opening_id == null || body.opening_id === '' ? null : Number(body.opening_id);
  if (openingId != null && !Number.isInteger(openingId)) errors.add('opening_id', 'Pick an opening');
  if (source === 'talent_search' && openingId == null) errors.add('opening_id', 'Invitations from search are for a specific opening');
  errors.throwIfAny();

  if (openingId != null) {
    const { rows: [opening] } = await db.query(
      `SELECT id, status, location_ids, team_role FROM career_openings WHERE id = $1 AND business_id = $2 AND employer_type = 'business'`,
      [openingId, access.businessId]
    );
    if (!opening) throw new AppError('Opening not found', 404, 'not_found');
    if (opening.status !== 'open') throw new AppError('Only open roles can be shared', 409, 'opening_not_open');
    if (!locationsInScope(access, opening.location_ids || [])) throw new AppError('That opening is outside your hiring scope', 403, 'location_scope_forbidden');
  }
  if (source === 'talent_search') {
    await assertSearchAllowed(db, access);
    const { rows: [sc] } = await db.query('SELECT visibility FROM career_profile_share_current WHERE user_id = $1', [userId]);
    if (sc?.visibility !== 'searchable') throw new AppError('Person not found', 404, 'not_found');
  } else if (!(await isKnownTo(db, access.businessId, userId))) {
    throw new AppError('Person not found', 404, 'not_found');
  }
  const { rows: [muted] } = await db.query('SELECT 1 FROM career_profile_mutes WHERE user_id = $1 AND business_id = $2', [userId, access.businessId]);
  if (muted) throw new AppError('Person not found', 404, 'not_found');

  await db.query('INSERT INTO career_invitation_locks (business_id) VALUES ($1) ON CONFLICT DO NOTHING', [access.businessId]);
  await db.query('SELECT business_id FROM career_invitation_locks WHERE business_id = $1 FOR UPDATE', [access.businessId]);
  const usage = await invitationUsage(db, access.businessId, userId);
  if (usage.remainingToday <= 0) throw new AppError(`Your business can send ${BUSINESS_DAILY_CAP} invitations a day`, 429, 'invitation_cap_business');
  if (usage.remainingForWorker <= 0) throw new AppError(`You can invite the same person ${WORKER_MONTHLY_CAP} times a month`, 429, 'invitation_cap_worker');
  const { rows: [dupe] } = await db.query(
    `SELECT id FROM career_invitations
      WHERE business_id = $1 AND user_id = $2 AND opening_id IS NOT DISTINCT FROM $3 AND status IN ('sent','viewed') AND expires_at > NOW()`,
    [access.businessId, userId, openingId]
  );
  if (dupe) throw new AppError('This person already has an open invitation for this', 409, 'invitation_exists');

  const { rows: [invitation] } = await db.query(
    `INSERT INTO career_invitations (business_id, opening_id, user_id, sent_by, source, reason_code, message, status, permissible_purpose_certified, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'sent', TRUE, NOW() + make_interval(days => $8::int)) RETURNING *`,
    [access.businessId, openingId, userId, actor.id, source, reason, cleanMessage(body.message), INVITATION_TTL_DAYS]
  );
  const { rows: [prefs] } = await db.query('SELECT email_invitations FROM career_profiles WHERE user_id = $1', [userId]);
  await notifyUser(db, {
    userId,
    type: 'career_invitation_received',
    params: { employerName: access.businessName, invitationReasonCode: reason },
    actionUrl: `/careers/me?invitation=${invitation.id}`,
    deliveryKey: `career_invitation:${invitation.id}`,
    email: prefs ? prefs.email_invitations !== false : true,
  });
  return { invitation, usage: { ...usage, remainingToday: usage.remainingToday - 1, remainingForWorker: usage.remainingForWorker - 1 } };
}

async function listMyInvitations(db, userId) {
  await db.query(`UPDATE career_invitations SET status = 'viewed' WHERE user_id = $1 AND status = 'sent' AND expires_at > NOW()`, [userId]);
  const { rows } = await db.query(
    `SELECT i.id, i.business_id, i.opening_id, i.reason_code, i.message, i.status, i.expires_at, i.created_at,
            b.business_name AS employer_name, o.title AS opening_title, o.slug AS opening_slug,
            COALESCE(b.profile_slug, 'b-' || b.id) AS employer_slug
       FROM career_invitations i
       JOIN businesses b ON b.id = i.business_id
       LEFT JOIN career_openings o ON o.id = i.opening_id
      WHERE i.user_id = $1
      ORDER BY i.created_at DESC LIMIT 100`,
    [userId]
  );
  return rows;
}

// Declines quietly: the business is never told why (§4.3 step 4).
async function declineInvitation(db, { invitationId, userId }) {
  const { rows: [row] } = await db.query(
    `UPDATE career_invitations SET status = 'declined', responded_at = NOW()
      WHERE id = $1 AND user_id = $2 AND status IN ('sent','viewed') RETURNING id, status`,
    [invitationId, userId]
  );
  if (!row) throw new AppError('Invitation not found', 404, 'not_found');
  return row;
}

module.exports = {
  BUSINESS_DAILY_CAP,
  WORKER_MONTHLY_CAP,
  INVITATION_TTL_DAYS,
  SEARCHES_PER_10_MIN,
  SCRAPE_SUBJECTS_PER_DAY,
  cleanMessage,
  invitationUsage,
  isKnownTo,
  talentYouKnow,
  searchWorkers,
  sendInvitation,
  listMyInvitations,
  declineInvitation,
};
