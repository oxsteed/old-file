'use strict';

// Employer directory, public employer pages, company reviews, Q&A and
// salary insights (docs/careers/marketplace.md §4). Anti-abuse rules:
//   • Reviews and salary reports come only from people OxSteed records
//     show worked there (an accepted team membership or a hired
//     application), never from the business's own owner or managers.
//   • Text with contact details or links is held for moderation; three
//     distinct reports hide a published review until a moderator decides.
//   • Salary figures from individuals are only shown in aggregate, and
//     only when at least SALARY_MIN_REPORTS people reported the same title.
//   • Businesses can reply to reviews but never edit or remove them.

const { AppError } = require('../../../middleware/errorHandler');
const { FieldErrors, text, bool } = require('../validation');
const { REVIEW_CATEGORIES, REVIEW_REPORT_REASONS, COMPENSATION_PERIODS } = require('../../careerCatalog');
const { PUBLIC_FILTER } = require('../openings');
const {
  requireId, notFound, cleanUserText, pageParams, normalizeTitle, toHourly, percentile, round2,
} = require('./common');

const SALARY_MIN_REPORTS = 5;
const REVIEW_HIDE_REPORTS = 3;
const ACCOUNT_MIN_AGE_DAYS = 7;

const EMPLOYER_SLUG_SQL = `COALESCE(b.profile_slug::text, 'b-' || b.id::text)`;
const LISTED_BUSINESS = `b.deleted_at IS NULL AND b.is_active = TRUE AND COALESCE(b.is_hidden_by_admin, FALSE) = FALSE`;

async function resolveBusinessBySlug(db, slug) {
  const s = String(slug || '').toLowerCase().slice(0, 120);
  if (!s) return null;
  const m = /^b-(\d+)$/.exec(s);
  const { rows: [b] } = await db.query(
    `SELECT b.id FROM businesses b WHERE ${LISTED_BUSINESS} AND (lower(b.profile_slug::text) = $1 OR b.id = $2) LIMIT 1`,
    [s, m ? Number(m[1]) : -1]
  );
  return b ? Number(b.id) : null;
}

// ── Directory ───────────────────────────────────────────────────────────────

/**
 * GET /careers/employers: every listed business with at least one public
 * opening (or, with all=true, every verified business), with open-job
 * counts, follower counts and the published review average.
 */
