'use strict';

// The worker's career profile (careers spec §4.1, §6.1, §9, §4.9).
// Facts are computed; everything else is "added by you".

const { AppError } = require('../../middleware/errorHandler');
const { FACT_TYPES, PATH_STAGES, VISIBILITY_LEVELS, COMPENSATION_PERIODS } = require('../careerCatalog');
const { FieldErrors, text, bool, codeList, languageList, money, normalizeLocale, normalizeCountry } = require('./validation');
const { ensureProfile, setVisibility, hideFacts, setCareerOffersOptIn, logAccess } = require('./shareLedger');
const { factsForViewer, computeFacts } = require('./profileFacts');
const { resolvePostal } = require('./openings');
const { notifyUser } = require('./notify');

const RESUME_MAX_BYTES = 5 * 1024 * 1024;
const RESUME_MIMES = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const DISPUTE_DAYS = 30;
const DESIRED_EMPLOYMENT = PATH_STAGES.filter((s) => ['shift', 'part_time', 'full_time', 'seasonal', 'temporary'].includes(s));

function sanitizeSummary(value) {
  return text(value, 3000).replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 1500);
}

function parseAvailability(value, errors) {
  if (value == null) return undefined;
  if (!Array.isArray(value)) { errors.add('availability', 'Use weekly time windows'); return undefined; }
  const out = [];
  for (const [i, w] of value.slice(0, 42).entries()) {
    const day = Number(w?.day);
    const start = String(w?.start || '');
    const end = String(w?.end || '');
    if (!Number.isInteger(day) || day < 0 || day > 6) { errors.add(`availability.${i}.day`, 'Pick a day'); continue; }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-4]):[0-5]\d$/.test(end)) { errors.add(`availability.${i}`, 'Use HH:MM'); continue; }
    out.push({ day, start, end });
  }
  return out;
}

