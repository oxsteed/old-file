const db = require('../db');
const logger = require('../utils/logger');

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

async function logReferralEvent({ requestId, actorId, eventType, noteText = null, metadata = {} }) {
  await db.query(
    `INSERT INTO consulting_request_referral_log (request_id, actor_id, event_type, note_text, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [requestId, actorId || null, eventType, noteText, JSON.stringify(metadata || {})]
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

    const [{ rows: summaryRows }, { rows: referralRows }, { rows: activityRows }] = await Promise.all([
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
        `SELECT id, request_id, event_type, note_text, metadata, created_at
         FROM consulting_request_referral_log
         WHERE actor_id = $1
         ORDER BY created_at DESC
         LIMIT 15`,
        [req.user.id]
      ),
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
    });
  } catch (err) {
    logger.error('getMyConsultantDashboard error', { err });
    return res.status(500).json({ error: 'Failed to load consultant dashboard.' });
  }
};

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

    const existing = await db.query(
      `SELECT id, consultant_assigned_id, consultant_assignment_status
       FROM consulting_requests
       WHERE id = $1`,
      [requestId]
    );

    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Referral not found.' });
    }

    if (existing.rows[0].consultant_assigned_id !== req.user.id) {
      return res.status(403).json({ error: 'You are not assigned to this referral.' });
    }

    const { rows } = await db.query(
      `UPDATE consulting_requests
       SET consultant_assignment_status = $1,
           consultant_status_notes = $2,
           consultant_follow_up_at = $3,
           consultant_last_contacted_at = CASE WHEN $4::boolean THEN NOW() ELSE consultant_last_contacted_at END,
           consultant_intro_sent_at = CASE
             WHEN $1 = 'intro_sent' AND consultant_intro_sent_at IS NULL THEN NOW()
             ELSE consultant_intro_sent_at
           END,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [
        consultant_assignment_status,
        consultant_status_notes?.trim() || null,
        consultant_follow_up_at || null,
        mark_contacted === true,
        requestId,
      ]
    );

    await logReferralEvent({
      requestId,
      actorId: req.user.id,
      eventType: 'consultant_status_updated',
      noteText: consultant_status_notes?.trim() || null,
      metadata: {
        previous_status: existing.rows[0].consultant_assignment_status,
        new_status: consultant_assignment_status,
        follow_up_at: consultant_follow_up_at || null,
      },
    });

    return res.json({ referral: rows[0] });
  } catch (err) {
    logger.error('updateMyReferral error', { err });
    return res.status(500).json({ error: 'Failed to update referral.' });
  }
};