async function directory(db, query = {}) {
  const { size, page, offset } = pageParams(query, { defaultSize: 24, maxSize: 60 });
  const params = [];
  const where = [LISTED_BUSINESS];
  const q = text(query.q, 80);
  if (q) { params.push(`%${q.replace(/[%_\\]/g, '\\$&')}%`); where.push(`b.business_name ILIKE $${params.length}`); }
  if (query.city) { params.push(text(query.city, 80)); where.push(`(lower(b.address_city) = lower($${params.length}) OR lower(b.service_city) = lower($${params.length}))`); }
  if (query.verified === 'true') where.push('b.is_business_verified = TRUE');
  const hiringOnly = query.all !== 'true';
  if (String(query.same_day) === 'true') where.push('COALESCE(ep.same_day_hiring, FALSE) = TRUE');
  const sort = query.sort === 'name' ? 'b.business_name ASC' : query.sort === 'rating' ? 'rating DESC NULLS LAST, open_jobs DESC' : 'open_jobs DESC, b.business_name ASC';
  const base = `
    FROM businesses b
    LEFT JOIN career_employer_profiles ep ON ep.business_id = b.id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS open_jobs FROM career_openings o
       WHERE o.business_id = b.id AND ${PUBLIC_FILTER}
    ) oj ON TRUE
    LEFT JOIN LATERAL (
      SELECT ROUND(AVG(r.overall)::numeric, 1) AS rating, COUNT(*)::int AS review_count
        FROM career_company_reviews r WHERE r.business_id = b.id AND r.status = 'published'
    ) rv ON TRUE
    WHERE ${where.join(' AND ')} ${hiringOnly ? 'AND oj.open_jobs > 0' : 'AND b.is_business_verified = TRUE'}`;
  const { rows: [{ total }] } = await db.query(`SELECT COUNT(*)::int AS total ${base}`, params);
  const { rows } = await db.query(
    `SELECT b.id, b.business_name AS name, ${EMPLOYER_SLUG_SQL} AS slug, b.logo_url, b.profile_headline AS headline,
            COALESCE(b.address_city, b.service_city) AS city, COALESCE(b.address_state, b.service_state) AS region,
            b.industry_category, COALESCE(b.is_business_verified, FALSE) AS verified,
            COALESCE(ep.same_day_hiring, FALSE) AS same_day_hiring,
            oj.open_jobs, rv.rating, rv.review_count,
            (SELECT COUNT(*)::int FROM career_employer_follows f WHERE f.business_id = b.id) AS followers
     ${base}
     ORDER BY ${sort}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, size, offset]
  );
  return { employers: rows, page, pageSize: size, total, pages: Math.max(1, Math.ceil(total / size)) };
}

// ── Public employer page ────────────────────────────────────────────────────

async function ratingSummary(db, businessId) {
  const { rows: [r] } = await db.query(
    `SELECT COUNT(*)::int AS count, ROUND(AVG(overall)::numeric, 2) AS overall,
            ROUND(AVG(work_life)::numeric, 2) AS work_life, ROUND(AVG(pay_benefits)::numeric, 2) AS pay_benefits,
            ROUND(AVG(security_advancement)::numeric, 2) AS security_advancement,
            ROUND(AVG(management)::numeric, 2) AS management, ROUND(AVG(culture)::numeric, 2) AS culture
       FROM career_company_reviews WHERE business_id = $1 AND status = 'published'`,
    [businessId]
  );
  const num = (v) => (v == null ? null : Number(v));
  return {
    count: r.count,
    overall: num(r.overall),
    categories: Object.fromEntries(REVIEW_CATEGORIES.map((k) => [k, num(r[k])])),
  };
}

/**
 * Pay for this employer: posted ranges from its own public openings, plus
 * aggregated individual reports per title once enough people reported.
 */
async function employerSalaries(db, businessId) {
  const { rows: posted } = await db.query(
    `SELECT o.title, o.compensation_min, o.compensation_max, o.compensation_period, o.currency_code
       FROM career_openings o LEFT JOIN businesses b ON b.id = o.business_id
      WHERE o.business_id = $1 AND o.moderation_status = 'ok' AND o.is_internal = FALSE
        AND o.status IN ('open','paused','filled','closed') AND o.compensation_max IS NOT NULL
      ORDER BY COALESCE(o.published_at, o.created_at) DESC LIMIT 200`,
    [businessId]
  );
  const byTitle = new Map();
  for (const o of posted) {
    const key = normalizeTitle(o.title);
    if (!key) continue;
    const e = byTitle.get(key) || { title: o.title, currency_code: o.currency_code, posted: [], reported: [] };
    const lo = toHourly(o.compensation_min, o.compensation_period);
    const hi = toHourly(o.compensation_max, o.compensation_period);
    if (lo != null && hi != null && o.currency_code === e.currency_code) e.posted.push((lo + hi) / 2);
    byTitle.set(key, e);
  }
  const { rows: reports } = await db.query(
    `SELECT job_title_norm, MIN(job_title) AS job_title, currency_code,
            array_agg(pay_amount::float8 ORDER BY id) AS amounts, array_agg(pay_period ORDER BY id) AS periods
       FROM career_salary_reports WHERE business_id = $1 AND status = 'published'
      GROUP BY job_title_norm, currency_code`,
    [businessId]
  );
  for (const r of reports) {
    const e = byTitle.get(r.job_title_norm) || { title: r.job_title, currency_code: r.currency_code, posted: [], reported: [] };
    if (e.currency_code !== r.currency_code) continue;
    r.amounts.forEach((a, i) => { const h = toHourly(a, r.periods[i]); if (h != null) e.reported.push(h); });
    byTitle.set(r.job_title_norm, e);
  }
  return [...byTitle.values()].map((e) => {
    const reported = e.reported.length >= SALARY_MIN_REPORTS ? e.reported.sort((a, b) => a - b) : [];
    const all = [...e.posted, ...reported].sort((a, b) => a - b);
    if (!all.length) return null;
    return {
      title: e.title,
      currency_code: e.currency_code,
      period: 'hourly',
      median: round2(percentile(all, 0.5)),
      low: round2(percentile(all, 0.1)),
      high: round2(percentile(all, 0.9)),
      from_postings: e.posted.length,
      from_reports: reported.length,
    };
  }).filter(Boolean).slice(0, 30);
}

async function publicEmployerPage(db, slug, { viewerId = null } = {}) {
  let businessId = null;
  let isPlatform = false;
  if (String(slug).toLowerCase() === 'oxsteed') isPlatform = true;
  else businessId = await resolveBusinessBySlug(db, slug);
  if (!isPlatform && !businessId) throw notFound('Employer not found');
  if (isPlatform) {
    const { rows: [{ open_jobs: openJobs }] } = await db.query(
      `SELECT COUNT(*)::int AS open_jobs FROM career_openings o LEFT JOIN businesses b ON b.id = o.business_id
        WHERE o.employer_type = 'platform' AND ${PUBLIC_FILTER}`
    );
    const following = viewerId ? (await db.query('SELECT 1 FROM career_employer_follows WHERE user_id = $1 AND is_platform', [viewerId])).rowCount > 0 : false;
    return { employer: { id: null, is_platform: true, name: 'OxSteed', slug: 'oxsteed', verified: true, open_jobs: openJobs, following, followers: (await db.query('SELECT COUNT(*)::int AS n FROM career_employer_follows WHERE is_platform')).rows[0].n } };
  }
  const { rows: [b] } = await db.query(
    `SELECT b.id, b.business_name AS name, ${EMPLOYER_SLUG_SQL} AS slug, b.logo_url, b.cover_image_url,
            b.profile_headline AS headline, b.description, b.website, b.phone, b.industry_category,
            b.address_street, COALESCE(b.address_city, b.service_city) AS city,
            COALESCE(b.address_state, b.service_state) AS region, b.address_country AS country,
            b.service_lat, b.service_lng, COALESCE(b.is_business_verified, FALSE) AS verified,
            b.response_rate, ep.about, ep.why_join, COALESCE(ep.show_phone, FALSE) AS show_phone,
            COALESCE(ep.show_map, FALSE) AS show_map, COALESCE(ep.same_day_hiring, FALSE) AS same_day_hiring
       FROM businesses b LEFT JOIN career_employer_profiles ep ON ep.business_id = b.id
      WHERE b.id = $1 AND ${LISTED_BUSINESS}`,
    [businessId]
  );
  if (!b) throw notFound('Employer not found');
  const { rows: [counts] } = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM career_openings o LEFT JOIN businesses b ON b.id = o.business_id
              WHERE o.business_id = $1 AND ${PUBLIC_FILTER}) AS open_jobs,
            (SELECT COUNT(*)::int FROM career_employer_follows f WHERE f.business_id = $1) AS followers`,
    [businessId]
  );
  const responseTime = await responseSpeed(db, businessId);
  const following = viewerId
    ? (await db.query('SELECT 1 FROM career_employer_follows WHERE user_id = $1 AND business_id = $2', [viewerId, businessId])).rowCount > 0
    : false;
  const employer = {
    id: b.id,
    is_platform: false,
    name: b.name,
    slug: b.slug,
    logo_url: b.logo_url,
    cover_image_url: b.cover_image_url,
    headline: b.headline,
    about: b.about || b.description || null,
    why_join: b.why_join || null,
    website: b.website || null,
    industry_category: b.industry_category,
    city: b.city,
    region: b.region,
    country: b.country,
    verified: b.verified,
    same_day_hiring: b.same_day_hiring,
    // Contact and map only when the business chose to show them.
    phone: b.show_phone ? b.phone || null : null,
    address: b.show_map ? [b.address_street, b.city, b.region].filter(Boolean).join(', ') || null : null,
    map: b.show_map && b.service_lat != null && b.service_lng != null
      ? { lat: Number(b.service_lat), lng: Number(b.service_lng) } : null,
    open_jobs: counts.open_jobs,
    followers: counts.followers,
    following,
    response_speed: responseTime,
  };
  return {
    employer,
    ratings: await ratingSummary(db, businessId),
    salaries: await employerSalaries(db, businessId),
  };
}

