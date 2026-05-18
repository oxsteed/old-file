const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { uploadFile, getPublicUrl } = require('../utils/storage');
const logger = require('../utils/logger');

const VALID_STATUS = new Set(['new', 'consultation_ready', 'booked', 'confirmed', 'in_service', 'completed', 'rebooked', 'no_show', 'cancelled']);
const VALID_STAGE = new Set(['intake', 'consultation', 'booking', 'prep', 'visit', 'follow_up', 'closed']);
const VALID_SEGMENT = new Set(['new', 'returning', 'vip', 'bridal', 'membership']);
const VALID_PACKAGE_TYPE = new Set(['single', 'series', 'membership', 'bridal']);
const VALID_TRUST_STATUS = new Set(['active', 'expiring', 'expired', 'archived']);

function trimString(value, max = 4000) {
  const text = String(value ?? '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function toIntOrNull(value) {
  if (value === '' || value == null) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toArray(value, maxItems = 16, maxLength = 180) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => trimString(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function parseBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function deriveStage(status, requested) {
  if (VALID_STAGE.has(requested)) return requested;
  if (status === 'cancelled' || status === 'rebooked') return 'closed';
  if (status === 'completed' || status === 'no_show') return 'follow_up';
  if (status === 'in_service') return 'visit';
  if (status === 'confirmed') return 'prep';
  if (status === 'booked') return 'booking';
  if (status === 'consultation_ready') return 'consultation';
  return 'intake';
}

function computeFollowUpDueAt(status) {
  if (status === 'new' || status === 'consultation_ready') return new Date(Date.now() + 12 * 60 * 60 * 1000);
  if (status === 'completed' || status === 'no_show') return new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

function computeRebookRecommendedAt(templateSlug) {
  const daysByTemplate = {
    barbershop: 21,
    hair_stylist: 42,
    beauty_style: 35,
    spa_skincare: 30,
  };
  const days = daysByTemplate[templateSlug] || 35;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function getBusinessOrThrow(businessId) {
  const { rows } = await pool.query(
    `SELECT id, business_name, active_template, is_active
     FROM businesses
     WHERE id = $1`,
    [businessId]
  );
  const business = rows[0];
  if (!business || business.is_active === false) throw new AppError('Business not found', 404, 'not_found');
  return business;
}

async function ensureSettingsRow(client, businessId) {
  await client.query(
    `INSERT INTO beauty_operation_settings (business_id)
     VALUES ($1)
     ON CONFLICT (business_id) DO NOTHING`,
    [businessId]
  );
}

async function loadWorkspace(client, businessId) {
  await ensureSettingsRow(client, businessId);
  const [settingsRes, intakeRes, packagesRes, trustRes, metricsRes, upcomingRes] = await Promise.all([
    client.query(`SELECT * FROM beauty_operation_settings WHERE business_id = $1`, [businessId]),
    client.query(
      `SELECT *
       FROM beauty_intake_requests
       WHERE business_id = $1
       ORDER BY
         CASE status
           WHEN 'new' THEN 1
           WHEN 'consultation_ready' THEN 2
           WHEN 'booked' THEN 3
           WHEN 'confirmed' THEN 4
           WHEN 'in_service' THEN 5
           ELSE 6
         END,
         created_at DESC
       LIMIT 100`,
      [businessId]
    ),
    client.query(
      `SELECT *
       FROM beauty_membership_packages
       WHERE business_id = $1
       ORDER BY active DESC, created_at DESC`,
      [businessId]
    ),
    client.query(
      `SELECT *
       FROM beauty_trust_records
       WHERE business_id = $1
       ORDER BY
         CASE status
           WHEN 'expiring' THEN 1
           WHEN 'expired' THEN 2
           ELSE 3
         END,
         expires_on NULLS LAST,
         created_at DESC`,
      [businessId]
    ),
    client.query(
      `WITH intake_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE status IN ('new', 'consultation_ready', 'booked', 'confirmed', 'in_service'))::int AS open_intakes,
           COUNT(*) FILTER (WHERE follow_up_due_at IS NOT NULL AND follow_up_due_at <= NOW() AND status NOT IN ('cancelled', 'rebooked'))::int AS follow_up_due,
           COUNT(*) FILTER (WHERE status = 'no_show')::int AS no_show_requests,
           COUNT(*) FILTER (WHERE status = 'rebooked')::int AS rebooked_requests
         FROM beauty_intake_requests
         WHERE business_id = $1
       ),
       package_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE active = TRUE)::int AS active_packages,
           COALESCE(SUM(price_cents) FILTER (WHERE active = TRUE), 0)::bigint AS package_value_cents
         FROM beauty_membership_packages
         WHERE business_id = $1
       ),
       appointment_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE status IN ('pending', 'confirmed', 'in_progress') AND start_time >= NOW())::int AS upcoming_appointments,
           COUNT(*) FILTER (WHERE status = 'no_show' AND start_time >= NOW() - INTERVAL '30 day')::int AS appointment_no_shows,
           COUNT(*) FILTER (WHERE status = 'completed' AND start_time >= NOW() - INTERVAL '30 day')::int AS completed_last_30
         FROM business_appointments
         WHERE business_id = $1
       ),
       trust_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE status = 'active')::int AS active_trust_records,
           COUNT(*) FILTER (WHERE status IN ('expiring', 'expired') OR (expires_on IS NOT NULL AND expires_on <= CURRENT_DATE + INTERVAL '30 day'))::int AS trust_expiring
         FROM beauty_trust_records
         WHERE business_id = $1
       )
       SELECT *
       FROM intake_stats, package_stats, appointment_stats, trust_stats`,
      [businessId]
    ),
    client.query(
      `SELECT ba.id, ba.status, ba.start_time, ba.end_time, ba.customer_name, bs.name AS service_name
       FROM business_appointments ba
       LEFT JOIN business_services bs ON bs.id = ba.service_id
       WHERE ba.business_id = $1
         AND ba.start_time >= NOW() - INTERVAL '1 day'
       ORDER BY ba.start_time ASC
       LIMIT 12`,
      [businessId]
    ),
  ]);

  return {
    settings: settingsRes.rows[0],
    intakeRequests: intakeRes.rows,
    packages: packagesRes.rows,
    trustRecords: trustRes.rows,
    metrics: metricsRes.rows[0] || {},
    upcomingAppointments: upcomingRes.rows,
  };
}

exports.getPublicWorkspace = async (req, res, next) => {
  try {
    const business = await getBusinessOrThrow(req.params.businessId);
    const client = await pool.connect();
    try {
      const workspace = await loadWorkspace(client, business.id);
      res.json({
        business: {
          id: business.id,
          business_name: business.business_name,
          active_template: business.active_template || 'beauty_style',
        },
        settings: {
          response_promise_hours: workspace.settings.response_promise_hours,
          consultation_offer_label: workspace.settings.consultation_offer_label,
          rebook_window_days: workspace.settings.rebook_window_days,
          same_day_fill_window_hours: workspace.settings.same_day_fill_window_hours,
          deposit_policy: workspace.settings.deposit_policy,
          cancellation_policy: workspace.settings.cancellation_policy,
          prep_instructions: workspace.settings.prep_instructions,
          aftercare_prompt: workspace.settings.aftercare_prompt,
          membership_pitch: workspace.settings.membership_pitch,
          service_focuses: workspace.settings.service_focuses,
          concern_tags: workspace.settings.concern_tags,
          trust_artifacts: workspace.settings.trust_artifacts,
          consent_requirements: workspace.settings.consent_requirements,
          emergency_contact_phone: workspace.settings.emergency_contact_phone,
        },
        packages: workspace.packages.filter((item) => item.active).slice(0, 6),
        trustRecords: workspace.trustRecords.slice(0, 6),
        metrics: workspace.metrics,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

exports.getBusinessWorkspace = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const workspace = await loadWorkspace(client, req.business.id);
    res.json(workspace);
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

exports.updateSettings = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureSettingsRow(client, req.business.id);
    const { rows } = await client.query(
      `UPDATE beauty_operation_settings
       SET response_promise_hours = COALESCE($2, response_promise_hours),
           consultation_offer_label = COALESCE($3, consultation_offer_label),
           rebook_window_days = COALESCE($4, rebook_window_days),
           same_day_fill_window_hours = COALESCE($5, same_day_fill_window_hours),
           deposit_policy = $6,
           cancellation_policy = $7,
           prep_instructions = $8,
           aftercare_prompt = $9,
           membership_pitch = $10,
           preferred_contact_channel = COALESCE($11, preferred_contact_channel),
           service_focuses = CASE WHEN $12::text[] IS NULL OR cardinality($12::text[]) = 0 THEN service_focuses ELSE $12::text[] END,
           concern_tags = CASE WHEN $13::text[] IS NULL OR cardinality($13::text[]) = 0 THEN concern_tags ELSE $13::text[] END,
           trust_artifacts = CASE WHEN $14::text[] IS NULL OR cardinality($14::text[]) = 0 THEN trust_artifacts ELSE $14::text[] END,
           consent_requirements = CASE WHEN $15::text[] IS NULL OR cardinality($15::text[]) = 0 THEN consent_requirements ELSE $15::text[] END,
           emergency_contact_phone = $16,
           updated_at = NOW()
       WHERE business_id = $1
       RETURNING *`,
      [
        req.business.id,
        toIntOrNull(req.body.response_promise_hours),
        trimString(req.body.consultation_offer_label, 120) || null,
        toIntOrNull(req.body.rebook_window_days),
        toIntOrNull(req.body.same_day_fill_window_hours),
        trimString(req.body.deposit_policy, 2000) || null,
        trimString(req.body.cancellation_policy, 2000) || null,
        trimString(req.body.prep_instructions, 2000) || null,
        trimString(req.body.aftercare_prompt, 2000) || null,
        trimString(req.body.membership_pitch, 2000) || null,
        trimString(req.body.preferred_contact_channel, 30) || null,
        toArray(req.body.service_focuses, 12, 120).length ? toArray(req.body.service_focuses, 12, 120) : null,
        toArray(req.body.concern_tags, 12, 120).length ? toArray(req.body.concern_tags, 12, 120) : null,
        toArray(req.body.trust_artifacts, 12, 140).length ? toArray(req.body.trust_artifacts, 12, 140) : null,
        toArray(req.body.consent_requirements, 12, 140).length ? toArray(req.body.consent_requirements, 12, 140) : null,
        trimString(req.body.emergency_contact_phone, 60) || null,
      ]
    );
    await client.query('COMMIT');
    res.json({ settings: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

exports.createIntakeRequest = async (req, res, next) => {
  try {
    const business = await getBusinessOrThrow(req.params.businessId);
    const desiredService = trimString(req.body.desired_service || req.body.desiredService, 180);
    if (!desiredService) throw new AppError('Desired service is required', 400, 'validation_failed');

    let photoUrls = [];
    if (req.files?.length) {
      const uploads = await Promise.allSettled(
        req.files.slice(0, 5).map((file) => uploadFile(file.buffer, 'beauty-intakes', file.originalname, file.mimetype))
      );
      photoUrls = uploads
        .filter((result) => result.status === 'fulfilled' && result.value)
        .map((result) => getPublicUrl(result.value));
      const failed = uploads.filter((result) => result.status === 'rejected' || !result.value).length;
      if (failed) logger.warn('Beauty intake photo upload skipped', { failed, total: req.files.length });
    }

    const templateSlug = trimString(req.body.template_slug, 60) || business.active_template || 'beauty_style';
    const status = VALID_STATUS.has(req.body.status) ? req.body.status : 'new';
    const workflowStage = deriveStage(status, req.body.workflow_stage);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO beauty_intake_requests (
           business_id, requester_id, linked_appointment_id, assigned_staff_id, status, workflow_stage,
           template_slug, client_segment, desired_service, desired_look, preferred_staff, preferred_time_notes,
           package_interest, budget_notes, contact_name, contact_email, contact_phone, inspiration_notes,
           hair_length, hair_history, beard_preferences, skin_sensitivities, contraindications,
           prep_acknowledged, no_show_acknowledged, consent_flags, photo_urls,
           internal_notes, customer_visible_note, follow_up_due_at, rebook_recommended_at,
           scheduled_start_at, scheduled_end_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb,$27,$28,$29,$30,$31,$32,$33)
         RETURNING *`,
        [
          business.id,
          req.user?.id || null,
          req.body.linked_appointment_id || null,
          req.body.assigned_staff_id || null,
          status,
          workflowStage,
          templateSlug,
          VALID_SEGMENT.has(req.body.client_segment) ? req.body.client_segment : 'new',
          desiredService,
          trimString(req.body.desired_look || req.body.desiredLook, 255) || null,
          trimString(req.body.preferred_staff || req.body.preferredStaff, 180) || null,
          trimString(req.body.preferred_time_notes || req.body.preferredTimeNotes, 1200) || null,
          trimString(req.body.package_interest || req.body.packageInterest, 180) || null,
          trimString(req.body.budget_notes || req.body.budgetNotes, 255) || null,
          trimString(req.body.contact_name || req.body.contactName, 160) || null,
          trimString(req.body.contact_email || req.body.contactEmail, 255) || null,
          trimString(req.body.contact_phone || req.body.contactPhone, 60) || null,
          trimString(req.body.inspiration_notes || req.body.inspirationNotes, 3000) || null,
          trimString(req.body.hair_length || req.body.hairLength, 120) || null,
          trimString(req.body.hair_history || req.body.hairHistory, 2000) || null,
          trimString(req.body.beard_preferences || req.body.beardPreferences, 2000) || null,
          trimString(req.body.skin_sensitivities || req.body.skinSensitivities, 2000) || null,
          trimString(req.body.contraindications, 2000) || null,
          parseBoolean(req.body.prep_acknowledged),
          parseBoolean(req.body.no_show_acknowledged),
          JSON.stringify({
            patch_test: parseBoolean(req.body.patch_test),
            photo_release: parseBoolean(req.body.photo_release),
            fragrance_sensitivity: parseBoolean(req.body.fragrance_sensitivity),
          }),
          photoUrls,
          trimString(req.body.internal_notes, 4000) || null,
          trimString(req.body.customer_visible_note, 2000) || null,
          computeFollowUpDueAt(status),
          computeRebookRecommendedAt(templateSlug),
          req.body.scheduled_start_at || null,
          req.body.scheduled_end_at || null,
        ]
      );
      await client.query('COMMIT');
      res.status(201).json({ request: rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

exports.updateIntakeRequest = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const status = VALID_STATUS.has(req.body.status) ? req.body.status : null;
    const workflowStage = deriveStage(status || 'new', req.body.workflow_stage);
    const { rows } = await client.query(
      `UPDATE beauty_intake_requests
       SET linked_appointment_id = COALESCE($3, linked_appointment_id),
           assigned_staff_id = COALESCE($4, assigned_staff_id),
           status = COALESCE($5, status),
           workflow_stage = COALESCE($6, workflow_stage),
           client_segment = COALESCE($7, client_segment),
           package_interest = COALESCE($8, package_interest),
           internal_notes = COALESCE($9, internal_notes),
           customer_visible_note = COALESCE($10, customer_visible_note),
           follow_up_due_at = COALESCE($11, follow_up_due_at),
           rebook_recommended_at = COALESCE($12, rebook_recommended_at),
           scheduled_start_at = COALESCE($13, scheduled_start_at),
           scheduled_end_at = COALESCE($14, scheduled_end_at),
           updated_at = NOW()
       WHERE id = $1
         AND business_id = $2
       RETURNING *`,
      [
        req.params.requestId,
        req.business.id,
        req.body.linked_appointment_id || null,
        req.body.assigned_staff_id || null,
        status,
        workflowStage,
        VALID_SEGMENT.has(req.body.client_segment) ? req.body.client_segment : null,
        trimString(req.body.package_interest, 180) || null,
        trimString(req.body.internal_notes, 4000) || null,
        trimString(req.body.customer_visible_note, 2000) || null,
        req.body.follow_up_due_at || null,
        req.body.rebook_recommended_at || null,
        req.body.scheduled_start_at || null,
        req.body.scheduled_end_at || null,
      ]
    );
    if (!rows.length) throw new AppError('Beauty intake request not found', 404, 'not_found');
    await client.query('COMMIT');
    res.json({ request: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

exports.createPackage = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const packageType = VALID_PACKAGE_TYPE.has(req.body.package_type) ? req.body.package_type : 'membership';
    const { rows } = await client.query(
      `INSERT INTO beauty_membership_packages (
         business_id, package_name, package_type, target_templates, description,
         price_cents, sessions_included, perks, active
       )
       VALUES ($1,$2,$3,$4::text[],$5,$6,$7,$8::text[],$9)
       RETURNING *`,
      [
        req.business.id,
        trimString(req.body.package_name, 180),
        packageType,
        toArray(req.body.target_templates, 8, 60).length ? toArray(req.body.target_templates, 8, 60) : ['beauty_style'],
        trimString(req.body.description, 3000) || null,
        Math.max(0, toIntOrNull(req.body.price_cents) || 0),
        toIntOrNull(req.body.sessions_included),
        toArray(req.body.perks, 12, 180),
        req.body.active !== false,
      ]
    );
    res.status(201).json({ package: rows[0] });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

exports.updatePackage = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `UPDATE beauty_membership_packages
       SET package_name = COALESCE($3, package_name),
           package_type = COALESCE($4, package_type),
           target_templates = CASE WHEN $5::text[] IS NULL OR cardinality($5::text[]) = 0 THEN target_templates ELSE $5::text[] END,
           description = COALESCE($6, description),
           price_cents = COALESCE($7, price_cents),
           sessions_included = COALESCE($8, sessions_included),
           perks = CASE WHEN $9::text[] IS NULL THEN perks ELSE $9::text[] END,
           active = COALESCE($10, active),
           updated_at = NOW()
       WHERE id = $1
         AND business_id = $2
       RETURNING *`,
      [
        req.params.packageId,
        req.business.id,
        trimString(req.body.package_name, 180) || null,
        VALID_PACKAGE_TYPE.has(req.body.package_type) ? req.body.package_type : null,
        toArray(req.body.target_templates, 8, 60).length ? toArray(req.body.target_templates, 8, 60) : null,
        trimString(req.body.description, 3000) || null,
        toIntOrNull(req.body.price_cents),
        toIntOrNull(req.body.sessions_included),
        Array.isArray(req.body.perks) ? toArray(req.body.perks, 12, 180) : null,
        typeof req.body.active === 'boolean' ? req.body.active : null,
      ]
    );
    if (!rows.length) throw new AppError('Beauty package not found', 404, 'not_found');
    res.json({ package: rows[0] });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

exports.deletePackage = async (req, res, next) => {
  try {
    const result = await pool.query(
      `DELETE FROM beauty_membership_packages
       WHERE id = $1
         AND business_id = $2`,
      [req.params.packageId, req.business.id]
    );
    if (!result.rowCount) throw new AppError('Beauty package not found', 404, 'not_found');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

exports.createTrustRecord = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO beauty_trust_records (
         business_id, record_type, title, status, issuer, expires_on, document_url, notes
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        req.business.id,
        trimString(req.body.record_type, 60),
        trimString(req.body.title, 180),
        VALID_TRUST_STATUS.has(req.body.status) ? req.body.status : 'active',
        trimString(req.body.issuer, 180) || null,
        req.body.expires_on || null,
        trimString(req.body.document_url, 2000) || null,
        trimString(req.body.notes, 3000) || null,
      ]
    );
    res.status(201).json({ record: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.updateTrustRecord = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE beauty_trust_records
       SET record_type = COALESCE($3, record_type),
           title = COALESCE($4, title),
           status = COALESCE($5, status),
           issuer = COALESCE($6, issuer),
           expires_on = COALESCE($7, expires_on),
           document_url = COALESCE($8, document_url),
           notes = COALESCE($9, notes),
           updated_at = NOW()
       WHERE id = $1
         AND business_id = $2
       RETURNING *`,
      [
        req.params.recordId,
        req.business.id,
        trimString(req.body.record_type, 60) || null,
        trimString(req.body.title, 180) || null,
        VALID_TRUST_STATUS.has(req.body.status) ? req.body.status : null,
        trimString(req.body.issuer, 180) || null,
        req.body.expires_on || null,
        trimString(req.body.document_url, 2000) || null,
        trimString(req.body.notes, 3000) || null,
      ]
    );
    if (!rows.length) throw new AppError('Beauty trust record not found', 404, 'not_found');
    res.json({ record: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.deleteTrustRecord = async (req, res, next) => {
  try {
    const result = await pool.query(
      `DELETE FROM beauty_trust_records
       WHERE id = $1
         AND business_id = $2`,
      [req.params.recordId, req.business.id]
    );
    if (!result.rowCount) throw new AppError('Beauty trust record not found', 404, 'not_found');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
