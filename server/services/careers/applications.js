'use strict';

// Applying, withdrawing and the employer pipeline (careers spec §4.2,
// §4.4, §7; fixes C-02, C-03, C-07, C-08, C-09, C-13, C-14, C-15).

const crypto = require('crypto');
const { AppError } = require('../../middleware/errorHandler');
const {
  STAGE_TRANSITIONS, BULK_NEUTRAL_STAGES, REJECTION_REASONS, ACTIVE_STAGES, FINAL_STAGES, INTERVIEW_MODES, FACT_TYPES,
} = require('../careerCatalog');
const { FieldErrors, text, bool, idList, languageList, safeHttpsUrl, normalizeLocale, isValidTimeZone } = require('./validation');
const { assertAdult } = require('./ageGate');
const { factsForViewer } = require('./profileFacts');
const { shareWithApplication, logAccess, hash: sha256 } = require('./shareLedger');
const { saveResponses } = require('./eeo');
const { stampDecision } = require('./retention');
const { notifyApplicant, notifyHiringTeam } = require('./notify');
const { buildInterviewIcs, icsAttachment } = require('./ics');
const { locationsInScope } = require('./access');

const DAILY_APPLY_LIMIT = 20;
const GUEST_EMAIL_DAILY_LIMIT = 3;
const GUEST_IP_DAILY_LIMIT = 10;
const GUEST_TOKEN_TTL_HOURS = 24;

function employerName(opening) {
  return opening.employer_type === 'platform' ? 'OxSteed' : (opening.employer_name || opening.business_name || '');
}

// The answers every applicant gives (C-15): two lawful questions, the
// stores they prefer, languages, a note and an optional https résumé link.
function parseApplicationAnswers(body, opening) {
  const errors = new FieldErrors();
  if (body.authorized_to_work === undefined || body.authorized_to_work === null || body.authorized_to_work === '') {
    errors.add('authorized_to_work', `Answer whether you are authorized to work in ${opening.country_code || 'this country'}`);
  }
  if (body.needs_sponsorship === undefined || body.needs_sponsorship === null || body.needs_sponsorship === '') {
    errors.add('needs_sponsorship', 'Answer whether you will need sponsorship');
  }
  const preferred = idList(body.preferred_location_ids, 'preferred_location_ids', errors) || [];
  const openingStores = (opening.location_ids || []).map(Number);
  if (preferred.some((id) => !openingStores.includes(id))) errors.add('preferred_location_ids', 'Pick stores listed on this opening');
  const resumeUrl = safeHttpsUrl(body.resume_url, 'resume_url', errors);
  const cover = text(body.cover_letter, 5000);
  return {
    errors,
    value: {
      authorized_to_work: bool(body.authorized_to_work),
      needs_sponsorship: bool(body.needs_sponsorship),
      preferred_location_ids: preferred,
      languages: languageList(body.languages),
      cover_letter: cover || null,
      resume_url: resumeUrl || null,
      accommodation_requested: bool(body.accommodation_requested),
      ai_notice_shown: bool(body.ai_notice_shown),
    },
  };
}

async function nextApplicantNumber(db, openingId) {
  // The opening row lock serialises numbering per opening.
  await db.query('SELECT id FROM career_openings WHERE id = $1 FOR UPDATE', [openingId]);
  const { rows: [r] } = await db.query('SELECT COALESCE(MAX(applicant_number), 0) + 1 AS n FROM career_applications WHERE opening_id = $1', [openingId]);
  return Number(r.n);
}

