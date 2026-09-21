'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const countriesUtil = require('../utils/countries');
const { AppError } = require('../middleware/errorHandler');
const { canEditProfile } = require('../utils/businessOwnership');
const { withTransaction } = require('../utils/transaction');
const {
  EMPLOYMENT_TYPES,
  WORKPLACE_TYPES,
  STAGES,
  WORK_AUTHORIZATION,
  DEPARTMENTS,
  TEAM_ROLES,
  COMPENSATION_PERIODS,
  INTERVIEW_MODES,
  OPENING_STATUSES,
  STAGE_TRANSITIONS,
  slugify,
  getCareerCatalog,
} = require('../services/careerCatalog');

const OPENING_SELECT = `
  o.id, o.employer_type, o.business_id, o.slug, o.title, o.department,
  o.employment_type, o.workplace_type, o.country_code, o.region, o.city,
  o.timezone, o.currency_code, o.compensation_min, o.compensation_max,
  o.compensation_period, o.work_authorization, o.languages, o.description,
  o.requirements, o.benefits, o.team_role, o.status, o.opens_at, o.closes_at,
  o.created_at, o.updated_at,
  b.business_name,
  CASE WHEN o.employer_type = 'platform' THEN 'OxSteed' ELSE b.business_name END AS employer_name
`;

function isPlatformAdmin(user) {
  return user && ['admin', 'super_admin'].includes(user.role);
}

function normalizeCountry(code) {
  if (!code) return null;
  return countriesUtil.normalizeCountry(code, null);
}

function normalizeLanguages(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  const cleaned = [...new Set(list.map((item) => String(item || '').trim().toLowerCase().slice(0, 8)).filter(Boolean))];
  return cleaned.length ? cleaned.slice(0, 8) : ['en'];
}

function publicOpeningFilter() {
  return `
    o.status = 'open'
    AND (o.opens_at IS NULL OR o.opens_at <= NOW())
    AND (o.closes_at IS NULL OR o.closes_at >= NOW())
    AND (o.employer_type = 'platform' OR (b.deleted_at IS NULL AND b.is_active = TRUE))
  `;
}

