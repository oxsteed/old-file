'use strict';

// Employment background checks through Checkr (careers spec §12.4, Q10).
// Only after a conditional offer that lists the check, only for roles where
// the business gave a reason, only where Checkr and the law allow it. The
// report stays at Checkr: OxSteed stores status words and timestamps.

const { AppError } = require('../../middleware/errorHandler');
const checkr = require('./providers/checkr');
const { recordEvent } = require('./applications');
const { notifyApplicant, notifyHiringTeam } = require('./notify');

// v1 markets for employment checks. EU/UK need a lawful, proportionate
// role AND the DPIA (outside work), so they stay off until legal adds them.
const CHECK_COUNTRIES = Object.freeze(['US']);
const ACTIVE_CHECK_STATUSES = Object.freeze(['invited', 'consented', 'pending']);

function openingShape(app) {
  return { employer_type: app.employer_type, business_id: app.business_id, created_by: app.opening_created_by, location_ids: app.opening_location_ids };
}

/**
 * Start a check for an application (§7 POST /employer/applications/:id/background-check).
 * `app` comes from loadApplicationForEmployer (locked).
 */
async function requestCheck(db, { app, actor, settings, inviteImpl = checkr.inviteCandidate }) {
  if (app.employer_type !== 'business') throw new AppError('Background checks are for business openings', 409, 'not_available');
  if (!app.background_check_required || !app.background_check_package) {
    throw new AppError('This opening does not list a background check', 409, 'check_not_listed');
  }
  if (!settings?.background_checks_enabled) throw new AppError('Turn on background checks in careers settings first', 409, 'checks_disabled');
  if (!settings.permissible_purpose_certified_at) {
    throw new AppError('Certify your permissible purpose in careers settings first', 409, 'permissible_purpose_required');
  }
  if (!CHECK_COUNTRIES.includes(String(app.opening_country || '').toUpperCase())) {
    throw new AppError('Background checks are not offered in this country yet', 409, 'check_country_unsupported');
  }
  if (!app.user_id) throw new AppError('The candidate needs an OxSteed account before a check', 409, 'account_required');
  // Fair chance: only after a conditional offer that lists the check.
  const { rows: [offer] } = await db.query(
    `SELECT * FROM career_offers
      WHERE application_id = $1 AND status IN ('pending','accepted') AND 'background_check' = ANY(conditions)
      ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [app.id]
  );
  if (!offer || app.stage !== 'offer') {
    throw new AppError('A check can only start after a conditional offer that lists it', 409, 'conditional_offer_required');
  }
  const { rows: [existing] } = await db.query(
    `SELECT id, status FROM career_background_checks WHERE offer_id = $1 AND status <> 'cancelled'`, [offer.id]
  );
  if (existing) throw new AppError('A check already exists for this offer', 409, 'check_exists');

  let invitation;
  try {
    invitation = await inviteImpl({
      accountRef: settings.checkr_account_ref,
      packageSlug: app.background_check_package,
      candidate: { email: app.applicant_email, first_name: app.first_name, last_name: app.last_name },
      workLocation: { country: app.opening_country, state: app.opening_region, city: app.opening_city },
    });
  } catch (err) {
    if (err.code === 'provider_not_configured') {
      throw new AppError('Checkr is not connected for this business', 503, 'provider_not_configured', { reason: err.reason });
    }
    throw new AppError('Checkr could not start the check. Try again.', 502, 'provider_error');
  }
  const { rows: [check] } = await db.query(
    `INSERT INTO career_background_checks
       (application_id, offer_id, business_id, user_id, provider, provider_candidate_id, provider_invitation_id,
        invitation_url, package, status, requested_by)
     VALUES ($1, $2, $3, $4, 'checkr', $5, $6, $7, $8, 'invited', $9) RETURNING *`,
    [app.id, offer.id, app.business_id, app.user_id, invitation.candidateId, invitation.invitationId,
      invitation.invitationUrl, app.background_check_package, actor.id]
  );
  await recordEvent(db, { applicationId: app.id, actorId: actor.id, from: app.stage, to: app.stage, metadata: { background_check: 'invited', check_id: check.id } });
  await notifyApplicant(db, app, {
    type: 'career_background_check_invited',
    params: { employerName: app.employer_name, openingTitle: app.opening_title },
    deliveryKey: `career_bgc_invited:${check.id}`,
  });
  return publicCheck(check);
}

// Only status words and dates leave the server, never package internals.
function publicCheck(check) {
  if (!check) return null;
  return {
    id: check.id, application_id: check.application_id, offer_id: check.offer_id, status: check.status,
    provider: check.provider, invitation_url: check.invitation_url, package: check.package,
    consent_at: check.consent_at, pre_adverse_at: check.pre_adverse_at, adverse_at: check.adverse_at,
    completed_at: check.completed_at, created_at: check.created_at, updated_at: check.updated_at,
  };
}

async function listForWorker(db, userId) {
  const { rows } = await db.query(
    `SELECT c.*, CASE WHEN o.employer_type = 'platform' THEN 'OxSteed' ELSE b.business_name END AS employer_name, o.title AS opening_title
       FROM career_background_checks c
       JOIN career_applications a ON a.id = c.application_id
       JOIN career_openings o ON o.id = a.opening_id
       LEFT JOIN businesses b ON b.id = c.business_id
      WHERE c.user_id = $1
      ORDER BY c.created_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    ...publicCheck(r), employer_name: r.employer_name, opening_title: r.opening_title,
    // The worker views or disputes the report at Checkr.
    report_portal_url: 'https://candidate.checkr.com/',
  }));
}