async function recordEvent(db, { applicationId, actorId, from, to, note = null, reasonCode = null, metadata = null }) {
  await db.query(
    `INSERT INTO career_application_events (application_id, actor_user_id, from_stage, to_stage, note, reason_code, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [applicationId, actorId, from, to, note, reasonCode, metadata ? JSON.stringify(metadata) : null]
  );
}

async function linkInvitation(db, { invitationId, userId, opening }) {
  if (!invitationId) return null;
  const { rows: [inv] } = await db.query(
    `UPDATE career_invitations SET status = 'applied', responded_at = NOW()
      WHERE id = $1 AND user_id = $2 AND business_id IS NOT DISTINCT FROM $3
        AND (opening_id IS NULL OR opening_id = $4) AND status IN ('sent','viewed') AND expires_at > NOW()
      RETURNING id`,
    [invitationId, userId, opening.business_id, opening.id]
  );
  return inv ? inv.id : null;
}

/**
 * Apply with an account (the default). The snapshot freezes exactly the
 * facts the worker chose to share with this employer (§4.2 step 4).
 */
async function applyAsUser(db, { opening, user, body, req }) {
  if (!opening.is_accepting) throw new AppError('This role is not accepting applications', 404, 'not_found');
  await assertAdult(db, user.id);
  const { rows: [today] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM career_applications WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
    [user.id]
  );
  if (today.n >= DAILY_APPLY_LIMIT) throw new AppError('You have reached today\'s application limit', 429, 'apply_rate_limited');

  const { errors, value } = parseApplicationAnswers(body, opening);
  const eeo = body.eeo && typeof body.eeo === 'object' ? body.eeo : null;
  if (eeo && opening.country_code !== 'US') errors.add('eeo', 'The voluntary EEO form is only offered on US openings');
  errors.throwIfAny();

  const { rows: [account] } = await db.query(
    'SELECT id, email, first_name, last_name, phone, preferred_language FROM users WHERE id = $1',
    [user.id]
  );
  const { rows: [profile] } = await db.query(
    'SELECT headline, summary, skill_codes, languages, desired_roles, visibility, resume_storage_key FROM career_profiles WHERE user_id = $1',
    [user.id]
  );
  const viewer = await factsForViewer(db, user.id, { businessId: opening.business_id });
  // Default share set: everything visible unless the worker narrowed it.
  const requested = Array.isArray(body.share_fact_types) ? body.share_fact_types.filter((t) => FACT_TYPES.includes(t)) : null;
  const shared = viewer.facts.filter((f) => (requested ? requested.includes(f.fact_type) : true));
  const factTypes = [...new Set(shared.map((f) => f.fact_type))];
  const snapshot = {
    captured_at: new Date().toISOString(),
    facts: shared.map((f) => ({ fact_type: f.fact_type, category: f.category, value: f.value, sample_size: f.sample_size, source: f.source, verified: true })),
    added_by_you: profile ? { headline: profile.headline, summary: profile.summary } : null,
    skill_codes: profile?.skill_codes || [],
  };
  const applicantNumber = await nextApplicantNumber(db, opening.id);
  let application;
  try {
    ({ rows: [application] } = await db.query(
      `INSERT INTO career_applications (
         opening_id, user_id, applicant_email, first_name, last_name, phone, country_code, city, timezone, locale,
         resume_url, resume_storage_key, cover_letter, work_authorization_status, willing_to_relocate, languages,
         stage, source, profile_snapshot, preferred_location_ids, work_auth_country, authorized_to_work,
         needs_sponsorship, accommodation_requested, ai_notice_shown, applicant_number, is_guest
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'received',$17,$18,$19,$20,$21,$22,$23,$24,$25,FALSE)
       RETURNING *`,
      [
        opening.id, user.id, String(account.email).toLowerCase(), account.first_name || '', account.last_name || '',
        text(body.phone, 40) || account.phone || null,
        body.country_code ? String(body.country_code).toUpperCase().slice(0, 2) : null,
        text(body.city, 120) || null,
        isValidTimeZone(body.timezone) ? body.timezone : null,
        normalizeLocale(body.locale || account.preferred_language || req?.headers?.['accept-language']),
        value.resume_url, profile?.resume_storage_key || null, value.cover_letter,
        value.authorized_to_work && !value.needs_sponsorship ? 'local_authorized' : 'visa_sponsorship',
        bool(body.willing_to_relocate),
        value.languages.length ? value.languages.map((l) => l.split(':')[0]) : (profile?.languages || []),
        body.invitation_id ? 'invitation' : 'careers',
        JSON.stringify(snapshot), value.preferred_location_ids, opening.country_code || null,
        value.authorized_to_work, value.needs_sponsorship, value.accommodation_requested,
        value.ai_notice_shown || Boolean(opening.ai_ranking_enabled), applicantNumber,
      ]
    ));
  } catch (err) {
    if (err.code === '23505') throw new AppError('You already applied to this role', 409, 'already_applied');
    throw err;
  }
  const event = await shareWithApplication(db, user.id, {
    applicationId: application.id, businessId: opening.business_id, openingId: opening.id, factTypes, req,
  });
  const invitationId = await linkInvitation(db, { invitationId: body.invitation_id, userId: user.id, opening });
  await db.query('UPDATE career_applications SET share_event_id = $2, invitation_id = $3 WHERE id = $1', [application.id, event.id, invitationId]);
  await recordEvent(db, { applicationId: application.id, actorId: user.id, from: null, to: 'received' });
  if (eeo) await saveResponses(db, application.id, eeo);
  await notifyApplicant(db, application, {
    type: 'career_application_received',
    params: { openingTitle: opening.title, employerName: employerName(opening) },
    deliveryKey: `career_app_received:${application.id}`,
  });
  await notifyHiringTeam(db, opening, {
    type: 'career_new_applicant',
    params: { openingTitle: opening.title, applicantNumber },
    actionUrl: opening.employer_type === 'platform' ? '/admin/careers' : `/business/${opening.business_id}/careers`,
    deliveryKey: `career_new_applicant:${application.id}`,
  });
  return { ...application, share_event_id: event.id, invitation_id: invitationId };
}

// ── Guest apply (Q3) ─────────────────────────────────────────────────────────

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function guestDetails(body, opening) {
  const errors = new FieldErrors();
  const email = text(body.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.add('email', 'Enter a valid email');
  const firstName = text(body.first_name, 80);
  const lastName = text(body.last_name, 80);
  if (!firstName) errors.add('first_name', 'First name is required');
  if (!lastName) errors.add('last_name', 'Last name is required');
  if (!bool(body.age_attested)) errors.add('age_attested', 'Confirm you are 18 or older');
  const { errors: answerErrors, value } = parseApplicationAnswers(body, opening);
  Object.assign(errors.fields, answerErrors.fields, errors.fields);
  return { errors, email, firstName, lastName, value };
}

/**
 * Start a guest application: validate, rate-limit, store the payload and
 * email a one-time link. Nothing reaches the employer until confirmed.
 */
async function startGuestApplication(db, { opening, body, ipHash, sendEmail }) {
  if (!opening.is_accepting) throw new AppError('This role is not accepting applications', 404, 'not_found');
  if (!opening.allow_guest_applications) throw new AppError('This opening needs an OxSteed account to apply', 403, 'guest_not_allowed');
  if (body.eeo) throw new AppError('Validation failed', 400, 'validation_failed', { eeo: 'Create an account to fill in the voluntary EEO form' });
  const { errors, email, firstName, lastName, value } = guestDetails(body, opening);
  errors.throwIfAny();
  const { rows: [counts] } = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM career_guest_apply_requests WHERE lower(email) = $1 AND created_at > NOW() - INTERVAL '24 hours') AS by_email,
       (SELECT COUNT(*)::int FROM career_guest_apply_requests WHERE ip_hash = $2 AND created_at > NOW() - INTERVAL '24 hours') AS by_ip`,
    [email, ipHash]
  );
  if (counts.by_email >= GUEST_EMAIL_DAILY_LIMIT || (ipHash && counts.by_ip >= GUEST_IP_DAILY_LIMIT)) {
    throw new AppError('Too many guest applications today. Try again tomorrow or create an account.', 429, 'guest_rate_limited');
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const payload = { first_name: firstName, last_name: lastName, phone: text(body.phone, 40) || null, city: text(body.city, 120) || null, ...value };
  const locale = normalizeLocale(body.locale);
  await db.query(
    `INSERT INTO career_guest_apply_requests (opening_id, email, token_hash, ip_hash, payload, locale, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + make_interval(hours => $7::int))`,
    [opening.id, email, hashToken(token), ipHash, JSON.stringify(payload), locale, GUEST_TOKEN_TTL_HOURS]
  );
  await sendEmail({ to: email, token, locale, opening });
  return { sent: true, expiresInHours: GUEST_TOKEN_TTL_HOURS };
}

async function confirmGuestApplication(db, { opening, token }) {
  if (!token) throw new AppError('Validation failed', 400, 'validation_failed', { token: 'Missing confirmation link' });
  const { rows: [request] } = await db.query(
    `SELECT * FROM career_guest_apply_requests WHERE token_hash = $1 AND opening_id = $2 FOR UPDATE`,
    [hashToken(token), opening.id]
  );
  if (!request || new Date(request.expires_at) < new Date()) throw new AppError('This link has expired. Start again.', 410, 'guest_token_expired');
  if (request.confirmed_at) return { application_id: request.application_id, replayed: true };
  if (!opening.is_accepting || !opening.allow_guest_applications) throw new AppError('This role is not accepting applications', 404, 'not_found');
  const p = request.payload;
  const applicantNumber = await nextApplicantNumber(db, opening.id);
  let application;
  try {
    ({ rows: [application] } = await db.query(
      `INSERT INTO career_applications (
         opening_id, user_id, applicant_email, first_name, last_name, phone, city, locale, resume_url, cover_letter,
         work_authorization_status, languages, stage, source, profile_snapshot, preferred_location_ids, work_auth_country,
         authorized_to_work, needs_sponsorship, accommodation_requested, ai_notice_shown, applicant_number,
         is_guest, guest_email_verified_at, guest_age_attested
       ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'received', 'guest', NULL, $12, $13, $14, $15, $16, $17, $18,
                 TRUE, NOW(), TRUE)
       RETURNING *`,
      [
        opening.id, request.email, p.first_name, p.last_name, p.phone, p.city, request.locale, p.resume_url, p.cover_letter,
        p.authorized_to_work && !p.needs_sponsorship ? 'local_authorized' : 'visa_sponsorship',
        (p.languages || []).map((l) => String(l).split(':')[0]), p.preferred_location_ids || [], opening.country_code || null,
        p.authorized_to_work, p.needs_sponsorship, p.accommodation_requested, Boolean(opening.ai_ranking_enabled), applicantNumber,
      ]
    ));
  } catch (err) {
    if (err.code === '23505') throw new AppError('An application with this email is already open for this role', 409, 'already_applied');
    throw err;
  }
  await db.query('UPDATE career_guest_apply_requests SET confirmed_at = NOW(), application_id = $2 WHERE id = $1', [request.id, application.id]);
  await recordEvent(db, { applicationId: application.id, actorId: null, from: null, to: 'received', note: null, metadata: { guest: true } });
  await notifyApplicant(db, application, {
    type: 'career_application_received',
    params: { openingTitle: opening.title, employerName: employerName(opening) },
    deliveryKey: `career_app_received:${application.id}`,
  });
  await notifyHiringTeam(db, opening, {
    type: 'career_new_applicant',
    params: { openingTitle: opening.title, applicantNumber },
    actionUrl: opening.employer_type === 'platform' ? '/admin/careers' : `/business/${opening.business_id}/careers`,
    deliveryKey: `career_new_applicant:${application.id}`,
  });
  return { application_id: application.id, replayed: false };
}

/**
 * A guest claims their applications by signing up with the same email,
 * once that email is verified on the account.
 */
async function claimGuestApplications(db, user) {
  if (!user?.email || !user.email_verified) return 0;
  const { rowCount } = await db.query(
    `UPDATE career_applications SET user_id = $1, updated_at = NOW()
      WHERE user_id IS NULL AND is_guest = TRUE AND lower(applicant_email) = lower($2) AND anonymized_at IS NULL`,
    [user.id, user.email]
  );
  return rowCount || 0;
}

// ── Worker views ─────────────────────────────────────────────────────────────

// C-07: account holders see applications by user_id only, never by email.
async function listMine(db, userId) {
  const { rows } = await db.query(
    `SELECT a.id, a.opening_id, a.stage, a.created_at, a.updated_at, a.rejection_reason_code,
            a.rejection_requirement, a.rejection_fact_type, a.is_guest, a.applicant_number,
            o.title, o.slug, o.employer_type, o.business_id, o.workplace_type, o.city, o.country_code,
            o.compensation_min, o.compensation_max, o.compensation_period, o.currency_code, o.timezone,
            CASE WHEN o.employer_type = 'platform' THEN 'OxSteed' ELSE b.business_name END AS employer_name,
            COALESCE(json_agg(DISTINCT jsonb_build_object(
              'id', of.id, 'status', of.status, 'title', of.title, 'pay_cents', of.pay_cents,
              'pay_period', of.pay_period, 'currency_code', of.currency_code, 'start_date', of.start_date,
              'expires_at', of.expires_at, 'location_id', of.location_id, 'team_role', of.team_role,
              'conditions', of.conditions, 'is_conditional', of.is_conditional, 'first_shift', of.first_shift,
              'employer_model', of.employer_model, 'created_at', of.created_at
            )) FILTER (WHERE of.id IS NOT NULL AND of.status <> 'awaiting_approval'), '[]') AS offers,
            COALESCE(json_agg(DISTINCT jsonb_build_object(
              'id', i.id, 'scheduled_at', i.scheduled_at, 'timezone', i.timezone, 'mode', i.mode,
              'location', i.location, 'status', i.status, 'duration_minutes', i.duration_minutes
            )) FILTER (WHERE i.id IS NOT NULL), '[]') AS interviews,
            (SELECT COALESCE(json_agg(json_build_object('to_stage', e.to_stage, 'created_at', e.created_at) ORDER BY e.created_at), '[]')
               FROM career_application_events e WHERE e.application_id = a.id) AS timeline,
            (SELECT r.id FROM career_onboarding_runs r WHERE r.application_id = a.id) AS onboarding_run_id
       FROM career_applications a
       JOIN career_openings o ON o.id = a.opening_id
       LEFT JOIN businesses b ON b.id = o.business_id
       LEFT JOIN career_offers of ON of.application_id = a.id
       LEFT JOIN career_interviews i ON i.application_id = a.id AND i.cancelled_at IS NULL
      WHERE a.user_id = $1
      GROUP BY a.id, o.id, b.business_name
      ORDER BY a.created_at DESC
      LIMIT 200`,
    [userId]
  );
  return rows;
}

async function lockOwnApplication(db, applicationId, userId) {
  const { rows: [app] } = await db.query(
    `SELECT a.*, o.title AS opening_title, o.employer_type, o.business_id, o.created_by AS opening_created_by,
            o.location_ids AS opening_location_ids
       FROM career_applications a JOIN career_openings o ON o.id = a.opening_id
      WHERE a.id = $1 AND a.user_id = $2
      FOR UPDATE OF a`,
    [applicationId, userId]
  );
  if (!app) throw new AppError('Application not found', 404, 'not_found');
  return app;
}

/**
 * Withdraw (C-03): any pending offer is withdrawn in the same transaction,
 * and any background-check invitation is cancelled.
 */
async function withdrawMine(db, { applicationId, userId }) {
  const app = await lockOwnApplication(db, applicationId, userId);
  if (FINAL_STAGES.includes(app.stage)) throw new AppError('This application is already closed', 409, 'invalid_transition');
  const { rows: [updated] } = await db.query(
    `UPDATE career_applications SET stage = 'withdrawn', updated_at = NOW() WHERE id = $1 RETURNING *`,
    [app.id]
  );
  const { rows: offers } = await db.query(
    `UPDATE career_offers SET status = 'withdrawn', decided_at = NOW(), withdrawn_reason = 'candidate_withdrew'
      WHERE application_id = $1 AND status IN ('pending','awaiting_approval') RETURNING id`,
    [app.id]
  );
  await db.query(
    `UPDATE career_background_checks SET status = 'cancelled', updated_at = NOW()
      WHERE application_id = $1 AND status IN ('invited','consented','pending')`,
    [app.id]
  );
  await recordEvent(db, { applicationId: app.id, actorId: userId, from: app.stage, to: 'withdrawn', reasonCode: 'withdrew_interest', metadata: { offers_withdrawn: offers.length } });
  await stampDecision(db, app.id, { decidedBy: userId });
  await notifyHiringTeam(db, { employer_type: app.employer_type, business_id: app.business_id, created_by: app.opening_created_by, location_ids: app.opening_location_ids }, {
    type: 'career_application_withdrawn',
    params: { openingTitle: app.opening_title, applicantNumber: app.applicant_number },
    deliveryKey: `career_withdrawn:${app.id}`,
  });
  return { application: updated, offersWithdrawn: offers.length };
}

// ── Employer pipeline ────────────────────────────────────────────────────────

const ROLE_SELECT = `
  a.*, o.employer_type, o.business_id, o.team_role AS opening_team_role, o.title AS opening_title,
  o.status AS opening_status, o.location_ids AS opening_location_ids, o.timezone AS opening_timezone,
  o.hide_identity_until_offer, o.currency_code AS opening_currency, o.compensation_min, o.compensation_max,
  o.compensation_period AS opening_period, o.background_check_required, o.background_check_package,
  o.employer_model AS opening_employer_model, o.required_credentials, o.preferred_credentials,
  o.required_languages, o.sponsorship_available, o.country_code AS opening_country, o.region AS opening_region,
  o.city AS opening_city, o.path_stage, o.job_role_code AS opening_job_role, o.created_by AS opening_created_by,
  o.id AS opening_row_id,
  CASE WHEN o.employer_type = 'platform' THEN 'OxSteed' ELSE b.business_name END AS employer_name
`;

async function loadApplicationForEmployer(db, applicationId, { lock = false } = {}) {
  if (!/^\d+$/.test(String(applicationId))) throw new AppError('Application not found', 404, 'not_found');
  const { rows: [app] } = await db.query(
    `SELECT ${ROLE_SELECT}
       FROM career_applications a
       JOIN career_openings o ON o.id = a.opening_id
       LEFT JOIN businesses b ON b.id = o.business_id
      WHERE a.id = $1 ${lock ? 'FOR UPDATE OF a' : ''}`,
    [applicationId]
  );
  if (!app) throw new AppError('Application not found', 404, 'not_found');
  return app;
}

function openingView(app) {
  return {
    id: app.opening_id, employer_type: app.employer_type, business_id: app.business_id, team_role: app.opening_team_role,
    location_ids: app.opening_location_ids, created_by: app.opening_created_by, title: app.opening_title,
  };
}

// Store managers see applicants for their own stores only (§4.7 step 3):
// applicants who named preferred stores must overlap the manager's scope.
function applicationInScope(access, app) {
  if (!access || access.kind === 'platform' || access.isOwner) return true;
  const mode = access.scope?.mode;
  if (mode === 'business' || mode === 'brand') return true;
  const preferred = (app.preferred_location_ids || []).map(Number);
  const allowed = new Set(access.scope.locationIds || []);
  if (!preferred.length) return locationsInScope(access, app.opening_location_ids || []);
  return preferred.some((id) => allowed.has(id));
}

/**
 * Employer card for one application. Identity is hidden until an offer
 * when the opening says so (Q8); EEO answers are never included.
 */
function presentForEmployer(app, { checklist = null, interviews = [], offers = [], events = [] } = {}) {
  const hide = app.hide_identity_until_offer && !['offer', 'hired', 'offer_declined'].includes(app.stage);
  const label = `#${app.applicant_number || app.id}`;
  return {
    id: app.id,
    opening_id: app.opening_id,
    applicant_number: app.applicant_number,
    display_name: hide ? null : `${app.first_name || ''} ${app.last_name || ''}`.trim() || label,
    identity_hidden: hide,
    email: hide ? null : app.applicant_email,
    phone: hide ? null : app.phone,
    city: app.city,
    country_code: app.country_code,
    timezone: app.timezone,
    languages: app.languages,
    stage: app.stage,
    source: app.source,
    is_guest: app.is_guest,
    verified_label: app.is_guest ? 'guest_not_verified' : 'account',
    authorized_to_work: app.authorized_to_work,
    needs_sponsorship: app.needs_sponsorship,
    work_auth_country: app.work_auth_country,
    preferred_location_ids: app.preferred_location_ids,
    cover_letter: app.cover_letter,
    has_resume: Boolean(app.resume_storage_key || app.resume_url),
    resume_url: hide ? null : app.resume_url,
    accommodation_requested: app.accommodation_requested,
    shared_facts: app.is_guest ? [] : (app.profile_snapshot?.facts || []),
    added_by_applicant: app.profile_snapshot?.added_by_you || null,
    checklist,
    rejection_reason_code: app.rejection_reason_code,
    created_at: app.created_at,
    updated_at: app.updated_at,
    interviews,
    offers,
    events,
    anonymized: Boolean(app.anonymized_at),
  };
}

/**
 * Employer stage change (C-02, C-13). 'hired' can't be set here; reject
 * needs a reason code and an explicit confirmation; the candidate is told
 * in their own language.
 */
async function changeStage(db, { app, actor, toStage, body }) {
  if (toStage === 'hired') throw new AppError('Only the candidate can accept an offer; there is no employer hire button', 409, 'hire_requires_acceptance');
  const allowed = STAGE_TRANSITIONS[app.stage] || [];
  if (!allowed.includes(toStage)) throw new AppError(`Can't move from ${app.stage} to ${toStage}`, 409, 'invalid_transition');
  const reasonCode = toStage === 'rejected' ? String(body.reason_code || '') : null;
  let requirement = null;
  let factType = null;
  if (toStage === 'rejected') {
    const errors = new FieldErrors();
    if (!REJECTION_REASONS.includes(reasonCode)) errors.add('reason_code', 'Choose a reason');
    if (!bool(body.confirm)) errors.add('confirm', 'Confirm the rejection');
    if (reasonCode === 'requirements_not_met') {
      requirement = text(body.requirement, 120);
      if (!requirement) errors.add('requirement', 'Name the requirement that was not met');
    }
    if (body.fact_type) {
      factType = FACT_TYPES.includes(body.fact_type) ? body.fact_type : null;
      if (!factType) errors.add('fact_type', 'Unknown fact');
    }
    errors.throwIfAny();
  }
  const { rows: [updated] } = await db.query(
    `UPDATE career_applications
        SET stage = $2, rejection_reason_code = $3, rejection_requirement = $4, rejection_fact_type = $5, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [app.id, toStage, reasonCode, requirement, factType]
  );
  if (toStage === 'rejected') {
    await db.query(
      `UPDATE career_offers SET status = 'withdrawn', decided_at = NOW(), withdrawn_reason = 'application_rejected'
        WHERE application_id = $1 AND status IN ('pending','awaiting_approval')`,
      [app.id]
    );
    await stampDecision(db, app.id, { decidedBy: actor.id });
  }
  await recordEvent(db, { applicationId: app.id, actorId: actor.id, from: app.stage, to: toStage, reasonCode, metadata: requirement || factType ? { requirement, fact_type: factType } : null });
  const params = { openingTitle: app.opening_title, employerName: app.employer_name };
  if (toStage === 'rejected') {
    await notifyApplicant(db, app, {
      type: 'career_application_rejected',
      // FCRA (§12.8): when a shared fact was the reason, the notice says
      // which fact and links to the dispute flow from My applications.
      params: { ...params, reasonCode, factType, requirement },
      deliveryKey: `career_rejected:${app.id}`,
    });
  } else {
    await notifyApplicant(db, app, { type: 'career_stage_changed', params, deliveryKey: `career_stage:${app.id}:${toStage}` });
  }
  return updated;
}

function parseInterview(body, app) {
  const errors = new FieldErrors();
  const when = new Date(body.scheduled_at);
  if (!body.scheduled_at || Number.isNaN(when.getTime())) errors.add('scheduled_at', 'Pick a valid date and time');
  else if (when.getTime() < Date.now() - 5 * 60_000) errors.add('scheduled_at', 'Pick a time in the future');
  const timezone = body.timezone || app.opening_timezone || 'UTC';
  if (!isValidTimeZone(timezone)) errors.add('timezone', 'Use an IANA time zone such as America/New_York');
  const mode = body.mode || 'video';
  if (!INTERVIEW_MODES.includes(mode)) errors.add('mode', 'Choose video, phone or onsite');
  const duration = body.duration_minutes == null ? 30 : Number(body.duration_minutes);
  if (!Number.isInteger(duration) || duration < 10 || duration > 240) errors.add('duration_minutes', 'Between 10 and 240 minutes');
  const location = text(body.location, 500) || null;
  if (location && mode === 'video') {
    try { const u = new URL(location); if (u.protocol !== 'https:') errors.add('location', 'Use an https:// meeting link'); } catch { errors.add('location', 'Use an https:// meeting link'); }
  }
  errors.throwIfAny();
  return { when, timezone, mode, duration, location, notes: text(body.notes, 2000) || null };
}

function formatWhen(date, timezone, locale) {
  try {
    return new Intl.DateTimeFormat(locale || 'en', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(date);
  } catch {
    return date.toISOString();
  }
}

async function scheduleInterview(db, { app, actor, body }) {
  if (!ACTIVE_STAGES.includes(app.stage) || app.stage === 'offer') throw new AppError('Interviews can only be booked for active applications', 409, 'invalid_transition');
  const v = parseInterview(body, app);
  const uid = `career-interview-${crypto.randomUUID()}@oxsteed.com`;
  const { rows: [interview] } = await db.query(
    `INSERT INTO career_interviews (application_id, scheduled_at, timezone, mode, location, notes, created_by, duration_minutes, ics_uid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [app.id, v.when.toISOString(), v.timezone, v.mode, v.location, v.notes, actor.id, v.duration, uid]
  );
  if (['received', 'screening'].includes(app.stage)) {
    await db.query(`UPDATE career_applications SET stage = 'interview', updated_at = NOW() WHERE id = $1`, [app.id]);
    await recordEvent(db, { applicationId: app.id, actorId: actor.id, from: app.stage, to: 'interview', metadata: { interview_id: interview.id } });
  }
  const ics = buildInterviewIcs({
    uid, start: v.when, durationMinutes: v.duration, summary: `Interview: ${app.opening_title}`,
    description: `${app.employer_name} · ${v.mode}`, location: v.location, organizerName: app.employer_name,
  });
  await notifyApplicant(db, app, {
    type: 'career_interview_scheduled',
    params: { openingTitle: app.opening_title, employerName: app.employer_name, when: formatWhen(v.when, v.timezone, app.locale), timezone: v.timezone },
    deliveryKey: `career_interview:${interview.id}`,
    attachments: [icsAttachment(ics)],
  });
  return { interview, ics };
}

async function cancelInterview(db, { app, actor, interviewId }) {
  const { rows: [interview] } = await db.query(
    `UPDATE career_interviews SET status = 'cancelled', cancelled_at = NOW()
      WHERE id = $1 AND application_id = $2 AND cancelled_at IS NULL RETURNING *`,
    [interviewId, app.id]
  );
  if (!interview) throw new AppError('Interview not found', 404, 'not_found');
  const ics = buildInterviewIcs({ uid: interview.ics_uid || `career-interview-${interview.id}@oxsteed.com`, start: interview.scheduled_at, durationMinutes: interview.duration_minutes, summary: `Interview: ${app.opening_title}`, method: 'CANCEL', sequence: 1 });
  await notifyApplicant(db, app, {
    type: 'career_interview_cancelled',
    params: { openingTitle: app.opening_title, employerName: app.employer_name },
    deliveryKey: `career_interview_cancel:${interview.id}`,
    attachments: [icsAttachment(ics, 'interview-cancelled.ics')],
  });
  await recordEvent(db, { applicationId: app.id, actorId: actor.id, from: app.stage, to: app.stage, note: null, metadata: { interview_cancelled: interview.id } });
  return interview;
}

module.exports = {
  DAILY_APPLY_LIMIT,
  GUEST_EMAIL_DAILY_LIMIT,
  GUEST_IP_DAILY_LIMIT,
  BULK_NEUTRAL_STAGES,
  employerName,
  parseApplicationAnswers,
  recordEvent,
  applyAsUser,
  hashToken,
  startGuestApplication,
  confirmGuestApplication,
  claimGuestApplications,
  listMine,
  lockOwnApplication,
  withdrawMine,
  loadApplicationForEmployer,
  openingView,
  applicationInScope,
  presentForEmployer,
  changeStage,
  scheduleInterview,
  cancelInterview,
  sha256,
};