async function uniqueSlug(client, { employerType, businessId, title, excludeId }) {
  const base = slugify(title);
  for (let i = 0; i < 20; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const { rows } = await client.query(
      employerType === 'platform'
        ? `SELECT id FROM career_openings WHERE employer_type = 'platform' AND slug = $1 AND ($2::bigint IS NULL OR id <> $2)`
        : `SELECT id FROM career_openings WHERE business_id = $1 AND slug = $2 AND ($3::bigint IS NULL OR id <> $3)`,
      employerType === 'platform' ? [candidate, excludeId || null] : [businessId, candidate, excludeId || null]
    );
    if (!rows.length) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function parseOpeningBody(body, { partial = false } = {}) {
  const fields = {};
  if (!partial || body.title != null) {
    const title = String(body.title || '').trim();
    if (!title) fields.title = 'Title is required';
  }
  if (body.employment_type && !EMPLOYMENT_TYPES.includes(body.employment_type)) {
    fields.employment_type = 'Unsupported employment type';
  }
  if (body.workplace_type && !WORKPLACE_TYPES.includes(body.workplace_type)) {
    fields.workplace_type = 'Unsupported workplace type';
  }
  if (body.department && !DEPARTMENTS.includes(body.department)) {
    fields.department = 'Unsupported department';
  }
  if (body.work_authorization && !WORK_AUTHORIZATION.includes(body.work_authorization)) {
    fields.work_authorization = 'Unsupported work authorization';
  }
  if (body.compensation_period && !COMPENSATION_PERIODS.includes(body.compensation_period)) {
    fields.compensation_period = 'Unsupported compensation period';
  }
  if (body.status && !OPENING_STATUSES.includes(body.status)) {
    fields.status = 'Unsupported status';
  }
  if (body.team_role && !TEAM_ROLES.includes(body.team_role)) {
    fields.team_role = 'Unsupported team role';
  }
  if (body.country_code && !normalizeCountry(body.country_code) && body.workplace_type !== 'remote') {
    fields.country_code = 'Use a supported ISO country code';
  }
  if (Object.keys(fields).length) {
    throw new AppError('Validation failed', 400, 'validation_failed', fields);
  }
}

async function assertCanManageOpening(user, opening) {
  if (!user) throw new AppError('Authentication required', 401, 'auth_required');
  if (opening.employer_type === 'platform') {
    if (!isPlatformAdmin(user)) throw new AppError('Insufficient permissions', 403, 'forbidden');
    return { kind: 'platform' };
  }
  const access = await canEditProfile(user.id, opening.business_id);
  if (!access) throw new AppError('Business not found', 404, 'not_found');
  return { kind: 'business', ...access };
}

async function loadOpeningByParam(param) {
  const isNumeric = /^\d+$/.test(String(param || ''));
  const { rows } = await pool.query(
    `SELECT ${OPENING_SELECT}
       FROM career_openings o
       LEFT JOIN businesses b ON b.id = o.business_id
      WHERE ${isNumeric ? 'o.id = $1' : 'o.slug = $1'}
      ORDER BY CASE WHEN o.employer_type = 'platform' THEN 0 ELSE 1 END, o.id DESC
      LIMIT 1`,
    [param]
  );
  return rows[0] || null;
}

function isCurrentlyOpen(opening) {
  if (!opening || opening.status !== 'open') return false;
  const now = Date.now();
  if (opening.opens_at && new Date(opening.opens_at).getTime() > now) return false;
  if (opening.closes_at && new Date(opening.closes_at).getTime() < now) return false;
  return true;
}

function getCatalog(_req, res) {
  return res.json({ catalog: getCareerCatalog() });
}

async function listPublicOpenings(req, res, next) {
  try {
    const employer = req.query.employer === 'business' || req.query.employer === 'platform'
      ? req.query.employer
      : null;
    const country = normalizeCountry(req.query.country);
    const workplace = WORKPLACE_TYPES.includes(req.query.workplace) ? req.query.workplace : null;
    const department = DEPARTMENTS.includes(req.query.department) ? req.query.department : null;
    const q = String(req.query.q || '').trim().slice(0, 80);
    const businessId = req.query.business_id ? parseInt(req.query.business_id, 10) : null;
    const params = [];
    const where = [publicOpeningFilter()];

    if (employer) {
      params.push(employer);
      where.push(`o.employer_type = $${params.length}`);
    }
    if (Number.isFinite(businessId)) {
      params.push(businessId);
      where.push(`o.business_id = $${params.length}`);
    }
    if (country) {
      params.push(country);
      where.push(`(o.country_code = $${params.length} OR o.workplace_type = 'remote')`);
    }
    if (workplace) {
      params.push(workplace);
      where.push(`o.workplace_type = $${params.length}`);
    }
    if (department) {
      params.push(department);
      where.push(`o.department = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(o.title ILIKE $${params.length} OR o.description ILIKE $${params.length} OR COALESCE(b.business_name,'') ILIKE $${params.length})`);
    }

    const { rows } = await pool.query(
      `SELECT ${OPENING_SELECT},
              (SELECT COUNT(*)::int FROM career_applications a WHERE a.opening_id = o.id AND a.stage NOT IN ('withdrawn')) AS application_count
         FROM career_openings o
         LEFT JOIN businesses b ON b.id = o.business_id
        WHERE ${where.join(' AND ')}
        ORDER BY o.updated_at DESC
        LIMIT 100`,
      params
    );
    return res.json({ openings: rows, catalog: getCareerCatalog() });
  } catch (err) {
    next(err);
  }
}

async function getPublicOpening(req, res, next) {
  try {
    const opening = await loadOpeningByParam(req.params.idOrSlug);
    if (!opening || !isCurrentlyOpen(opening)) throw new AppError('Opening not found', 404, 'not_found');
    return res.json({ opening });
  } catch (err) {
    next(err);
  }
}

async function applyToOpening(req, res, next) {
  try {
    const opening = await loadOpeningByParam(req.params.idOrSlug);
    if (!opening || !isCurrentlyOpen(opening)) {
      throw new AppError('This role is not accepting applications', 404, 'not_found');
    }
    const email = String(req.body.email || req.user?.email || '').trim().toLowerCase();
    const firstName = String(req.body.first_name || req.user?.first_name || '').trim();
    const lastName = String(req.body.last_name || req.user?.last_name || '').trim();
    const fields = {};
    if (!email || !email.includes('@')) fields.email = 'A valid email is required';
    if (!firstName) fields.first_name = 'First name is required';
    if (!lastName) fields.last_name = 'Last name is required';
    const coverLetter = String(req.body.cover_letter || '').trim();
    if (!coverLetter) fields.cover_letter = 'Tell us why you want this role';
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    const { rows: [application] } = await pool.query(
      `INSERT INTO career_applications (
          opening_id, user_id, applicant_email, first_name, last_name, phone,
          country_code, city, timezone, locale, resume_url, cover_letter,
          work_authorization_status, willing_to_relocate, languages, source
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        opening.id,
        req.user?.id || null,
        email,
        firstName,
        lastName,
        String(req.body.phone || '').trim() || null,
        normalizeCountry(req.body.country_code) || normalizeCountry(req.user?.country) || null,
        String(req.body.city || '').trim() || null,
        String(req.body.timezone || '').trim() || null,
        String(req.body.locale || req.headers['accept-language'] || 'en').slice(0, 8),
        String(req.body.resume_url || '').trim() || null,
        coverLetter,
        WORK_AUTHORIZATION.includes(req.body.work_authorization_status)
          ? req.body.work_authorization_status
          : 'local_authorized',
        Boolean(req.body.willing_to_relocate),
        normalizeLanguages(req.body.languages),
        String(req.body.source || 'careers').slice(0, 40),
      ]
    );
    await pool.query(
      `INSERT INTO career_application_events (application_id, actor_user_id, from_stage, to_stage, note)
       VALUES ($1,$2,NULL,'received',$3)`,
      [application.id, req.user?.id || null, 'Application received']
    );
    return res.status(201).json({ application: { id: application.id, stage: application.stage, opening_id: opening.id } });
  } catch (err) {
    if (err.code === '23505') {
      return next(new AppError('You already applied to this role', 409, 'already_applied'));
    }
    next(err);
  }
}

async function listMyApplications(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.stage, a.created_at, a.updated_at, a.applicant_email,
              o.id AS opening_id, o.title, o.slug, o.employer_type, o.workplace_type,
              o.city, o.country_code, o.status AS opening_status,
              CASE WHEN o.employer_type = 'platform' THEN 'OxSteed' ELSE b.business_name END AS employer_name,
              (SELECT json_agg(of ORDER BY of.created_at DESC)
                 FROM career_offers of WHERE of.application_id = a.id) AS offers
         FROM career_applications a
         JOIN career_openings o ON o.id = a.opening_id
         LEFT JOIN businesses b ON b.id = o.business_id
        WHERE a.user_id = $1 OR lower(a.applicant_email) = lower($2)
        ORDER BY a.created_at DESC
        LIMIT 100`,
      [req.user.id, req.user.email]
    );
    return res.json({ applications: rows });
  } catch (err) {
    next(err);
  }
}

async function withdrawMyApplication(req, res, next) {
  try {
    const { rows: [application] } = await pool.query(
      `UPDATE career_applications
          SET stage = 'withdrawn', updated_at = NOW()
        WHERE id = $1
          AND stage NOT IN ('hired','withdrawn')
          AND (user_id = $2 OR lower(applicant_email) = lower($3))
        RETURNING id, stage`,
      [req.params.applicationId, req.user.id, req.user.email]
    );
    if (!application) throw new AppError('Application not found', 404, 'not_found');
    await pool.query(
      `INSERT INTO career_application_events (application_id, actor_user_id, from_stage, to_stage, note)
       VALUES ($1,$2,'received','withdrawn','Withdrawn by applicant')`,
      [application.id, req.user.id]
    );
    return res.json({ application });
  } catch (err) {
    next(err);
  }
}

async function listEmployerOpenings(req, res, next) {
  try {
    const requestedBusinessId = req.query.business_id ? parseInt(req.query.business_id, 10) : null;
    if (requestedBusinessId) {
      const access = await canEditProfile(req.user.id, requestedBusinessId);
      if (!access) throw new AppError('Business not found', 404, 'not_found');
      const { rows } = await pool.query(
        `SELECT ${OPENING_SELECT},
                (SELECT COUNT(*)::int FROM career_applications a WHERE a.opening_id = o.id) AS application_count,
                (SELECT COUNT(*)::int FROM career_applications a WHERE a.opening_id = o.id AND a.stage = 'received') AS new_count
           FROM career_openings o
           LEFT JOIN businesses b ON b.id = o.business_id
          WHERE o.business_id = $1
          ORDER BY o.updated_at DESC`,
        [requestedBusinessId]
      );
      return res.json({ openings: rows, catalog: getCareerCatalog(), employer_type: 'business', business_id: requestedBusinessId });
    }
    if (!isPlatformAdmin(req.user)) {
      throw new AppError('business_id is required', 400, 'validation_failed', { business_id: 'Required for business hiring' });
    }
    const { rows } = await pool.query(
      `SELECT ${OPENING_SELECT},
              (SELECT COUNT(*)::int FROM career_applications a WHERE a.opening_id = o.id) AS application_count,
              (SELECT COUNT(*)::int FROM career_applications a WHERE a.opening_id = o.id AND a.stage = 'received') AS new_count
         FROM career_openings o
         LEFT JOIN businesses b ON b.id = o.business_id
        WHERE o.employer_type = 'platform'
        ORDER BY o.updated_at DESC`
    );
    return res.json({ openings: rows, catalog: getCareerCatalog(), employer_type: 'platform' });
  } catch (err) {
    next(err);
  }
}

async function createOpening(req, res, next) {
  try {
    parseOpeningBody(req.body);
    const employerType = req.body.employer_type === 'business' || req.body.business_id ? 'business' : 'platform';
    let businessId = null;
    if (employerType === 'platform') {
      if (!isPlatformAdmin(req.user)) throw new AppError('Insufficient permissions', 403, 'forbidden');
    } else {
      businessId = parseInt(req.body.business_id, 10);
      if (!Number.isFinite(businessId)) {
        throw new AppError('Validation failed', 400, 'validation_failed', { business_id: 'Required' });
      }
      const access = await canEditProfile(req.user.id, businessId);
      if (!access) throw new AppError('Business not found', 404, 'not_found');
    }

    const opening = await withTransaction(pool, async (client) => {
      const slug = await uniqueSlug(client, {
        employerType,
        businessId,
        title: req.body.title,
      });
      const country = normalizeCountry(req.body.country_code);
      const { rows: [row] } = await client.query(
        `INSERT INTO career_openings (
            employer_type, business_id, slug, title, department, employment_type,
            workplace_type, country_code, region, city, timezone, currency_code,
            compensation_min, compensation_max, compensation_period, work_authorization,
            languages, description, requirements, benefits, team_role, status,
            opens_at, closes_at, created_by
         ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
         ) RETURNING *`,
        [
          employerType,
          businessId,
          slug,
          String(req.body.title).trim(),
          DEPARTMENTS.includes(req.body.department) ? req.body.department : 'other',
          EMPLOYMENT_TYPES.includes(req.body.employment_type) ? req.body.employment_type : 'full_time',
          WORKPLACE_TYPES.includes(req.body.workplace_type) ? req.body.workplace_type : 'hybrid',
          country,
          String(req.body.region || '').trim() || null,
          String(req.body.city || '').trim() || null,
          String(req.body.timezone || '').trim() || null,
          String(req.body.currency_code || countriesUtil.getDefaultCurrency(country) || 'USD').toUpperCase().slice(0, 3),
          req.body.compensation_min != null && req.body.compensation_min !== '' ? Number(req.body.compensation_min) : null,
          req.body.compensation_max != null && req.body.compensation_max !== '' ? Number(req.body.compensation_max) : null,
          COMPENSATION_PERIODS.includes(req.body.compensation_period) ? req.body.compensation_period : 'yearly',
          WORK_AUTHORIZATION.includes(req.body.work_authorization) ? req.body.work_authorization : 'local_authorized',
          normalizeLanguages(req.body.languages),
          String(req.body.description || '').trim(),
          String(req.body.requirements || '').trim(),
          String(req.body.benefits || '').trim(),
          TEAM_ROLES.includes(req.body.team_role) ? req.body.team_role : (employerType === 'business' ? 'employee' : null),
          OPENING_STATUSES.includes(req.body.status) ? req.body.status : 'open',
          req.body.opens_at || null,
          req.body.closes_at || null,
          req.user.id,
        ]
      );
      return row;
    }, 'career_opening_create');
    return res.status(201).json({ opening });
  } catch (err) {
    next(err);
  }
}

async function updateOpening(req, res, next) {
  try {
    const opening = await loadOpeningByParam(req.params.id);
    if (!opening) throw new AppError('Opening not found', 404, 'not_found');
    await assertCanManageOpening(req.user, opening);
    parseOpeningBody({ ...opening, ...req.body }, { partial: true });

    const nextTitle = req.body.title != null ? String(req.body.title).trim() : opening.title;
    const slug = req.body.title && nextTitle !== opening.title
      ? await uniqueSlug(pool, {
        employerType: opening.employer_type,
        businessId: opening.business_id,
        title: nextTitle,
        excludeId: opening.id,
      })
      : opening.slug;
    const country = req.body.country_code !== undefined
      ? normalizeCountry(req.body.country_code)
      : opening.country_code;

    const { rows: [updated] } = await pool.query(
      `UPDATE career_openings SET
          slug = $2, title = $3, department = $4, employment_type = $5,
          workplace_type = $6, country_code = $7, region = $8, city = $9,
          timezone = $10, currency_code = $11, compensation_min = $12,
          compensation_max = $13, compensation_period = $14, work_authorization = $15,
          languages = $16, description = $17, requirements = $18, benefits = $19,
          team_role = $20, status = $21, opens_at = $22, closes_at = $23, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [
        opening.id,
        slug,
        nextTitle,
        DEPARTMENTS.includes(req.body.department) ? req.body.department : opening.department,
        EMPLOYMENT_TYPES.includes(req.body.employment_type) ? req.body.employment_type : opening.employment_type,
        WORKPLACE_TYPES.includes(req.body.workplace_type) ? req.body.workplace_type : opening.workplace_type,
        country,
        req.body.region !== undefined ? (String(req.body.region).trim() || null) : opening.region,
        req.body.city !== undefined ? (String(req.body.city).trim() || null) : opening.city,
        req.body.timezone !== undefined ? (String(req.body.timezone).trim() || null) : opening.timezone,
        req.body.currency_code ? String(req.body.currency_code).toUpperCase().slice(0, 3) : opening.currency_code,
        req.body.compensation_min !== undefined
          ? (req.body.compensation_min === '' ? null : Number(req.body.compensation_min))
          : opening.compensation_min,
        req.body.compensation_max !== undefined
          ? (req.body.compensation_max === '' ? null : Number(req.body.compensation_max))
          : opening.compensation_max,
        COMPENSATION_PERIODS.includes(req.body.compensation_period) ? req.body.compensation_period : opening.compensation_period,
        WORK_AUTHORIZATION.includes(req.body.work_authorization) ? req.body.work_authorization : opening.work_authorization,
        req.body.languages ? normalizeLanguages(req.body.languages) : opening.languages,
        req.body.description !== undefined ? String(req.body.description) : opening.description,
        req.body.requirements !== undefined ? String(req.body.requirements) : opening.requirements,
        req.body.benefits !== undefined ? String(req.body.benefits) : opening.benefits,
        req.body.team_role !== undefined
          ? (TEAM_ROLES.includes(req.body.team_role) ? req.body.team_role : null)
          : opening.team_role,
        OPENING_STATUSES.includes(req.body.status) ? req.body.status : opening.status,
        req.body.opens_at !== undefined ? req.body.opens_at || null : opening.opens_at,
        req.body.closes_at !== undefined ? req.body.closes_at || null : opening.closes_at,
      ]
    );
    return res.json({ opening: updated });
  } catch (err) {
    next(err);
  }
}

async function listApplications(req, res, next) {
  try {
    const opening = await loadOpeningByParam(req.params.id);
    if (!opening) throw new AppError('Opening not found', 404, 'not_found');
    await assertCanManageOpening(req.user, opening);
    const stage = STAGES.includes(req.query.stage) ? req.query.stage : null;
    const params = [opening.id];
    let stageSql = '';
    if (stage) {
      params.push(stage);
      stageSql = ` AND a.stage = $2`;
    }
    const { rows: applications } = await pool.query(
      `SELECT a.*, 
              (SELECT json_agg(e ORDER BY e.created_at)
                 FROM career_application_events e WHERE e.application_id = a.id) AS events,
              (SELECT json_agg(i ORDER BY i.scheduled_at)
                 FROM career_interviews i WHERE i.application_id = a.id) AS interviews,
              (SELECT json_agg(of ORDER BY of.created_at DESC)
                 FROM career_offers of WHERE of.application_id = a.id) AS offers
         FROM career_applications a
        WHERE a.opening_id = $1${stageSql}
        ORDER BY a.created_at DESC`,
      params
    );
    return res.json({ opening, applications });
  } catch (err) {
    next(err);
  }
}

async function loadManagedApplication(user, applicationId) {
  const { rows: [application] } = await pool.query(
    `SELECT a.*, o.employer_type, o.business_id, o.team_role AS opening_team_role,
            o.title AS opening_title, o.status AS opening_status
       FROM career_applications a
       JOIN career_openings o ON o.id = a.opening_id
      WHERE a.id = $1`,
    [applicationId]
  );
  if (!application) throw new AppError('Application not found', 404, 'not_found');
  await assertCanManageOpening(user, application);
  return application;
}

async function changeStage(req, res, next) {
  try {
    const application = await loadManagedApplication(req.user, req.params.applicationId);
    const toStage = req.body.stage;
    if (!STAGES.includes(toStage)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { stage: 'Unsupported stage' });
    }
    const allowed = STAGE_TRANSITIONS[application.stage] || [];
    if (!allowed.includes(toStage)) {
      throw new AppError('That stage change is not allowed', 409, 'invalid_transition');
    }
    const { rows: [updated] } = await pool.query(
      `UPDATE career_applications SET stage = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [application.id, toStage]
    );
    await pool.query(
      `INSERT INTO career_application_events (application_id, actor_user_id, from_stage, to_stage, note)
       VALUES ($1,$2,$3,$4,$5)`,
      [application.id, req.user.id, application.stage, toStage, String(req.body.note || '').trim() || null]
    );
    if (toStage === 'hired' && application.employer_type === 'business') {
      await hireIntoBusiness(req.user, updated, application);
    }
    if (toStage === 'filled' || toStage === 'hired') {
      // no-op: hiring a person does not auto-close the opening unless requested
    }
    if (req.body.close_opening && toStage === 'hired') {
      await pool.query(
        `UPDATE career_openings SET status = 'filled', updated_at = NOW() WHERE id = $1`,
        [application.opening_id]
      );
    }
    return res.json({ application: updated });
  } catch (err) {
    next(err);
  }
}

async function hireIntoBusiness(actor, application, openingMeta) {
  const role = TEAM_ROLES.includes(openingMeta.opening_team_role) ? openingMeta.opening_team_role : 'employee';
  const { rows: [biz] } = await pool.query(
    `SELECT id, user_id, business_name FROM businesses WHERE id = $1 AND deleted_at IS NULL`,
    [openingMeta.business_id]
  );
  if (!biz) return;
  const { rows: existing } = await pool.query(
    `SELECT id FROM business_members
      WHERE business_id = $1
        AND status != 'revoked'
        AND (
          (member_id IS NOT NULL AND member_id = $2)
          OR lower(invite_email) = lower($3)
        )
      LIMIT 1`,
    [biz.id, application.user_id || null, application.applicant_email]
  );
  if (!existing.length) {
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1,$2,$3,$4,$5, CASE WHEN $3 IS NULL THEN 'pending' ELSE 'active' END,
               CASE WHEN $3 IS NULL THEN NULL ELSE NOW() END)`,
      [biz.id, biz.user_id, application.user_id || null, role, application.applicant_email]
    );
  }
  if (application.user_id) {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES ($1, 'career_hired', $2, $3, $4)`,
      [
        application.user_id,
        `You were hired at ${biz.business_name}`,
        `Your application for ${openingMeta.opening_title} is now hired as ${role}.`,
        JSON.stringify({ business_id: biz.id, opening_id: application.opening_id, role }),
      ]
    );
  }
  logger.info('career hire converted to team member', {
    businessId: biz.id,
    applicationId: application.id,
    actorId: actor.id,
    role,
  });
}