/**
 * "Usually responds within N days": median hours from application to the
 * first employer action (view, stage change, message) over the last 90
 * days, shown only with at least 5 applications.
 */
async function responseSpeed(db, businessId) {
  const { rows: [r] } = await db.query(
    `SELECT COUNT(*)::int AS n,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_action - a.created_at)) / 3600) AS median_hours
       FROM career_applications a
       JOIN career_openings o ON o.id = a.opening_id AND o.business_id = $1
       CROSS JOIN LATERAL (
         SELECT LEAST(
           a.employer_viewed_at,
           (SELECT MIN(e.created_at) FROM career_application_events e WHERE e.application_id = a.id AND e.actor_user_id IS DISTINCT FROM a.user_id AND e.from_stage IS NOT NULL),
           (SELECT MIN(m.created_at) FROM career_messages m JOIN career_message_threads t ON t.id = m.thread_id WHERE t.application_id = a.id AND m.sender_side = 'employer')
         ) AS first_action
       ) fa
      WHERE a.created_at > NOW() - INTERVAL '90 days' AND fa.first_action IS NOT NULL`,
    [businessId]
  );
  if (!r || r.n < 5 || r.median_hours == null) return null;
  const hours = Number(r.median_hours);
  return { median_hours: Math.round(hours), days: Math.max(1, Math.ceil(hours / 24)), sample: r.n };
}

