const db = require('../db');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const { consultantEnforcement, requestsEnabled } = require('../services/access/flags');
const { checkPayingAccess } = require('../services/access/consultantGate');

const REFERRAL_STATUSES = [
  'assigned',
  'intro_pending',
  'intro_sent',
  'discovery_scheduled',
  'proposal_sent',
  'engaged',
  'won',
  'lost',
  'completed',
  'paused',
];

const PAYING_STATUSES = new Set(['engaged', 'won']);
const isAdmin = (user) => ['admin', 'super_admin'].includes(user.role);

function splitList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }

  return String(value || '')
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sanitizeCountry(code) {
  const value = String(code || '').trim().toUpperCase();
  return value.length === 2 ? value : null;
}

async function getProfileWithIdentity(userId) {
  const { rows } = await db.query(
    `SELECT
       u.id,
       u.first_name,
       u.last_name,
       u.email,
       p.headline,
       p.bio,
       p.home_country,
       p.home_region,
       p.home_city,
       p.coverage_countries,
       p.coverage_regions,
       p.languages,
       p.specialties,
       p.years_experience,
       p.default_oxsteed_cut_bps,
       p.minimum_package_price_cents,
       p.active_referral_limit,
       p.accepts_new_referrals,
       p.accepts_virtual_consulting,
       p.is_active,
       p.timezone,
       p.created_at,
       p.updated_at
     FROM users u
     LEFT JOIN consultant_contractor_profiles p ON p.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );

  return rows[0] || null;
}

async function logReferralEvent(client, { requestId, actorId, eventType, noteText, metadata }) {
  await client.query(
    `INSERT INTO consulting_request_referral_log (request_id, actor_id, event_type, note_text, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [requestId, actorId, eventType, noteText, JSON.stringify(metadata)]
  );
}

exports.getMyConsultantProfile = async (req, res) => {
  try {
    const profile = await getProfileWithIdentity(req.user.id);
    if (!profile) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.json({
      profile: {
        ...profile,
        coverage_countries: profile.coverage_countries || [],
        coverage_regions: profile.coverage_regions || [],
        languages: profile.languages || [],
        specialties: profile.specialties || [],
      },
    });
  } catch (err) {
    logger.error('getMyConsultantProfile error', { err });
    return res.status(500).json({ error: 'Failed to load consultant profile.' });
  }
};

exports.upsertMyConsultantProfile = async (req, res) => {
  try {
    const {
      headline,
      bio,
      home_country,
      home_region,
      home_city,
      coverage_countries,
      coverage_regions,
      languages,
      specialties,
      years_experience,
      default_oxsteed_cut_bps,
      minimum_package_price_cents,
      active_referral_limit,
      accepts_new_referrals,
      accepts_virtual_consulting,
      is_active,
      timezone,
    } = req.body;

    const oxsteedCut = Math.max(0, Math.min(10000, parseInt(default_oxsteed_cut_bps ?? 2000, 10) || 0));
    const minPackage = Math.max(0, parseInt(minimum_package_price_cents ?? 0, 10) || 0);
    const referralLimit = Math.max(0, parseInt(active_referral_limit ?? 12, 10) || 0);
    const years = years_experience === '' || years_experience == null ? null : Math.max(0, parseInt(years_experience, 10) || 0);

    const normalizedCoverageCountries = splitList(coverage_countries).map(sanitizeCountry).filter(Boolean);
    const normalizedCoverageRegions = splitList(coverage_regions);
    const normalizedLanguages = splitList(languages);
    const normalizedSpecialties = splitList(specialties);

    const { rows } = await db.query(
      `INSERT INTO consultant_contractor_profiles (
         user_id,
         headline,
         bio,
         home_country,
         home_region,
         home_city,
         coverage_countries,
         coverage_regions,
         languages,
         specialties,
         years_experience,
         default_oxsteed_cut_bps,
         minimum_package_price_cents,
         active_referral_limit,
         accepts_new_referrals,
         accepts_virtual_consulting,
         is_active,
         timezone,
         updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9::text[], $10::text[],
         $11, $12, $13, $14, $15, $16, $17, $18, NOW()
       )
       ON CONFLICT (user_id) DO UPDATE SET
         headline = EXCLUDED.headline,
         bio = EXCLUDED.bio,
         home_country = EXCLUDED.home_country,
         home_region = EXCLUDED.home_region,
         home_city = EXCLUDED.home_city,
         coverage_countries = EXCLUDED.coverage_countries,
         coverage_regions = EXCLUDED.coverage_regions,
         languages = EXCLUDED.languages,
         specialties = EXCLUDED.specialties,
         years_experience = EXCLUDED.years_experience,
         default_oxsteed_cut_bps = EXCLUDED.default_oxsteed_cut_bps,
         minimum_package_price_cents = EXCLUDED.minimum_package_price_cents,
         active_referral_limit = EXCLUDED.active_referral_limit,
         accepts_new_referrals = EXCLUDED.accepts_new_referrals,
         accepts_virtual_consulting = EXCLUDED.accepts_virtual_consulting,
         is_active = EXCLUDED.is_active,
         timezone = EXCLUDED.timezone,
         updated_at = NOW()
       RETURNING *`,
      [
        req.user.id,
        headline?.trim() || null,
        bio?.trim() || null,
        sanitizeCountry(home_country),
        home_region?.trim() || null,
        home_city?.trim() || null,
        normalizedCoverageCountries,
        normalizedCoverageRegions,
        normalizedLanguages,
        normalizedSpecialties,
        years,
        oxsteedCut,
        minPackage,
        referralLimit,
        accepts_new_referrals !== false,
        accepts_virtual_consulting !== false,
        is_active !== false,
        timezone?.trim() || null,
      ]
    );

    return res.json({ profile: rows[0] });
  } catch (err) {
    logger.error('upsertMyConsultantProfile error', { err });
    return res.status(500).json({ error: 'Failed to save consultant profile.' });
  }
};

exports.getMyConsultantDashboard = async (req, res) => {
  try {
    const profile = await getProfileWithIdentity(req.user.id);
    if (!profile) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const [{ rows: summaryRows }, { rows: referralRows }, { rows: activityRows }, payingReferralAccess] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*) FILTER (WHERE consultant_assignment_status NOT IN ('unassigned', 'lost', 'completed')) AS active_referrals,
           COUNT(*) FILTER (WHERE consultant_assignment_status = 'completed') AS completed_referrals,
           COUNT(*) FILTER (WHERE consultant_assignment_status = 'won') AS won_referrals,
           COUNT(*) FILTER (WHERE consultant_assignment_status = 'lost') AS lost_referrals,
           COALESCE(SUM(estimated_consultant_share_cents) FILTER (WHERE consultant_assignment_status NOT IN ('unassigned', 'lost')), 0) AS consultant_pipeline_cents,
           COALESCE(SUM(estimated_oxsteed_share_cents) FILTER (WHERE consultant_assignment_status NOT IN ('unassigned', 'lost')), 0) AS oxsteed_generated_cents
         FROM consulting_requests
         WHERE consultant_assigned_id = $1`,
        [req.user.id]
      ),
      db.query(
        `SELECT
           cr.id,
           cr.first_name,
           cr.last_name,
           cr.email,
           cr.phone,
           cr.business_name,
           cr.skill_description,
           cr.target_market,
           cr.operating_country,
           cr.operating_state,
           cr.package_selected,
           cr.package_price,
           cr.urgency,
           cr.status,
           cr.consultant_assignment_status,
           cr.consultant_status_notes,
           cr.consultant_assigned_at,
           cr.consultant_follow_up_at,
           cr.consultant_last_contacted_at,
           cr.assigned_oxsteed_cut_bps,
           cr.assigned_consultant_cut_bps,
           cr.estimated_total_price_cents,
           cr.estimated_oxsteed_share_cents,
           cr.estimated_consultant_share_cents,
           cr.updated_at
         FROM consulting_requests cr
         WHERE cr.consultant_assigned_id = $1
         ORDER BY COALESCE(cr.consultant_follow_up_at, cr.updated_at) ASC, cr.created_at DESC`,
        [req.user.id]
      ),
      db.query(
        `SELECT log.id, log.request_id, log.event_type, log.note_text, log.metadata, log.created_at
         FROM consulting_request_referral_log log
         JOIN consulting_requests cr ON cr.id = log.request_id AND cr.consultant_assigned_id = $1
         WHERE log.actor_id = $1
         ORDER BY log.created_at DESC
         LIMIT 15`,
        [req.user.id]
      ),
      consultantEnforcement() === 'enforce' ? getPayingReferralAccess(req.user) : null,
    ]);

    return res.json({
      profile: {
        ...profile,
        coverage_countries: profile.coverage_countries || [],
        coverage_regions: profile.coverage_regions || [],
        languages: profile.languages || [],
        specialties: profile.specialties || [],
      },
      summary: summaryRows[0] || {},
      referrals: referralRows,
      activity: activityRows,
      referralStatuses: REFERRAL_STATUSES,
      ...(payingReferralAccess && { payingReferralAccess }),
    });
  } catch (err) {
    logger.error('getMyConsultantDashboard error', { err });
    return res.status(500).json({ error: 'Failed to load consultant dashboard.' });
  }
};

async function getPayingReferralAccess(user) {
  const canApply = requestsEnabled(user.id);
  if (isAdmin(user)) return { allowed: true, canApply };
  try {
    const decision = await checkPayingAccess(user.id);
    return { allowed: decision.allowed, canApply };
  } catch (error) {
    logger.warn('consultant referral access unavailable', { code: error.code });
    return { allowed: false, canApply: false, unavailable: true };
  }
}

exports.updateMyReferral = async (req, res) => {
  try {
    const { requestId } = req.params;
    const {
      consultant_assignment_status,
      consultant_status_notes,
      consultant_follow_up_at,
      mark_contacted,
    } = req.body;

    if (!REFERRAL_STATUSES.includes(consultant_assignment_status)) {
      return res.status(400).json({ error: 'Invalid referral status.' });
    }
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId)) {
      return res.status(404).json({ error: 'Referral not found.' });
    }
    if (consultant_status_notes != null && typeof consultant_status_notes !== 'string') {
      return res.status(400).json({ error: 'Invalid referral notes.' });
    }
    if (consultant_follow_up_at && (typeof consultant_follow_up_at !== 'string' || !Number.isFinite(Date.parse(consultant_follow_up_at)))) {
      return res.status(400).json({ error: 'Invalid referral follow-up date.' });
    }

    const outcome = await withTransaction(db, async (client) => {
      const { rows: [existing] } = await client.query(
        `SELECT consultant_assignment_status FROM consulting_requests
         WHERE id = $1 AND consultant_assigned_id = $2 FOR UPDATE`,
        [requestId, req.user.id],
      );
      if (!existing) return { status: 404, body: { error: 'Referral not found.' } };

      if (PAYING_STATUSES.has(consultant_assignment_status) && !isAdmin(req.user)) {
        let decision;
        try {
          decision = await checkPayingAccess(req.user.id, { client, lockGrant: true });
        } catch (error) {
          logger.error('consultant referral access unavailable', { code: error.code });
          return { status: 503, body: {
            error: 'platform_approval_unavailable', mode: 'consultant', action: 'accept_paying_booking', retryable: true,
          } };
        }
        if (!decision.allowed) {
          const { code, capability, mode, action, current_status, policy } = decision;
          const body = capability
            ? { error: 'This needs approved access.', code, capability, canApply: requestsEnabled(req.user.id) }
            : { error: code, mode, action, current_status, policy };
          return { status: 403, body };
        }
      }

      const note = consultant_status_notes?.trim() || null;
      const followUpAt = consultant_follow_up_at || null;
      const { rows: [referral] } = await client.query(
        `UPDATE consulting_requests
         SET consultant_assignment_status = $1::varchar,
             consultant_status_notes = $2,
             consultant_follow_up_at = $3,
             consultant_last_contacted_at = CASE WHEN $4::boolean THEN NOW() ELSE consultant_last_contacted_at END,
             consultant_intro_sent_at = CASE
               WHEN $1::varchar = 'intro_sent' AND consultant_intro_sent_at IS NULL THEN NOW()
               ELSE consultant_intro_sent_at
             END,
             updated_at = NOW()
         WHERE id = $5 AND consultant_assigned_id = $6
         RETURNING id, consultant_assigned_id, consultant_assignment_status, consultant_status_notes,
                   consultant_follow_up_at, consultant_last_contacted_at, consultant_intro_sent_at, updated_at`,
        [consultant_assignment_status, note, followUpAt, mark_contacted === true, requestId, req.user.id],
      );

      await logReferralEvent(client, {
        requestId,
        actorId: req.user.id,
        eventType: 'consultant_status_updated',
        noteText: note,
        metadata: {
          previous_status: existing.consultant_assignment_status,
          new_status: consultant_assignment_status,
          follow_up_at: followUpAt,
        },
      });
      return { status: 200, body: { referral } };
    }, 'consultant_referral_update');
    return res.status(outcome.status).json(outcome.body);
  } catch (err) {
    logger.error('updateMyReferral error', { err });
    return res.status(500).json({ error: 'Failed to update referral.' });
  }
};