async function scheduleInterview(req, res, next) {
  try {
    const application = await loadManagedApplication(req.user, req.params.applicationId);
    if (!req.body.scheduled_at) {
      throw new AppError('Validation failed', 400, 'validation_failed', { scheduled_at: 'Required' });
    }
    const mode = INTERVIEW_MODES.includes(req.body.mode) ? req.body.mode : 'video';
    const { rows: [interview] } = await pool.query(
      `INSERT INTO career_interviews (application_id, scheduled_at, timezone, mode, location, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        application.id,
        req.body.scheduled_at,
        String(req.body.timezone || application.timezone || 'UTC'),
        mode,
        String(req.body.location || '').trim() || null,
        String(req.body.notes || '').trim() || null,
        req.user.id,
      ]
    );
    if (application.stage === 'received' || application.stage === 'screening') {
      await pool.query(
        `UPDATE career_applications SET stage = 'interview', updated_at = NOW() WHERE id = $1`,
        [application.id]
      );
      await pool.query(
        `INSERT INTO career_application_events (application_id, actor_user_id, from_stage, to_stage, note)
         VALUES ($1,$2,$3,'interview',$4)`,
        [application.id, req.user.id, application.stage, 'Interview scheduled']
      );
    }
    return res.status(201).json({ interview });
  } catch (err) {
    next(err);
  }
}

async function createOffer(req, res, next) {
  try {
    const application = await loadManagedApplication(req.user, req.params.applicationId);
    const title = String(req.body.title || application.opening_title || '').trim();
    if (!title) throw new AppError('Validation failed', 400, 'validation_failed', { title: 'Required' });
    const { rows: [offer] } = await pool.query(
      `INSERT INTO career_offers (
          application_id, title, currency_code, compensation, compensation_period,
          start_date, expires_at, team_role, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        application.id,
        title,
        String(req.body.currency_code || 'USD').toUpperCase().slice(0, 3),
        req.body.compensation != null && req.body.compensation !== '' ? Number(req.body.compensation) : null,
        COMPENSATION_PERIODS.includes(req.body.compensation_period) ? req.body.compensation_period : 'yearly',
        req.body.start_date || null,
        req.body.expires_at || null,
        TEAM_ROLES.includes(req.body.team_role) ? req.body.team_role : application.opening_team_role,
        req.user.id,
      ]
    );
    if (['received', 'screening', 'interview', 'assessment'].includes(application.stage)) {
      await pool.query(
        `UPDATE career_applications SET stage = 'offer', updated_at = NOW() WHERE id = $1`,
        [application.id]
      );
      await pool.query(
        `INSERT INTO career_application_events (application_id, actor_user_id, from_stage, to_stage, note)
         VALUES ($1,$2,$3,'offer',$4)`,
        [application.id, req.user.id, application.stage, 'Offer created']
      );
    }
    return res.status(201).json({ offer });
  } catch (err) {
    next(err);
  }
}

