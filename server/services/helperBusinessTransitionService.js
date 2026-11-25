'use strict';
// Group 4 rest, items 196-200: grow into ownership.
//
// Emile's rule (2026-11-23): the helper's portfolio and history carry into
// the new business as a read-only record; ratings and client relationships
// stay with the helper. So:
//   196 prefill()   - business application handoff: the wizard is prefilled
//                     from the helper profile (name, description, area). The
//                     normal POST /businesses still creates the business.
//   197 milestones  - readiness, computed on read. Advisory only: they never
//                     gate creating a business (POST /businesses has no gate
//                     today and this does not add one).
//   198 preview     - what would carry (read-only) and what stays, plus the
//                     skills that could become services. Nothing is created.
//   199 link/record - helper_business_records: a reference from a business
//                     the helper owns to their history. Snapshot of counts
//                     at link time; portfolio read live from consented
//                     gallery items. No reviews, ratings, clients, messages
//                     or money are copied or exposed. Revocable by the helper.
//   200 workspace   - first-steps intro for that business, computed from the
//                     business's own data, dismissible.
const pool = require('../db');
const AppError = require('../utils/appError');
const { requireHelper } = require('./helperReputationService');

const MILESTONE_TARGETS = { completedJobs: 10, reviews: 5, averageRating: 4.0 };

async function profile(db, userId) {
  const { rows: [p] } = await db.query(
    `SELECT u.first_name, u.last_name, u.city, u.state, u.country,
            COALESCE(u.id_verified, false) OR COALESCE(u.identity_verified, false)
              OR COALESCE(hp.is_identity_verified, false) AS identity_verified,
            hp.profile_headline, hp.bio_short, hp.bio_long, hp.service_city, hp.service_state,
            hp.service_radius_miles, hp.hourly_rate_min, hp.hourly_rate_max,
            COALESCE(hp.stripe_payouts_enabled, false) AS payouts_ready, hp.created_at AS helper_since
       FROM users u LEFT JOIN helper_profiles hp ON hp.user_id = u.id WHERE u.id = $1`, [userId]);
  return p || {};
}

