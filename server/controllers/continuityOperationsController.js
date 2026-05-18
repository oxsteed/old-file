const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');

const VALID_STATUS = new Set(['new', 'qualified', 'scheduled', 'active', 'progress_review', 'continuing', 'completed', 'paused', 'cancelled']);
const VALID_STAGE = new Set(['intake', 'qualification', 'scheduling', 'session', 'progress', 'retention', 'closed']);
const VALID_RELATIONSHIP = new Set(['client', 'student', 'family', 'pet', 'patient', 'athlete']);
const VALID_PLAN_TYPE = new Set(['session_pack', 'membership', 'care_plan', 'learning_plan', 'wellness_plan']);
const VALID_RECORD_STATUS = new Set(['active', 'expiring', 'expired', 'archived']);

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

function deriveStage(status, requested) {
  if (VALID_STAGE.has(requested)) return requested;
  if (status === 'cancelled' || status === 'paused') return 'closed';
  if (status === 'completed' || status === 'continuing') return 'retention';
  if (status === 'progress_review') return 'progress';
  if (status === 'active') return 'session';
  if (status === 'scheduled') return 'scheduling';
  if (status === 'qualified') return 'qualification';
  return 'intake';
}

function computeFollowUpDueAt(status) {
  if (status === 'new' || status === 'qualified') return new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (status === 'scheduled' || status === 'active') return new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  if (status === 'completed' || status === 'progress_review') return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
}

function computeNextSessionRecommendedAt(templateSlug) {
  const daysByTemplate = {
    fitness_pro: 7,
    wellness_therapy: 14,
    nutrition_diet: 21,
    mental_health: 14,
    massage_therapist: 21,
    care_trust: 7,
    pet_services: 7,
    tutoring_education: 7,
    child_development: 14,
    dog_walker: 7,
    math_tutor: 7,
  };
  const days = daysByTemplate[templateSlug] || 14;
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
    `INSERT INTO continuity_operation_settings (business_id)
     VALUES ($1)
     ON CONFLICT (business_id) DO NOTHING`,
    [businessId]
  );
}