async function decideOffer(req, res, next) {
  try {
    const { rows: [offer] } = await pool.query(
      `SELECT of.*, a.user_id, a.applicant_email, a.opening_id, a.stage, a.id AS application_id,
              o.employer_type, o.business_id, o.team_role AS opening_team_role, o.title AS opening_title
         FROM career_offers of
         JOIN career_applications a ON a.id = of.application_id
         JOIN career_openings o ON o.id = a.opening_id
        WHERE of.id = $1`,
      [req.params.offerId]
    );
    if (!offer) throw new AppError('Offer not found', 404, 'not_found');
    const decision = req.body.status;
    if (!['accepted', 'declined', 'withdrawn'].includes(decision)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { status: 'Unsupported' });
    }
    const isApplicant = req.user
      && (req.user.id === offer.user_id || String(req.user.email || '').toLowerCase() === String(offer.applicant_email).toLowerCase());
    if (decision === 'withdrawn') {
      await assertCanManageOpening(req.user, offer);
    } else if (!isApplicant) {
      throw new AppError('Only the applicant can accept or decline this offer', 403, 'forbidden');
    }
    const { rows: [updated] } = await pool.query(
      `UPDATE career_offers SET status = $2, decided_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *`,
      [offer.id, decision]
    );
    if (!updated) throw new AppError('Offer is no longer pending', 409, 'conflict');
    if (decision === 'accepted') {
      await pool.query(
        `UPDATE career_applications SET stage = 'hired', updated_at = NOW() WHERE id = $1`,
        [offer.application_id]
      );
      await pool.query(
        `INSERT INTO career_application_events (application_id, actor_user_id, from_stage, to_stage, note)
         VALUES ($1,$2,$3,'hired','Offer accepted')`,
        [offer.application_id, req.user.id, offer.stage]
      );
      if (offer.employer_type === 'business') {
        await hireIntoBusiness(req.user, {
          id: offer.application_id,
          user_id: offer.user_id,
          applicant_email: offer.applicant_email,
          opening_id: offer.opening_id,
        }, offer);
      }
    }
    if (decision === 'declined') {
      await pool.query(
        `UPDATE career_applications SET stage = 'rejected', updated_at = NOW() WHERE id = $1 AND stage = 'offer'`,
        [offer.application_id]
      );
    }
    return res.json({ offer: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getCatalog,
  listPublicOpenings,
  getPublicOpening,
  applyToOpening,
  listMyApplications,
  withdrawMyApplication,
  listEmployerOpenings,
  createOpening,
  updateOpening,
  listApplications,
  changeStage,
  scheduleInterview,
  createOffer,
  decideOffer,
};