async function updateEmployerProfile(db, { businessId, actorId, body }) {
  const about = body.about === undefined ? undefined : (cleanUserText(body.about, 4000).text || null);
  const whyJoin = body.why_join === undefined ? undefined : (cleanUserText(body.why_join, 4000).text || null);
  const { rows: [before] } = await db.query('SELECT * FROM career_employer_profiles WHERE business_id = $1', [businessId]);
  const next = {
    about: about === undefined ? before?.about ?? null : about,
    why_join: whyJoin === undefined ? before?.why_join ?? null : whyJoin,
    show_phone: body.show_phone === undefined ? Boolean(before?.show_phone) : bool(body.show_phone),
    show_map: body.show_map === undefined ? Boolean(before?.show_map) : bool(body.show_map),
    same_day_hiring: body.same_day_hiring === undefined ? Boolean(before?.same_day_hiring) : bool(body.same_day_hiring),
  };
  const { rows: [row] } = await db.query(
    `INSERT INTO career_employer_profiles (business_id, about, why_join, show_phone, show_map, same_day_hiring, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (business_id) DO UPDATE SET about = EXCLUDED.about, why_join = EXCLUDED.why_join,
       show_phone = EXCLUDED.show_phone, show_map = EXCLUDED.show_map, same_day_hiring = EXCLUDED.same_day_hiring,
       updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING *`,
    [businessId, next.about, next.why_join, next.show_phone, next.show_map, next.same_day_hiring, actorId]
  );
  return { before: before || null, after: row };
}

async function getEmployerProfile(db, businessId) {
  const { rows: [row] } = await db.query('SELECT * FROM career_employer_profiles WHERE business_id = $1', [businessId]);
  return row || { business_id: businessId, about: null, why_join: null, show_phone: false, show_map: false, same_day_hiring: false };
}

// ── Reviews ─────────────────────────────────────────────────────────────────

/**
 * Who may review a business: someone with an accepted (current or past)
 * team membership there, or whose application there reached "hired".
 * Owners and current managers can never review their own business.
 */