// Only the employer that ordered the check sees it, on that application.
async function statusForApplication(db, { applicationId, businessId }) {
  const { rows: [row] } = await db.query(
    `SELECT * FROM career_background_checks WHERE application_id = $1 AND business_id = $2 ORDER BY id DESC LIMIT 1`,
    [applicationId, businessId]
  );
  return publicCheck(row);
}

const STATUS_COLUMNS = {
  consented: 'consent_at',
  pre_adverse_sent: 'pre_adverse_at',
  adverse_sent: 'adverse_at',
  clear: 'completed_at',
  consider: 'completed_at',
};

/**
 * Apply a verified Checkr webhook. Idempotent by provider event id.
 * `finalize` is offers.finalizeHire bound with startRun.
 */
async function applyWebhook(db, event, { finalize }) {
  const mapped = checkr.mapEvent(event);
  if (!mapped) return { ignored: true };
  const { rows: [check] } = await db.query(
    `SELECT * FROM career_background_checks
      WHERE provider = 'checkr'
        AND ((provider_invitation_id IS NOT NULL AND provider_invitation_id = $1)
          OR (provider_report_id IS NOT NULL AND provider_report_id = $2)
          OR (provider_candidate_id IS NOT NULL AND provider_candidate_id = $3 AND status <> 'cancelled'))
      ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [mapped.invitationId || null, mapped.reportId || null, mapped.candidateId || null]
  );
  if (!check) return { ignored: true, reason: 'unknown_check' };
  const { rows: [logged] } = await db.query(
    `INSERT INTO career_background_check_events (background_check_id, provider_event_id, event_type, status)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id`,
    [check.id, event.id ? String(event.id) : null, String(event.type || '').slice(0, 80), mapped.status]
  );
  if (!logged) return { duplicate: true };
  if (check.status === 'cancelled' && mapped.status !== 'cancelled') return { ignored: true, reason: 'cancelled' };
  const column = STATUS_COLUMNS[mapped.status];
  const { rows: [updated] } = await db.query(
    `UPDATE career_background_checks
        SET status = $2, provider_report_id = COALESCE(provider_report_id, $3), updated_at = NOW()
            ${column ? `, ${column} = COALESCE(${column}, NOW())` : ''}
      WHERE id = $1 RETURNING *`,
    [check.id, mapped.status, mapped.reportId || null]
  );
  const { rows: [app] } = await db.query(
    `SELECT a.*, o.title AS opening_title, o.employer_type, o.business_id, o.created_by AS opening_created_by,
            o.location_ids AS opening_location_ids,
            CASE WHEN o.employer_type = 'platform' THEN 'OxSteed' ELSE b.business_name END AS employer_name
       FROM career_applications a JOIN career_openings o ON o.id = a.opening_id LEFT JOIN businesses b ON b.id = o.business_id
      WHERE a.id = $1 FOR UPDATE OF a`,
    [check.application_id]
  );
  if (!app) return { check: publicCheck(updated) };
  await recordEvent(db, { applicationId: app.id, actorId: null, from: app.stage, to: app.stage, metadata: { background_check: mapped.status, check_id: check.id } });
  await notifyHiringTeam(db, openingShape(app), {
    type: 'career_background_check_update',
    params: { openingTitle: app.opening_title, applicantNumber: app.applicant_number, status: mapped.status },
    deliveryKey: `career_bgc:${check.id}:${mapped.status}`,
  });
  if (mapped.status === 'pre_adverse_sent') {
    // Checkr sends the legal notice with the report and Summary of Rights;
    // this in-app note points the worker to it and to the dispute path.
    await notifyApplicant(db, app, {
      type: 'career_pre_adverse_notice',
      params: { employerName: app.employer_name, openingTitle: app.opening_title },
      deliveryKey: `career_bgc_pre_adverse:${check.id}`,
    });
  }
  let hire = null;
  if (mapped.status === 'clear') {
    const { rows: [offer] } = await db.query('SELECT * FROM career_offers WHERE id = $1 FOR UPDATE', [check.offer_id]);
    if (offer && offer.status === 'accepted' && app.stage === 'offer') {
      hire = await finalize(db, { app, offer, actorId: null });
    }
  }
  return { check: publicCheck(updated), hire };
}

module.exports = {
  CHECK_COUNTRIES,
  ACTIVE_CHECK_STATUSES,
  requestCheck,
  publicCheck,
  listForWorker,
  statusForApplication,
  applyWebhook,
};