async function history(db, userId) {
  const [{ rows: [jobs] }, { rows: [reviews] }, { rows: skills }, { rows: [disputes] }, { rows: [gallery] }] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS completed, MIN(COALESCE(completed_at, updated_at)) AS first_at,
                     COALESCE(array_agg(DISTINCT category_name) FILTER (WHERE category_name IS NOT NULL), '{}') AS categories
                FROM jobs WHERE assigned_helper_id = $1 AND status IN ('completed', 'closed') AND deleted_at IS NULL`, [userId]),
    db.query(`SELECT COUNT(*)::int AS total, ROUND(AVG(rating)::numeric, 2) AS average FROM reviews
               WHERE reviewee_id = $1 AND COALESCE(is_hidden, false) = false AND COALESCE(removed, false) = false`, [userId]),
    db.query('SELECT id, skill_name, years_exp FROM helper_skills WHERE user_id = $1 ORDER BY skill_name LIMIT 50', [userId]),
    db.query(`SELECT COUNT(*)::int AS open FROM disputes d JOIN jobs j ON j.id = d.job_id
               WHERE j.assigned_helper_id = $1 AND d.status IN ('open', 'under_review', 'in_progress')`, [userId]),
    db.query(`SELECT COUNT(*)::int AS items FROM helper_gallery g
               LEFT JOIN helper_portfolio_requests r ON r.id = g.permission_request_id
               WHERE g.user_id = $1 AND (g.permission_request_id IS NULL OR r.status = 'approved')`, [userId]),
  ]);
  return { jobs, reviews, skills, disputes, gallery };
}

function milestones(p, h) {
  const avgRating = h.reviews.average == null ? null : Number(h.reviews.average);
  const m = (key, met, current, target) => ({ key, met: Boolean(met), current, target });
  return [
    m('profile_complete', (p.bio_short || p.profile_headline) && h.skills.length > 0, h.skills.length, 1),
    m('identity_verified', p.identity_verified, p.identity_verified ? 1 : 0, 1),
    m('completed_jobs', h.jobs.completed >= MILESTONE_TARGETS.completedJobs, h.jobs.completed, MILESTONE_TARGETS.completedJobs),
    m('steady_reviews', h.reviews.total >= MILESTONE_TARGETS.reviews && avgRating >= MILESTONE_TARGETS.averageRating,
      h.reviews.total, MILESTONE_TARGETS.reviews),
    m('payouts_ready', p.payouts_ready, p.payouts_ready ? 1 : 0, 1),
    m('no_open_disputes', h.disputes.open === 0, h.disputes.open, 0),
  ];
}

function snapshotOf(p, h) {
  return {
    takenAt: new Date().toISOString(),
    completedJobs: h.jobs.completed,
    workingSince: h.jobs.first_at || p.helper_since || null,
    categories: h.jobs.categories || [],
    skills: h.skills.map((s) => ({ name: s.skill_name, years: s.years_exp == null ? null : Number(s.years_exp) })),
    serviceArea: { city: p.service_city || p.city || null, state: p.service_state || p.state || null, radiusMiles: p.service_radius_miles ?? null },
    portfolioItems: h.gallery.items,
  };
}

async function overview(userId) {
  await requireHelper(pool, userId);
  const [p, h] = await Promise.all([profile(pool, userId), history(pool, userId)]);
  const { rows: links } = await pool.query(
    `SELECT r.business_id, b.business_name, r.created_at FROM helper_business_records r
       JOIN businesses b ON b.id = r.business_id
      WHERE r.helper_id = $1 AND r.revoked_at IS NULL AND b.deleted_at IS NULL ORDER BY r.created_at`, [userId]);
  const { rows: owned } = await pool.query(
    'SELECT id, business_name FROM businesses WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at', [userId]);
  const rate = p.hourly_rate_min != null ? Number(p.hourly_rate_min) : null;
  return {
    milestones: milestones(p, h),
    prefill: {
      business_kind: 'service',
      business_name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || '',
      description: (p.profile_headline || p.bio_short || '').slice(0, 2000),
      address_city: p.service_city || p.city || '',
      address_state: p.service_state || p.state || '',
      address_country: p.country || '',
    },
    preview: {
      carries: snapshotOf(p, h),
      stays: ['ratings_reviews', 'client_relationships', 'messages', 'earnings_payouts', 'personal_profile'],
      serviceIdeas: h.skills.map((s) => ({ skill: s.skill_name, suggestedHourlyRate: rate })),
    },
    links: links.map((l) => ({ businessId: l.business_id, businessName: l.business_name, linkedAt: l.created_at })),
    ownedBusinesses: owned.map((b) => ({ id: b.id, name: b.business_name })),
  };
}

function businessIdOf(raw) {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('Invalid business', 400, 'validation_failed');
  return id;
}

async function ownBusiness(db, userId, businessId) {
  const { rows: [b] } = await db.query(
    'SELECT id, business_name, business_kind, is_listed, published_at FROM businesses WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [businessId, userId]);
  if (!b) throw new AppError('Business not found', 404, 'not_found');
  return b;
}

async function link(userId, rawBusinessId) {
  await requireHelper(pool, userId);
  const businessId = businessIdOf(rawBusinessId);
  await ownBusiness(pool, userId, businessId);
  const [p, h] = await Promise.all([profile(pool, userId), history(pool, userId)]);
  const { rows: [row] } = await pool.query(
    `INSERT INTO helper_business_records (helper_id, business_id, snapshot) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (helper_id, business_id) WHERE revoked_at IS NULL DO NOTHING RETURNING id`,
    [userId, businessId, JSON.stringify(snapshotOf(p, h))]);
  return record(userId, businessId, { created: Boolean(row) });
}

async function revoke(userId, rawBusinessId) {
  const businessId = businessIdOf(rawBusinessId);
  const { rowCount } = await pool.query(
    'UPDATE helper_business_records SET revoked_at = NOW() WHERE helper_id = $1 AND business_id = $2 AND revoked_at IS NULL',
    [userId, businessId]);
  if (!rowCount) throw new AppError('Record not found', 404, 'not_found');
  return { revoked: true };
}

// The record and workspace intro are read by the owner of the business who
// linked it. Helper access is not required here: the business stays theirs
// even if they stop offering helper services.
async function record(userId, rawBusinessId, extra = {}) {
  const businessId = businessIdOf(rawBusinessId);
  const b = await ownBusiness(pool, userId, businessId);
  const { rows: [r] } = await pool.query(
    `SELECT snapshot, intro_dismissed_at, created_at FROM helper_business_records
      WHERE helper_id = $1 AND business_id = $2 AND revoked_at IS NULL`, [userId, businessId]);
  if (!r) throw new AppError('Record not found', 404, 'not_found');
  const [{ rows: [svc] }, { rows: [hrs] }, { rows: [team] }, { rows: portfolio }] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS n FROM business_services WHERE business_id = $1 AND COALESCE(is_active, true)', [businessId]),
    pool.query('SELECT COUNT(*)::int AS n FROM business_hours WHERE business_id = $1', [businessId]),
    pool.query("SELECT COUNT(*)::int AS n FROM business_members WHERE business_id = $1 AND status IN ('active', 'pending')", [businessId]),
    pool.query(`SELECT g.id, g.url, g.caption FROM helper_gallery g
                  LEFT JOIN helper_portfolio_requests pr ON pr.id = g.permission_request_id
                 WHERE g.user_id = $1 AND (g.permission_request_id IS NULL OR pr.status = 'approved')
                 ORDER BY g.sort_order NULLS LAST, g.created_at DESC LIMIT 12`, [userId]),
  ]);
  return {
    ...extra,
    businessId,
    businessName: b.business_name,
    readOnly: true,
    linkedAt: r.created_at,
    history: r.snapshot,
    portfolio: portfolio.map((g) => ({ id: g.id, url: g.url, caption: g.caption })),
    intro: {
      dismissed: Boolean(r.intro_dismissed_at),
      steps: [
        { key: 'add_services', done: svc.n > 0 },
        { key: 'set_hours', done: hrs.n > 0 },
        { key: 'publish_profile', done: Boolean(b.is_listed || b.published_at) },
        { key: 'invite_team', done: team.n > 0 },
      ],
    },
  };
}

async function dismissIntro(userId, rawBusinessId) {
  const businessId = businessIdOf(rawBusinessId);
  await ownBusiness(pool, userId, businessId);
  const { rowCount } = await pool.query(
    `UPDATE helper_business_records SET intro_dismissed_at = COALESCE(intro_dismissed_at, NOW())
      WHERE helper_id = $1 AND business_id = $2 AND revoked_at IS NULL`, [userId, businessId]);
  if (!rowCount) throw new AppError('Record not found', 404, 'not_found');
  return { dismissed: true };
}

module.exports = { overview, link, revoke, record, dismissIntro, MILESTONE_TARGETS };