async function reviewEligibility(db, userId, businessId) {
  const { rows: [u] } = await db.query(
    `SELECT u.created_at, (b.user_id = u.id) AS is_owner,
            EXISTS (SELECT 1 FROM business_members bm WHERE bm.business_id = $2 AND bm.member_id = u.id
                      AND bm.status = 'active' AND bm.role = 'manager') AS is_manager,
            EXISTS (SELECT 1 FROM business_members bm WHERE bm.business_id = $2 AND bm.member_id = u.id
                      AND bm.status = 'active' AND bm.accepted_at IS NOT NULL) AS current_member,
            EXISTS (SELECT 1 FROM business_members bm WHERE bm.business_id = $2 AND bm.member_id = u.id
                      AND bm.status IN ('revoked','expired') AND bm.accepted_at IS NOT NULL) AS former_member,
            EXISTS (SELECT 1 FROM career_applications a JOIN career_openings o ON o.id = a.opening_id
                     WHERE a.user_id = u.id AND o.business_id = $2 AND a.stage = 'hired') AS hired
       FROM users u JOIN businesses b ON b.id = $2
      WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId, businessId]
  );
  if (!u) return { eligible: false, reason: 'not_found' };
  if (u.is_owner || u.is_manager) return { eligible: false, reason: 'own_business' };
  if (new Date(u.created_at) > new Date(Date.now() - ACCOUNT_MIN_AGE_DAYS * 86400000)) return { eligible: false, reason: 'account_too_new' };
  if (u.current_member) return { eligible: true, relationship: 'current' };
  if (u.former_member || u.hired) return { eligible: true, relationship: 'former' };
  return { eligible: false, reason: 'no_work_record' };
}

const rating = (v, key, errors, { required = false } = {}) => {
  if (v === undefined || v === null || v === '') { if (required) errors.add(key, 'Rate from 1 to 5'); return null; }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) { errors.add(key, 'Rate from 1 to 5'); return null; }
  return n;
};

async function submitReview(db, { userId, businessId, body }) {
  const elig = await reviewEligibility(db, userId, businessId);
  if (!elig.eligible) throw new AppError('Only people who worked here can review this employer', 403, 'review_not_eligible', { reason: elig.reason });
  const errors = new FieldErrors();
  const overall = rating(body.overall, 'overall', errors, { required: true });
  const cats = Object.fromEntries(REVIEW_CATEGORIES.map((k) => [k, rating(body[k], k, errors)]));
  const headline = cleanUserText(body.headline, 140);
  if (!headline.text) errors.add('headline', 'Add a short headline');
  const pros = cleanUserText(body.pros, 2000);
  const cons = cleanUserText(body.cons, 2000);
  if (!pros.text && !cons.text) errors.add('pros', 'Tell people something about working here');
  errors.throwIfAny();
  const flagged = [headline, pros, cons].some((t) => t.flags.email || t.flags.url || t.flags.phone);
  const status = flagged ? 'pending' : 'published';
  try {
    const { rows: [row] } = await db.query(
      `INSERT INTO career_company_reviews (business_id, author_user_id, relationship, job_title, overall, work_life, pay_benefits,
         security_advancement, management, culture, headline, pros, cons, status, moderation_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, status`,
      [businessId, userId, elig.relationship, text(body.job_title, 120) || null, overall, cats.work_life, cats.pay_benefits,
        cats.security_advancement, cats.management, cats.culture, headline.text, pros.text || null, cons.text || null,
        status, flagged ? 'contact_details' : null]
    );
    return row;
  } catch (err) {
    if (err.code === '23505') throw new AppError('You already reviewed this employer', 409, 'already_reviewed');
    throw err;
  }
}

function presentReview(r) {
  return {
    id: r.id,
    relationship: r.relationship,
    job_title: r.job_title,
    overall: r.overall,
    ...Object.fromEntries(REVIEW_CATEGORIES.map((k) => [k, r[k]])),
    headline: r.headline,
    pros: r.pros,
    cons: r.cons,
    created_at: r.created_at,
    employer_response: r.employer_response,
    employer_response_at: r.employer_response_at,
  };
}

async function listReviews(db, businessId, query = {}) {
  const { size, page, offset } = pageParams(query, { defaultSize: 10, maxSize: 50 });
  const order = query.sort === 'lowest' ? 'overall ASC, created_at DESC' : query.sort === 'highest' ? 'overall DESC, created_at DESC' : 'created_at DESC';
  const { rows } = await db.query(
    `SELECT * FROM career_company_reviews WHERE business_id = $1 AND status = 'published'
      ORDER BY ${order} LIMIT $2 OFFSET $3`,
    [businessId, size, offset]
  );
  return { reviews: rows.map(presentReview), page, pageSize: size, summary: await ratingSummary(db, businessId) };
}

async function respondToReview(db, { businessId, reviewId, actorId, body }) {
  const id = requireId(reviewId, 'Review not found');
  const response = cleanUserText(body.response, 2000).text;
  if (!response) throw new AppError('Validation failed', 400, 'validation_failed', { response: 'Write a reply' });
  const { rows: [row] } = await db.query(
    `UPDATE career_company_reviews SET employer_response = $3, employer_response_by = $4, employer_response_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND business_id = $2 AND status = 'published' RETURNING id, employer_response, employer_response_at`,
    [id, businessId, response, actorId]
  );
  if (!row) throw notFound('Review not found');
  return row;
}

async function reportReview(db, { reviewId, userId, reason }) {
  const id = requireId(reviewId, 'Review not found');
  if (!REVIEW_REPORT_REASONS.includes(reason)) throw new AppError('Validation failed', 400, 'validation_failed', { reason: 'Choose a reason' });
  const { rows: [review] } = await db.query("SELECT id, author_user_id FROM career_company_reviews WHERE id = $1 AND status = 'published'", [id]);
  if (!review) throw notFound('Review not found');
  if (review.author_user_id === userId) throw new AppError('You cannot report your own review', 409, 'own_review');
  await db.query(
    `INSERT INTO career_company_review_reports (review_id, reporter_user_id, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [id, userId, reason]
  );
  const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::int AS n FROM career_company_review_reports WHERE review_id = $1', [id]);
  if (n >= REVIEW_HIDE_REPORTS) {
    await db.query(
      `UPDATE career_company_reviews SET status = 'pending', moderation_reason = 'reported', updated_at = NOW() WHERE id = $1 AND status = 'published'`,
      [id]
    );
  }
  return { reported: true };
}

// ── Q&A ─────────────────────────────────────────────────────────────────────

async function askQuestion(db, { userId, businessId, body }) {
  const q = cleanUserText(body.body, 500);
  if (!q.text || q.text.length < 10) throw new AppError('Validation failed', 400, 'validation_failed', { body: 'Ask a question of at least 10 characters' });
  const { rows: [{ n }] } = await db.query(
    "SELECT COUNT(*)::int AS n FROM career_company_questions WHERE author_user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'",
    [userId]
  );
  if (n >= 10) throw new AppError('You can ask 10 questions a day', 429, 'question_rate_limited');
  // Questions always go through moderation before they are public.
  const { rows: [row] } = await db.query(
    `INSERT INTO career_company_questions (business_id, author_user_id, body) VALUES ($1, $2, $3) RETURNING id, status`,
    [businessId, userId, q.text]
  );
  return row;
}

async function answerQuestion(db, { userId, businessId, questionId, body, asEmployer }) {
  const id = requireId(questionId, 'Question not found');
  const { rows: [question] } = await db.query(
    "SELECT id FROM career_company_questions WHERE id = $1 AND business_id = $2 AND status = 'published'", [id, businessId]
  );
  if (!question) throw notFound('Question not found');
  const a = cleanUserText(body.body, 1500);
  if (!a.text) throw new AppError('Validation failed', 400, 'validation_failed', { body: 'Write an answer' });
  const flagged = a.flags.email || a.flags.url || a.flags.phone;
  // Employer answers publish at once (they speak for the business and are
  // audited); community answers publish unless they carry contact details.
  const status = asEmployer || !flagged ? 'published' : 'pending';
  const { rows: [row] } = await db.query(
    `INSERT INTO career_company_answers (question_id, author_user_id, as_employer, body, status) VALUES ($1, $2, $3, $4, $5) RETURNING id, status`,
    [id, userId, Boolean(asEmployer), a.text, status]
  );
  return row;
}

async function listQuestions(db, businessId, query = {}) {
  const { size, page, offset } = pageParams(query, { defaultSize: 10, maxSize: 50 });
  const { rows } = await db.query(
    `SELECT q.id, q.body, q.created_at,
            COALESCE((SELECT json_agg(json_build_object('id', a.id, 'body', a.body, 'as_employer', a.as_employer, 'created_at', a.created_at)
                                      ORDER BY a.as_employer DESC, a.created_at)
                        FROM career_company_answers a WHERE a.question_id = q.id AND a.status = 'published'), '[]') AS answers
       FROM career_company_questions q
      WHERE q.business_id = $1 AND q.status = 'published'
      ORDER BY q.created_at DESC LIMIT $2 OFFSET $3`,
    [businessId, size, offset]
  );
  return { questions: rows, page, pageSize: size };
}

// ── Salary reports and insights ─────────────────────────────────────────────

async function submitSalary(db, { userId, businessId, body }) {
  const elig = await reviewEligibility(db, userId, businessId);
  if (!elig.eligible) throw new AppError('Only people who worked here can share pay for this employer', 403, 'salary_not_eligible', { reason: elig.reason });
  const errors = new FieldErrors();
  const title = text(body.job_title, 120);
  if (!title) errors.add('job_title', 'Add your job title');
  const amount = Number(body.pay_amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) errors.add('pay_amount', 'Enter your pay');
  if (!COMPENSATION_PERIODS.includes(body.pay_period)) errors.add('pay_period', 'Choose a pay period');
  const currency = String(body.currency_code || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.add('currency_code', 'Use a 3-letter currency code');
  errors.throwIfAny();
  const { rows: [biz] } = await db.query('SELECT address_country, address_state FROM businesses WHERE id = $1', [businessId]);
  try {
    const { rows: [row] } = await db.query(
      `INSERT INTO career_salary_reports (business_id, author_user_id, job_title, job_title_norm, pay_amount, pay_period, currency_code, country_code, region)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [businessId, userId, title, normalizeTitle(title), Math.round(amount * 100) / 100, body.pay_period, currency,
        /^[A-Z]{2}$/.test(String(biz?.address_country || '').toUpperCase()) ? String(biz.address_country).toUpperCase() : null,
        biz?.address_state || null]
    );
    return row;
  } catch (err) {
    if (err.code === '23505') throw new AppError('You already shared pay for this title here', 409, 'already_reported');
    throw err;
  }
}

/**
 * Salary insights by title (and optional country/region): percentiles of
 * hourly-equivalent pay from public posted ranges, plus individual reports
 * when at least SALARY_MIN_REPORTS exist. Never a single person's figure.
 */
async function salaryInsights(db, query = {}) {
  const title = normalizeTitle(query.title);
  if (!title || title.length < 2) throw new AppError('Validation failed', 400, 'validation_failed', { title: 'Enter a job title' });
  const country = /^[A-Za-z]{2}$/.test(String(query.country || '')) ? String(query.country).toUpperCase() : null;
  const region = text(query.region, 80) || null;
  const currency = /^[A-Za-z]{3}$/.test(String(query.currency || '')) ? String(query.currency).toUpperCase() : 'USD';
  const { rows: posted } = await db.query(
    `SELECT o.compensation_min::float8 AS lo, o.compensation_max::float8 AS hi, o.compensation_period
       FROM career_openings o LEFT JOIN businesses b ON b.id = o.business_id
      WHERE o.moderation_status = 'ok' AND o.is_internal = FALSE AND o.status IN ('open','paused','filled','closed')
        AND o.compensation_max IS NOT NULL AND o.currency_code = $1
        AND (o.title % $2 OR lower(o.title) LIKE '%' || $2 || '%')
        AND ($3::text IS NULL OR o.country_code = $3)
        AND ($4::text IS NULL OR lower(o.region) = lower($4))
        AND COALESCE(o.published_at, o.created_at) > NOW() - INTERVAL '18 months'
      LIMIT 2000`,
    [currency, title, country, region]
  );
  const { rows: reports } = await db.query(
    `SELECT pay_amount::float8 AS amount, pay_period FROM career_salary_reports
      WHERE status = 'published' AND currency_code = $1 AND job_title_norm = $2
        AND ($3::text IS NULL OR country_code = $3) AND ($4::text IS NULL OR lower(region) = lower($4))
        AND created_at > NOW() - INTERVAL '36 months'
      LIMIT 5000`,
    [currency, title, country, region]
  );
  const postedHourly = posted.map((p) => {
    const lo = toHourly(p.lo, p.compensation_period); const hi = toHourly(p.hi, p.compensation_period);
    return lo != null && hi != null ? (lo + hi) / 2 : null;
  }).filter((v) => v != null);
  const reportedHourly = reports.map((r) => toHourly(r.amount, r.pay_period)).filter((v) => v != null);
  const usable = [...postedHourly, ...(reportedHourly.length >= SALARY_MIN_REPORTS ? reportedHourly : [])].sort((a, b) => a - b);
  if (usable.length < 3) return { title: query.title, currency_code: currency, country, region, available: false, sample: usable.length };
  const hourly = { p10: percentile(usable, 0.1), p25: percentile(usable, 0.25), median: percentile(usable, 0.5), p75: percentile(usable, 0.75), p90: percentile(usable, 0.9) };
  const scale = (h) => ({ hourly: round2(h), yearly: Math.round(h * 2080) });
  return {
    title: query.title,
    currency_code: currency,
    country,
    region,
    available: true,
    sample: usable.length,
    from_postings: postedHourly.length,
    from_reports: reportedHourly.length >= SALARY_MIN_REPORTS ? reportedHourly.length : 0,
    percentiles: Object.fromEntries(Object.entries(hourly).map(([k, v]) => [k, scale(v)])),
  };
}

// ── Moderation queue ────────────────────────────────────────────────────────

async function moderationQueue(db) {
  const { rows: reviews } = await db.query(
    `SELECT r.id, r.business_id, b.business_name, r.headline, r.pros, r.cons, r.overall, r.moderation_reason, r.created_at,
            (SELECT COUNT(*)::int FROM career_company_review_reports rr WHERE rr.review_id = r.id) AS reports
       FROM career_company_reviews r JOIN businesses b ON b.id = r.business_id
      WHERE r.status = 'pending' ORDER BY r.created_at ASC LIMIT 100`
  );
  const { rows: questions } = await db.query(
    `SELECT q.id, q.business_id, b.business_name, q.body, q.created_at FROM career_company_questions q JOIN businesses b ON b.id = q.business_id
      WHERE q.status = 'pending' ORDER BY q.created_at ASC LIMIT 100`
  );
  const { rows: answers } = await db.query(
    `SELECT a.id, q.business_id, a.body, a.created_at FROM career_company_answers a JOIN career_company_questions q ON q.id = a.question_id
      WHERE a.status = 'pending' ORDER BY a.created_at ASC LIMIT 100`
  );
  return { reviews, questions, answers };
}

const MODERATION_TABLES = {
  review: { table: 'career_company_reviews', publish: 'published', reject: 'rejected', remove: 'removed' },
  question: { table: 'career_company_questions', publish: 'published', reject: 'removed', remove: 'removed' },
  answer: { table: 'career_company_answers', publish: 'published', reject: 'removed', remove: 'removed' },
  salary: { table: 'career_salary_reports', publish: 'published', reject: 'removed', remove: 'removed' },
};

async function moderate(db, { kind, id, decision, admin, reason }) {
  const cfg = MODERATION_TABLES[kind];
  if (!cfg) throw new AppError('Validation failed', 400, 'validation_failed', { kind: 'Unknown content type' });
  const target = requireId(id, 'Not found');
  if (!['publish', 'reject', 'remove'].includes(decision)) throw new AppError('Validation failed', 400, 'validation_failed', { decision: 'Choose publish, reject or remove' });
  const note = text(reason, 300) || null;
  if (decision !== 'publish' && !note) throw new AppError('Validation failed', 400, 'validation_failed', { reason: 'Say why' });
  const status = cfg[decision];
  const hasModCols = kind !== 'salary';
  const { rows: [row] } = await db.query(
    `UPDATE ${cfg.table} SET status = $2 ${hasModCols ? ', moderated_by = $3, moderated_at = NOW()' : ''}
       ${kind === 'review' ? ', moderation_reason = $4, updated_at = NOW()' : ''}
      WHERE id = $1 RETURNING id, status`,
    hasModCols ? (kind === 'review' ? [target, status, admin.id, note] : [target, status, admin.id]) : [target, status]
  );
  if (!row) throw notFound('Not found');
  if (kind === 'review' && decision === 'publish') await db.query('DELETE FROM career_company_review_reports WHERE review_id = $1', [target]);
  return { ...row, kind, reason: note };
}

module.exports = {
  SALARY_MIN_REPORTS,
  REVIEW_HIDE_REPORTS,
  resolveBusinessBySlug,
  directory,
  publicEmployerPage,
  responseSpeed,
  getEmployerProfile,
  updateEmployerProfile,
  reviewEligibility,
  submitReview,
  listReviews,
  respondToReview,
  reportReview,
  askQuestion,
  answerQuestion,
  listQuestions,
  submitSalary,
  salaryInsights,
  employerSalaries,
  moderationQueue,
  moderate,
};