async function getProfile(db, userId) {
  await ensureProfile(db, userId);
  const { rows: [profile] } = await db.query(
    `SELECT p.*, sc.visibility AS share_visibility, gc.postal_code, gc.country AS postal_country, gc.place_name
       FROM career_profiles p
       LEFT JOIN career_profile_share_current sc ON sc.user_id = p.user_id
       LEFT JOIN geo_postal_centroids gc ON gc.id = p.postal_centroid_id
      WHERE p.user_id = $1`,
    [userId]
  );
  const { facts } = await factsForViewer(db, userId, { includeHidden: true });
  const { rows: disputes } = await db.query(
    `SELECT id, fact_type, fact_id, status, hide_while_reviewing, due_at, created_at, resolved_at, resolution_note
       FROM career_fact_disputes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [userId]
  );
  const { rows: mutes } = await db.query(
    `SELECT m.business_id, b.business_name, m.created_at FROM career_profile_mutes m
       JOIN businesses b ON b.id = m.business_id WHERE m.user_id = $1 ORDER BY m.created_at DESC`,
    [userId]
  );
  const hasResume = Boolean(profile.resume_storage_key);
  delete profile.resume_storage_key;
  return { profile: { ...profile, has_resume: hasResume }, facts, disputes, mutes };
}

async function updateProfile(db, userId, body, { req } = {}) {
  await ensureProfile(db, userId);
  const errors = new FieldErrors();
  const sets = [];
  const params = [userId];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (body.headline !== undefined) set('headline', text(body.headline, 200).replace(/<[^>]*>/g, '').trim().slice(0, 120) || null);
  if (body.summary !== undefined) set('summary', sanitizeSummary(body.summary) || null);
  if (body.desired_roles !== undefined) set('desired_roles', codeList(body.desired_roles, 20));
  if (body.skill_codes !== undefined) set('skill_codes', codeList(body.skill_codes, 50));
  if (body.desired_employment !== undefined) {
    const list = (Array.isArray(body.desired_employment) ? body.desired_employment : []).filter((s) => DESIRED_EMPLOYMENT.includes(s));
    set('desired_employment', [...new Set(list)]);
  }
  const availability = parseAvailability(body.availability, errors);
  if (availability !== undefined) set('availability', JSON.stringify(availability));
  if (body.travel_radius_km !== undefined) {
    const r = body.travel_radius_km === null || body.travel_radius_km === '' ? null : Number(body.travel_radius_km);
    if (r != null && (!Number.isInteger(r) || r < 1 || r > 500)) errors.add('travel_radius_km', 'Between 1 and 500 km');
    else set('travel_radius_km', r);
  }
  if (body.languages !== undefined) set('languages', languageList(body.languages));
  if (body.min_pay !== undefined) {
    const pay = money(body.min_pay, 'min_pay', errors);
    const period = body.min_pay_period || 'hourly';
    if (!COMPENSATION_PERIODS.includes(period)) errors.add('min_pay_period', 'Choose a pay period');
    if (pay !== undefined) { set('min_pay_cents', pay == null ? null : Math.round(pay * 100)); set('min_pay_period', pay == null ? null : period); }
  }
  if (body.open_to_work !== undefined) set('open_to_work', bool(body.open_to_work));
  if (body.email_invitations !== undefined) set('email_invitations', bool(body.email_invitations));
  if (body.profile_locale !== undefined) set('profile_locale', normalizeLocale(body.profile_locale));
  if (body.postal_code !== undefined) {
    if (!body.postal_code) set('postal_centroid_id', null);
    else {
      const country = normalizeCountry(body.country_code);
      if (!country) errors.add('country_code', 'Pick a country');
      else {
        const c = await resolvePostal(db, { postal: body.postal_code, country });
        if (!c) errors.add('postal_code', 'We could not find that postal code');
        else set('postal_centroid_id', c.id);
      }
    }
  }
  if (body.visibility !== undefined && !VISIBILITY_LEVELS.includes(body.visibility)) errors.add('visibility', 'Choose a visibility level');
  if (body.hidden_fact_types !== undefined && (!Array.isArray(body.hidden_fact_types) || body.hidden_fact_types.some((t) => !FACT_TYPES.includes(t)))) {
    errors.add('hidden_fact_types', 'Unknown fact');
  }
  errors.throwIfAny();
  if (body.privacy_notice_version) set('privacy_notice_version', text(body.privacy_notice_version, 40));
  set('last_active_at', new Date());
  await db.query(`UPDATE career_profiles SET ${sets.join(', ')}, updated_at = NOW() WHERE user_id = $1`, params);
  if (body.visibility !== undefined) {
    const { rows: [cur] } = await db.query('SELECT visibility FROM career_profile_share_current WHERE user_id = $1', [userId]);
    if (cur?.visibility !== body.visibility) await setVisibility(db, userId, body.visibility, { req });
  }
  if (body.hidden_fact_types !== undefined) await hideFacts(db, userId, body.hidden_fact_types, { req });
  if (body.career_offers_opt_in !== undefined) await setCareerOffersOptIn(db, userId, bool(body.career_offers_opt_in), { req });
  return getProfile(db, userId);
}

/** Exactly what one business would see (§4.1 step 5). */
async function previewAs(db, userId, businessId) {
  const { rows: [sc] } = await db.query('SELECT visibility FROM career_profile_share_current WHERE user_id = $1', [userId]);
  const { rows: [biz] } = await db.query('SELECT id, business_name FROM businesses WHERE id = $1 AND deleted_at IS NULL', [businessId]);
  if (!biz) throw new AppError('Business not found', 404, 'not_found');
  const { rows: [muted] } = await db.query('SELECT 1 FROM career_profile_mutes WHERE user_id = $1 AND business_id = $2', [userId, businessId]);
  const viewer = await factsForViewer(db, userId, { businessId });
  const { rows: [p] } = await db.query('SELECT headline, summary, desired_roles, languages, skill_codes FROM career_profiles WHERE user_id = $1', [userId]);
  return {
    business: biz,
    visibility: sc?.visibility || 'private',
    muted: Boolean(muted),
    // When applying, these are the default shares; in talent lists only
    // known_businesses/searchable profiles appear, and never employer-only facts.
    facts: viewer.facts.map((f) => ({ fact_type: f.fact_type, category: f.category, value: f.value, sample_size: f.sample_size })),
    employer_only_facts: viewer.employerFacts,
    added_by_you: p || null,
  };
}

async function accessLog(db, userId) {
  const { rows } = await db.query(
    `SELECT l.context, l.business_id, b.business_name, l.application_id, l.fact_types, l.created_at
       FROM career_profile_access_log l LEFT JOIN businesses b ON b.id = l.business_id
      WHERE l.subject_user_id = $1 ORDER BY l.created_at DESC LIMIT 200`,
    [userId]
  );
  return rows;
}

/** POST /me/profile/resume. PDF or DOCX up to 5 MB, already virus-scanned. */
async function saveResume(db, userId, file, { uploadImpl, enqueueDeletion }) {
  if (!file || !file.buffer) throw new AppError('Validation failed', 400, 'validation_failed', { resume: 'Choose a file' });
  const mime = String(file.detectedMime || file.mimetype || '').toLowerCase();
  if (!RESUME_MIMES.has(mime)) throw new AppError('Validation failed', 400, 'validation_failed', { resume: 'Upload a PDF or DOCX' });
  if (file.size > RESUME_MAX_BYTES || file.buffer.length > RESUME_MAX_BYTES) throw new AppError('Validation failed', 400, 'validation_failed', { resume: 'Up to 5 MB' });
  await ensureProfile(db, userId);
  const filename = text(file.originalname, 160).replace(/[^\w.\- ]+/g, '_') || 'resume';
  const key = await uploadImpl(file.buffer, `career-resumes/${userId}`, filename, mime);
  if (!key) throw new AppError('Upload failed', 500, 'upload_failed');
  const { rows: [old] } = await db.query('SELECT resume_storage_key FROM career_profiles WHERE user_id = $1 FOR UPDATE', [userId]);
  await db.query(
    'UPDATE career_profiles SET resume_storage_key = $2, resume_filename = $3, updated_at = NOW() WHERE user_id = $1',
    [userId, key, filename]
  );
  // A key still referenced by a submitted application is kept until that
  // application's retention ends; otherwise the old file is deleted.
  if (old?.resume_storage_key && old.resume_storage_key !== key) {
    const { rows: [used] } = await db.query('SELECT 1 FROM career_applications WHERE resume_storage_key = $1 LIMIT 1', [old.resume_storage_key]);
    if (!used) await enqueueDeletion(old.resume_storage_key, 'career_resume_replaced', { client: db });
  }
  return { has_resume: true, resume_filename: filename };
}

async function deleteResume(db, userId, { enqueueDeletion }) {
  const { rows: [old] } = await db.query('SELECT resume_storage_key FROM career_profiles WHERE user_id = $1 FOR UPDATE', [userId]);
  if (!old?.resume_storage_key) return { has_resume: false };
  await db.query('UPDATE career_profiles SET resume_storage_key = NULL, resume_filename = NULL, updated_at = NOW() WHERE user_id = $1', [userId]);
  const { rows: [used] } = await db.query('SELECT 1 FROM career_applications WHERE resume_storage_key = $1 LIMIT 1', [old.resume_storage_key]);
  if (!used) await enqueueDeletion(old.resume_storage_key, 'career_resume_deleted', { client: db });
  return { has_resume: false };
}

/** §9.3: flag a fact as wrong; resolved within 30 days (FCRA timeline). */
async function createDispute(db, userId, body) {
  const errors = new FieldErrors();
  if (!FACT_TYPES.includes(body.fact_type)) errors.add('fact_type', 'Pick the fact');
  const reason = text(body.reason, 1000).replace(/<[^>]*>/g, '');
  if (!reason) errors.add('reason', 'Tell us what is wrong');
  const factId = body.fact_id == null || body.fact_id === '' ? null : Number(body.fact_id);
  if (factId != null && !Number.isInteger(factId)) errors.add('fact_id', 'Pick the fact');
  errors.throwIfAny();
  let sourceRef = null;
  if (factId != null) {
    const { rows: [fact] } = await db.query('SELECT source, source_ref FROM career_profile_facts WHERE id = $1 AND user_id = $2', [factId, userId]);
    if (!fact) throw new AppError('Fact not found', 404, 'not_found');
    sourceRef = { source: fact.source, ...(fact.source_ref || {}) };
  }
  const { rows: [open] } = await db.query(
    `SELECT id FROM career_fact_disputes WHERE user_id = $1 AND fact_type = $2 AND fact_id IS NOT DISTINCT FROM $3 AND status = 'open'`,
    [userId, body.fact_type, factId]
  );
  if (open) throw new AppError('You already have an open dispute for this fact', 409, 'dispute_exists');
  const { rows: [dispute] } = await db.query(
    `INSERT INTO career_fact_disputes (user_id, fact_type, fact_id, source_ref, reason, hide_while_reviewing, due_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + make_interval(days => $7::int)) RETURNING *`,
    [userId, body.fact_type, factId, sourceRef ? JSON.stringify(sourceRef) : null, reason, bool(body.hide_while_reviewing), DISPUTE_DAYS]
  );
  return dispute;
}

async function resolveDispute(db, { disputeId, admin, outcome, note }) {
  if (!['upheld', 'rejected'].includes(outcome)) throw new AppError('Validation failed', 400, 'validation_failed', { outcome: 'upheld or rejected' });
  const { rows: [dispute] } = await db.query(
    `UPDATE career_fact_disputes SET status = $2, resolution_note = $3, resolved_by = $4, resolved_at = NOW()
      WHERE id = $1 AND status = 'open' RETURNING *`,
    [disputeId, outcome, text(note, 1000) || null, admin.id]
  );
  if (!dispute) throw new AppError('Dispute not found', 404, 'not_found');
  // Upheld: recompute from source so a corrected record replaces the fact.
  if (outcome === 'upheld') await computeFacts(db, dispute.user_id);
  await notifyUser(db, {
    userId: dispute.user_id,
    type: 'career_fact_dispute_resolved',
    params: { factType: dispute.fact_type, outcome },
    actionUrl: '/careers/me/profile',
    deliveryKey: `career_dispute:${dispute.id}`,
  });
  return dispute;
}

/**
 * My growth (§4.9, §11): credentials, what's expiring, and skills that
 * open roles near you ask for. Area counts only, never people (§11.2).
 */
async function growth(db, userId) {
  const { facts } = await factsForViewer(db, userId, { includeHidden: true });
  const credentials = facts.filter((f) => ['badge', 'certificate', 'training_completed'].includes(f.fact_type));
  const soon = Date.now() + 30 * 86_400_000;
  const expiring = credentials.filter((f) => f.value?.expires_at && new Date(f.value.expires_at).getTime() <= soon);
  const have = new Set(credentials.map((f) => String(f.value?.code || f.category || '').toLowerCase()).filter(Boolean));
  const { rows: [p] } = await db.query(
    `SELECT p.postal_centroid_id, COALESCE(p.travel_radius_km, 15) AS radius, p.career_offers_opt_in
       FROM career_profiles p WHERE p.user_id = $1`,
    [userId]
  );
  let inDemand = [];
  if (p?.postal_centroid_id) {
    const { rows } = await db.query(
      `SELECT code, COUNT(*)::int AS openings
         FROM career_openings o
         JOIN geo_postal_centroids me ON me.id = $1
         LEFT JOIN geo_postal_centroids oc ON oc.id = o.postal_centroid_id
         CROSS JOIN LATERAL unnest(COALESCE(o.required_credentials, '{}') || COALESCE(o.preferred_credentials, '{}')) AS code
        WHERE o.status = 'open' AND o.moderation_status = 'ok' AND o.is_internal = FALSE
          AND oc.geog IS NOT NULL AND ST_DWithin(oc.geog, me.geog, $2::int * 1000)
        GROUP BY code HAVING COUNT(*) >= 3
        ORDER BY COUNT(*) DESC LIMIT 10`,
      [p.postal_centroid_id, p.radius]
    );
    inDemand = rows.map((r) => ({ code: r.code, openings: r.openings, you_have_it: have.has(String(r.code).toLowerCase()), radius_km: Number(p.radius) }));
  }
  return { credentials, expiring, in_demand_near_you: inDemand, career_offers_opt_in: Boolean(p?.career_offers_opt_in) };
}

/** Employer download of an applicant's résumé (signed URL, logged). */
async function applicationResumeUrl(db, { app, viewer, businessId, signImpl }) {
  if (!app.resume_storage_key) throw new AppError('No résumé file on this application', 404, 'not_found');
  if (app.hide_identity_until_offer && !['offer', 'hired', 'offer_declined'].includes(app.stage)) {
    throw new AppError('Résumés are hidden until an offer on this opening', 403, 'identity_hidden');
  }
  if (app.user_id) await logAccess(db, { viewerUserId: viewer.id, businessId, subjectUserId: app.user_id, context: 'application', applicationId: app.id, factTypes: [] });
  return { url: await signImpl(app.resume_storage_key, 300), expires_in: 300 };
}

module.exports = {
  RESUME_MAX_BYTES,
  DISPUTE_DAYS,
  sanitizeSummary,
  getProfile,
  updateProfile,
  previewAs,
  accessLog,
  saveResume,
  deleteResume,
  createDispute,
  resolveDispute,
  growth,
  applicationResumeUrl,
};