async function loadWorkspace(client, businessId) {
  await ensureSettingsRow(client, businessId);
  const [settingsRes, intakeRes, plansRes, trustRes, metricsRes, upcomingRes] = await Promise.all([
    client.query(`SELECT * FROM continuity_operation_settings WHERE business_id = $1`, [businessId]),
    client.query(
      `SELECT *
       FROM continuity_intake_requests
       WHERE business_id = $1
       ORDER BY
         CASE status
           WHEN 'new' THEN 1
           WHEN 'qualified' THEN 2
           WHEN 'scheduled' THEN 3
           WHEN 'active' THEN 4
           WHEN 'progress_review' THEN 5
           ELSE 6
         END,
         created_at DESC
       LIMIT 100`,
      [businessId]
    ),
    client.query(
      `SELECT *
       FROM continuity_service_plans
       WHERE business_id = $1
       ORDER BY active DESC, created_at DESC`,
      [businessId]
    ),
    client.query(
      `SELECT *
       FROM continuity_trust_records
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
      `WITH request_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE status IN ('new', 'qualified', 'scheduled', 'active', 'progress_review', 'continuing'))::int AS open_requests,
           COUNT(*) FILTER (WHERE follow_up_due_at IS NOT NULL AND follow_up_due_at <= NOW() AND status NOT IN ('cancelled', 'paused'))::int AS follow_up_due,
           COUNT(*) FILTER (WHERE next_session_recommended_at IS NOT NULL AND next_session_recommended_at <= NOW() AND status NOT IN ('cancelled', 'paused'))::int AS next_sessions_due,
           COUNT(*) FILTER (WHERE status IN ('active', 'continuing', 'progress_review'))::int AS continuity_clients
         FROM continuity_intake_requests
         WHERE business_id = $1
       ),
       plan_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE active = TRUE)::int AS active_plans,
           COALESCE(SUM(price_cents) FILTER (WHERE active = TRUE), 0)::bigint AS plan_value_cents
         FROM continuity_service_plans
         WHERE business_id = $1
       ),
       trust_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE status = 'active')::int AS active_trust_records,
           COUNT(*) FILTER (WHERE status IN ('expiring', 'expired') OR (expires_on IS NOT NULL AND expires_on <= CURRENT_DATE + INTERVAL '30 day'))::int AS trust_expiring
         FROM continuity_trust_records
         WHERE business_id = $1
       ),
       appointment_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE status IN ('pending', 'confirmed', 'in_progress') AND start_time >= NOW())::int AS upcoming_appointments,
           COUNT(*) FILTER (WHERE status = 'completed' AND start_time >= NOW() - INTERVAL '30 day')::int AS completed_last_30
         FROM business_appointments
         WHERE business_id = $1
       )
       SELECT *
       FROM request_stats, plan_stats, trust_stats, appointment_stats`,
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
    plans: plansRes.rows,
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
          active_template: business.active_template || 'wellness_therapy',
        },
        settings: {
          response_promise_hours: workspace.settings.response_promise_hours,
          intake_label: workspace.settings.intake_label,
          follow_up_window_days: workspace.settings.follow_up_window_days,
          next_session_window_days: workspace.settings.next_session_window_days,
          preferred_contact_channel: workspace.settings.preferred_contact_channel,
          intake_focuses: workspace.settings.intake_focuses,
          trust_artifacts: workspace.settings.trust_artifacts,
          plan_focuses: workspace.settings.plan_focuses,
          progress_prompts: workspace.settings.progress_prompts,
          consent_requirements: workspace.settings.consent_requirements,
          guardian_policy: workspace.settings.guardian_policy,
          prep_expectations: workspace.settings.prep_expectations,
          continuity_pitch: workspace.settings.continuity_pitch,
          emergency_contact_phone: workspace.settings.emergency_contact_phone,
        },
        plans: workspace.plans.filter((item) => item.active).slice(0, 6),
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
      `UPDATE continuity_operation_settings
       SET response_promise_hours = COALESCE($2, response_promise_hours),
           intake_label = COALESCE($3, intake_label),
           follow_up_window_days = COALESCE($4, follow_up_window_days),
           next_session_window_days = COALESCE($5, next_session_window_days),
           preferred_contact_channel = COALESCE($6, preferred_contact_channel),
           intake_focuses = CASE WHEN $7::text[] IS NULL OR cardinality($7::text[]) = 0 THEN intake_focuses ELSE $7::text[] END,
           trust_artifacts = CASE WHEN $8::text[] IS NULL OR cardinality($8::text[]) = 0 THEN trust_artifacts ELSE $8::text[] END,
           plan_focuses = CASE WHEN $9::text[] IS NULL OR cardinality($9::text[]) = 0 THEN plan_focuses ELSE $9::text[] END,
           progress_prompts = CASE WHEN $10::text[] IS NULL OR cardinality($10::text[]) = 0 THEN progress_prompts ELSE $10::text[] END,
           consent_requirements = CASE WHEN $11::text[] IS NULL OR cardinality($11::text[]) = 0 THEN consent_requirements ELSE $11::text[] END,
           guardian_policy = $12,
           prep_expectations = $13,
           continuity_pitch = $14,
           emergency_contact_phone = $15,
           updated_at = NOW()
       WHERE business_id = $1
       RETURNING *`,
      [
        req.business.id,
        toIntOrNull(req.body.response_promise_hours),
        trimString(req.body.intake_label, 120) || null,
        toIntOrNull(req.body.follow_up_window_days),
        toIntOrNull(req.body.next_session_window_days),
        trimString(req.body.preferred_contact_channel, 30) || null,
        toArray(req.body.intake_focuses, 12, 140).length ? toArray(req.body.intake_focuses, 12, 140) : null,
        toArray(req.body.trust_artifacts, 12, 140).length ? toArray(req.body.trust_artifacts, 12, 140) : null,
        toArray(req.body.plan_focuses, 12, 140).length ? toArray(req.body.plan_focuses, 12, 140) : null,
        toArray(req.body.progress_prompts, 12, 140).length ? toArray(req.body.progress_prompts, 12, 140) : null,
        toArray(req.body.consent_requirements, 12, 140).length ? toArray(req.body.consent_requirements, 12, 140) : null,
        trimString(req.body.guardian_policy, 2000) || null,
        trimString(req.body.prep_expectations, 2000) || null,
        trimString(req.body.continuity_pitch, 2000) || null,
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
    const primaryGoal = trimString(req.body.primary_goal || req.body.primaryGoal, 180);
    if (!primaryGoal) throw new AppError('Primary goal is required', 400, 'validation_failed');

    const templateSlug = trimString(req.body.template_slug, 60) || business.active_template || 'wellness_therapy';
    const status = VALID_STATUS.has(req.body.status) ? req.body.status : 'new';
    const relationshipType = VALID_RELATIONSHIP.has(req.body.relationship_type) ? req.body.relationship_type : 'client';
    const consentFlags = typeof req.body.consent_flags === 'object' && req.body.consent_flags !== null
      ? req.body.consent_flags
      : {
          guardian_acknowledged: !!req.body.guardian_acknowledged,
          policy_acknowledged: !!req.body.policy_acknowledged,
          safety_acknowledged: !!req.body.safety_acknowledged,
        };

    const { rows } = await pool.query(
      `INSERT INTO continuity_intake_requests (
         business_id, requester_id, linked_appointment_id, status, workflow_stage, template_slug,
         relationship_type, primary_goal, support_context, schedule_notes, package_interest,
         age_or_level, guardian_name, guardian_phone, special_considerations, current_routine,
         progress_target, budget_notes, contact_name, contact_email, contact_phone,
         preferred_contact_channel, consent_flags, internal_notes, customer_visible_note,
         follow_up_due_at, next_session_recommended_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
       RETURNING *`,
      [
        business.id,
        req.user?.id || null,
        req.body.linked_appointment_id || null,
        status,
        deriveStage(status, req.body.workflow_stage),
        templateSlug,
        relationshipType,
        primaryGoal,
        trimString(req.body.support_context || req.body.supportContext, 3000) || null,
        trimString(req.body.schedule_notes || req.body.scheduleNotes, 255) || null,
        trimString(req.body.package_interest || req.body.packageInterest, 180) || null,
        trimString(req.body.age_or_level || req.body.ageOrLevel, 120) || null,
        trimString(req.body.guardian_name || req.body.guardianName, 160) || null,
        trimString(req.body.guardian_phone || req.body.guardianPhone, 60) || null,
        trimString(req.body.special_considerations || req.body.specialConsiderations, 3000) || null,
        trimString(req.body.current_routine || req.body.currentRoutine, 3000) || null,
        trimString(req.body.progress_target || req.body.progressTarget, 255) || null,
        trimString(req.body.budget_notes || req.body.budgetNotes, 255) || null,
        trimString(req.body.contact_name || req.body.contactName, 160) || null,
        trimString(req.body.contact_email || req.body.contactEmail, 255) || null,
        trimString(req.body.contact_phone || req.body.contactPhone, 60) || null,
        trimString(req.body.preferred_contact_channel || req.body.preferredContactChannel, 30) || null,
        consentFlags,
        trimString(req.body.internal_notes, 4000) || null,
        trimString(req.body.customer_visible_note, 2000) || null,
        computeFollowUpDueAt(status),
        computeNextSessionRecommendedAt(templateSlug),
      ]
    );
    res.status(201).json({ request: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.updateIntakeRequest = async (req, res, next) => {
  try {
    const status = VALID_STATUS.has(req.body.status) ? req.body.status : null;
    const stage = status
      ? deriveStage(status, req.body.workflow_stage)
      : (VALID_STAGE.has(req.body.workflow_stage) ? req.body.workflow_stage : null);
    const relationshipType = VALID_RELATIONSHIP.has(req.body.relationship_type) ? req.body.relationship_type : null;
    const { rows } = await pool.query(
      `UPDATE continuity_intake_requests
       SET linked_appointment_id = COALESCE($3, linked_appointment_id),
           assigned_staff_id = COALESCE($4, assigned_staff_id),
           status = COALESCE($5, status),
           workflow_stage = COALESCE($6, workflow_stage),
           relationship_type = COALESCE($7, relationship_type),
           package_interest = COALESCE($8, package_interest),
           progress_target = COALESCE($9, progress_target),
           internal_notes = COALESCE($10, internal_notes),
           customer_visible_note = COALESCE($11, customer_visible_note),
           follow_up_due_at = COALESCE($12, follow_up_due_at),
           next_session_recommended_at = COALESCE($13, next_session_recommended_at),
           scheduled_start_at = COALESCE($14, scheduled_start_at),
           scheduled_end_at = COALESCE($15, scheduled_end_at),
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
        stage,
        relationshipType,
        trimString(req.body.package_interest, 180) || null,
        trimString(req.body.progress_target, 255) || null,
        trimString(req.body.internal_notes, 4000) || null,
        trimString(req.body.customer_visible_note, 2000) || null,
        req.body.follow_up_due_at || null,
        req.body.next_session_recommended_at || null,
        req.body.scheduled_start_at || null,
        req.body.scheduled_end_at || null,
      ]
    );
    if (!rows.length) throw new AppError('Continuity intake request not found', 404, 'not_found');
    res.json({ request: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.createPlan = async (req, res, next) => {
  try {
    const planName = trimString(req.body.plan_name || req.body.planName, 180);
    if (!planName) throw new AppError('Plan name is required', 400, 'validation_failed');
    const planType = VALID_PLAN_TYPE.has(req.body.plan_type) ? req.body.plan_type : 'membership';
    const { rows } = await pool.query(
      `INSERT INTO continuity_service_plans (
         business_id, plan_name, plan_type, target_templates, description,
         price_cents, session_count, cadence_label, focus_areas, active
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        req.business.id,
        planName,
        planType,
        toArray(req.body.target_templates, 12, 80).length ? toArray(req.body.target_templates, 12, 80) : ['wellness_therapy'],
        trimString(req.body.description, 3000) || null,
        toIntOrNull(req.body.price_cents) || 0,
        toIntOrNull(req.body.session_count),
        trimString(req.body.cadence_label, 120) || null,
        toArray(req.body.focus_areas, 12, 120),
        req.body.active !== false,
      ]
    );
    res.status(201).json({ plan: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.updatePlan = async (req, res, next) => {
  try {
    const planType = VALID_PLAN_TYPE.has(req.body.plan_type) ? req.body.plan_type : null;
    const { rows } = await pool.query(
      `UPDATE continuity_service_plans
       SET plan_name = COALESCE($3, plan_name),
           plan_type = COALESCE($4, plan_type),
           target_templates = CASE WHEN $5::text[] IS NULL OR cardinality($5::text[]) = 0 THEN target_templates ELSE $5::text[] END,
           description = COALESCE($6, description),
           price_cents = COALESCE($7, price_cents),
           session_count = COALESCE($8, session_count),
           cadence_label = COALESCE($9, cadence_label),
           focus_areas = CASE WHEN $10::text[] IS NULL THEN focus_areas ELSE $10::text[] END,
           active = COALESCE($11, active),
           updated_at = NOW()
       WHERE id = $1
         AND business_id = $2
       RETURNING *`,
      [
        req.params.planId,
        req.business.id,
        trimString(req.body.plan_name, 180) || null,
        planType,
        toArray(req.body.target_templates, 12, 80).length ? toArray(req.body.target_templates, 12, 80) : null,
        trimString(req.body.description, 3000) || null,
        toIntOrNull(req.body.price_cents),
        toIntOrNull(req.body.session_count),
        trimString(req.body.cadence_label, 120) || null,
        Array.isArray(req.body.focus_areas) ? toArray(req.body.focus_areas, 12, 120) : null,
        typeof req.body.active === 'boolean' ? req.body.active : null,
      ]
    );
    if (!rows.length) throw new AppError('Plan not found', 404, 'not_found');
    res.json({ plan: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.deletePlan = async (req, res, next) => {
  try {
    const result = await pool.query(
      `DELETE FROM continuity_service_plans
       WHERE id = $1
         AND business_id = $2`,
      [req.params.planId, req.business.id]
    );
    if (!result.rowCount) throw new AppError('Plan not found', 404, 'not_found');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

exports.createTrustRecord = async (req, res, next) => {
  try {
    const title = trimString(req.body.title, 180);
    const recordType = trimString(req.body.record_type || req.body.recordType, 60);
    if (!title || !recordType) throw new AppError('Record type and title are required', 400, 'validation_failed');
    const status = VALID_RECORD_STATUS.has(req.body.status) ? req.body.status : 'active';
    const { rows } = await pool.query(
      `INSERT INTO continuity_trust_records (
         business_id, record_type, title, status, issuer, expires_on, document_url, notes
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        req.business.id,
        recordType,
        title,
        status,
        trimString(req.body.issuer, 180) || null,
        req.body.expires_on || null,
        trimString(req.body.document_url, 1000) || null,
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
    const status = VALID_RECORD_STATUS.has(req.body.status) ? req.body.status : null;
    const { rows } = await pool.query(
      `UPDATE continuity_trust_records
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
        status,
        trimString(req.body.issuer, 180) || null,
        req.body.expires_on || null,
        trimString(req.body.document_url, 1000) || null,
        trimString(req.body.notes, 3000) || null,
      ]
    );
    if (!rows.length) throw new AppError('Trust record not found', 404, 'not_found');
    res.json({ record: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.deleteTrustRecord = async (req, res, next) => {
  try {
    const result = await pool.query(
      `DELETE FROM continuity_trust_records
       WHERE id = $1
         AND business_id = $2`,
      [req.params.recordId, req.business.id]
    );
    if (!result.rowCount) throw new AppError('Trust record not found', 404, 'not_found');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};
