const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { uploadFile, getPublicUrl } = require('../utils/storage');
const logger = require('../utils/logger');

const VALID_STATUS = new Set(['new', 'triaged', 'scheduled', 'diagnosing', 'quoted', 'approved', 'completed', 'declined', 'cancelled']);
const VALID_WORKFLOW_STAGE = new Set(['intake', 'triage', 'visit_scheduled', 'diagnostic', 'estimate', 'repair', 'closed']);
const VALID_REQUEST_CHANNEL = new Set(['public_profile', 'phone', 'message', 'internal']);
const VALID_URGENCY = new Set(['emergency', 'urgent', 'normal', 'low']);
const VALID_RECOMMENDATION_TYPE = new Set(['repair', 'upgrade', 'maintenance', 'replacement', 'safety']);
const VALID_RECOMMENDATION_PRIORITY = new Set(['critical', 'recommended', 'optional']);
const VALID_RECOMMENDATION_STATUS = new Set(['open', 'quoted', 'approved', 'completed', 'declined']);
const VALID_TRUST_STATUS = new Set(['active', 'expiring', 'expired', 'archived']);

function trimString(value, max = 4000) {
  const text = String(value ?? '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function toArray(value, maxItems = 16, maxLength = 160) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => trimString(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function toIntOrNull(value) {
  if (value === '' || value == null) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveStage(status, requested) {
  if (VALID_WORKFLOW_STAGE.has(requested)) return requested;
  if (status === 'completed') return 'closed';
  if (status === 'approved') return 'repair';
  if (status === 'quoted') return 'estimate';
  if (status === 'diagnosing') return 'diagnostic';
  if (status === 'scheduled') return 'visit_scheduled';
  if (status === 'triaged') return 'triage';
  return 'intake';
}

function computeSlaTargetAt(urgency) {
  const hours = { emergency: 4, urgent: 12, normal: 24, low: 72 }[urgency] || 24;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function computeFollowUpDueAt(status, scheduledStartAt) {
  if (status === 'quoted') return new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  if (status === 'diagnosing') return new Date(Date.now() + 12 * 60 * 60 * 1000);
  if (scheduledStartAt) return new Date(new Date(scheduledStartAt).getTime() + 12 * 60 * 60 * 1000);
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
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
    `INSERT INTO trades_operation_settings (business_id)
     VALUES ($1)
     ON CONFLICT (business_id) DO NOTHING`,
    [businessId]
  );
}

function buildTemplateIntake(body = {}) {
  return {
    property_type: trimString(body.property_type || body.propertyType, 80) || null,
    issue_source: trimString(body.issue_source || body.issueSource, 120) || null,
    warning_lights: trimString(body.warning_lights || body.warningLights, 255) || null,
    outage_scope: trimString(body.outage_scope || body.outageScope, 255) || null,
    access_constraints: trimString(body.access_constraints || body.accessConstraints, 500) || null,
    prior_repairs: trimString(body.prior_repairs || body.priorRepairs, 1000) || null,
  };
}

async function loadWorkspace(client, businessId) {
  await ensureSettingsRow(client, businessId);
  const [settingsRes, diagnosticsRes, recommendationsRes, trustRes, metricsRes] = await Promise.all([
    client.query(`SELECT * FROM trades_operation_settings WHERE business_id = $1`, [businessId]),
    client.query(
      `SELECT *
       FROM trades_diagnostic_requests
       WHERE business_id = $1
       ORDER BY
         CASE status
           WHEN 'new' THEN 1
           WHEN 'triaged' THEN 2
           WHEN 'scheduled' THEN 3
           WHEN 'diagnosing' THEN 4
           WHEN 'quoted' THEN 5
           ELSE 6
         END,
         created_at DESC
       LIMIT 100`,
      [businessId]
    ),
    client.query(
      `SELECT *
       FROM trades_service_recommendations
       WHERE business_id = $1
       ORDER BY
         CASE priority
           WHEN 'critical' THEN 1
           WHEN 'recommended' THEN 2
           ELSE 3
         END,
         created_at DESC`,
      [businessId]
    ),
    client.query(
      `SELECT *
       FROM trades_trust_records
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
      `WITH diagnostic_stats AS (
         SELECT
           COUNT(*)::int AS total_requests,
           COUNT(*) FILTER (WHERE status IN ('new','triaged','scheduled','diagnosing','quoted','approved'))::int AS open_requests,
           COUNT(*) FILTER (WHERE follow_up_due_at IS NOT NULL AND follow_up_due_at <= NOW() AND status NOT IN ('completed','declined','cancelled'))::int AS follow_up_due,
           COUNT(*) FILTER (WHERE sla_target_at IS NOT NULL AND sla_target_at < NOW() AND status NOT IN ('completed','declined','cancelled'))::int AS overdue_sla,
           COUNT(*) FILTER (WHERE template_slug = 'auto_mechanic')::int AS auto_requests,
           COUNT(*) FILTER (WHERE template_slug IN ('trades_pro', 'electrician'))::int AS field_requests
         FROM trades_diagnostic_requests
         WHERE business_id = $1
       ),
       recommendation_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE priority = 'critical' AND status NOT IN ('completed','declined'))::int AS critical_recommendations,
           COALESCE(SUM(estimated_cents) FILTER (WHERE status IN ('open','quoted','approved')), 0)::bigint AS open_recommendation_value
         FROM trades_service_recommendations
         WHERE business_id = $1
       ),
       trust_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE status = 'active')::int AS active_trust_records,
           COUNT(*) FILTER (WHERE status IN ('expiring', 'expired') OR (expires_on IS NOT NULL AND expires_on <= CURRENT_DATE + INTERVAL '30 day'))::int AS trust_expiring
         FROM trades_trust_records
         WHERE business_id = $1
       )
       SELECT *
       FROM diagnostic_stats, recommendation_stats, trust_stats`,
      [businessId]
    ),
  ]);

  return {
    settings: settingsRes.rows[0],
    diagnostics: diagnosticsRes.rows,
    recommendations: recommendationsRes.rows,
    trustRecords: trustRes.rows,
    metrics: metricsRes.rows[0] || {},
  };
}

exports.getPublicWorkspace = async (req, res, next) => {
  try {
    const business = await getBusinessOrThrow(req.params.businessId);
    const client = await pool.connect();
    try {
      const workspace = await loadWorkspace(client, business.id);
      return res.json({
        business: {
          id: business.id,
          business_name: business.business_name,
          active_template: business.active_template || 'default',
        },
        settings: {
          diagnostics_enabled: workspace.settings.diagnostics_enabled,
          emergency_service_enabled: workspace.settings.emergency_service_enabled,
          response_promise_hours: workspace.settings.response_promise_hours,
          estimate_turnaround_hours: workspace.settings.estimate_turnaround_hours,
          booking_style: workspace.settings.booking_style,
          primary_quote_label: workspace.settings.primary_quote_label,
          supported_issue_types: workspace.settings.supported_issue_types,
          service_asset_types: workspace.settings.service_asset_types,
          trust_artifacts: workspace.settings.trust_artifacts,
          intake_instructions: workspace.settings.intake_instructions,
          emergency_phone: workspace.settings.emergency_phone,
        },
        trustRecords: workspace.trustRecords.slice(0, 6),
        recommendations: workspace.recommendations.slice(0, 6),
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
      `UPDATE trades_operation_settings
       SET diagnostics_enabled = COALESCE($2, diagnostics_enabled),
           emergency_service_enabled = COALESCE($3, emergency_service_enabled),
           response_promise_hours = COALESCE($4, response_promise_hours),
           estimate_turnaround_hours = COALESCE($5, estimate_turnaround_hours),
           booking_style = COALESCE($6, booking_style),
           primary_quote_label = COALESCE($7, primary_quote_label),
           supported_issue_types = CASE WHEN $8::text[] IS NULL OR cardinality($8::text[]) = 0 THEN supported_issue_types ELSE $8::text[] END,
           service_asset_types = CASE WHEN $9::text[] IS NULL OR cardinality($9::text[]) = 0 THEN service_asset_types ELSE $9::text[] END,
           trust_artifacts = CASE WHEN $10::text[] IS NULL OR cardinality($10::text[]) = 0 THEN trust_artifacts ELSE $10::text[] END,
           dispatch_notes = $11,
           intake_instructions = $12,
           emergency_phone = $13,
           updated_at = NOW()
       WHERE business_id = $1
       RETURNING *`,
      [
        req.business.id,
        req.body.diagnostics_enabled,
        req.body.emergency_service_enabled,
        toIntOrNull(req.body.response_promise_hours),
        toIntOrNull(req.body.estimate_turnaround_hours),
        trimString(req.body.booking_style, 24) || null,
        trimString(req.body.primary_quote_label, 120) || null,
        toArray(req.body.supported_issue_types, 20, 120).length ? toArray(req.body.supported_issue_types, 20, 120) : null,
        toArray(req.body.service_asset_types, 12, 80).length ? toArray(req.body.service_asset_types, 12, 80) : null,
        toArray(req.body.trust_artifacts, 12, 120).length ? toArray(req.body.trust_artifacts, 12, 120) : null,
        trimString(req.body.dispatch_notes, 2000) || null,
        trimString(req.body.intake_instructions, 2000) || null,
        trimString(req.body.emergency_phone, 60) || null,
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

exports.createDiagnosticRequest = async (req, res, next) => {
  try {
    const business = await getBusinessOrThrow(req.params.businessId);
    const title = trimString(req.body.title, 200);
    const description = trimString(req.body.description, 4000);
    const issueType = trimString(req.body.issue_type || req.body.issueType, 120);
    if (!title || !description || !issueType) {
      throw new AppError('Title, description, and issue type are required', 400, 'validation_failed');
    }

    let photoUrls = [];
    if (req.files?.length) {
      const uploads = await Promise.allSettled(
        req.files.slice(0, 5).map((file) => uploadFile(file.buffer, 'trades-diagnostics', file.originalname, file.mimetype))
      );
      photoUrls = uploads
        .filter((result) => result.status === 'fulfilled' && result.value)
        .map((result) => getPublicUrl(result.value));
      const failed = uploads.filter((result) => result.status === 'rejected' || !result.value).length;
      if (failed) logger.warn('Trades diagnostic photo upload skipped', { failed, total: req.files.length });
    }

    const urgency = VALID_URGENCY.has(req.body.urgency) ? req.body.urgency : 'normal';
    const status = VALID_STATUS.has(req.body.status) ? req.body.status : 'new';
    const workflowStage = deriveStage(status, req.body.workflow_stage);
    const scheduledStart = req.body.scheduled_start_at || req.body.scheduledStartAt || null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO trades_diagnostic_requests (
           business_id, requester_id, assigned_helper_id, linked_quote_id, status, workflow_stage,
           request_channel, template_slug, urgency, issue_type, title, description,
           contact_name, contact_email, contact_phone, service_address, preferred_times,
           asset_label, asset_year, vin, mileage, safety_sensitive, symptoms_started_at,
           current_status_note, internal_notes, photo_urls, template_intake, diagnostic_fee_cents,
           estimated_repair_cents, sla_target_at, follow_up_due_at, scheduled_start_at, scheduled_end_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb,$28,$29,$30,$31,$32,$33)
         RETURNING *`,
        [
          business.id,
          req.user?.id || null,
          req.body.assigned_helper_id || null,
          req.body.linked_quote_id || null,
          status,
          workflowStage,
          VALID_REQUEST_CHANNEL.has(req.body.request_channel) ? req.body.request_channel : 'public_profile',
          trimString(req.body.template_slug, 60) || business.active_template || 'trades_pro',
          urgency,
          issueType,
          title,
          description,
          trimString(req.body.contact_name || req.body.contactName, 160) || null,
          trimString(req.body.contact_email || req.body.contactEmail, 255) || null,
          trimString(req.body.contact_phone || req.body.contactPhone, 60) || null,
          trimString(req.body.service_address || req.body.serviceAddress, 1000) || null,
          trimString(req.body.preferred_times || req.body.preferredTimes, 1200) || null,
          trimString(req.body.asset_label || req.body.assetLabel, 200) || null,
          trimString(req.body.asset_year || req.body.assetYear, 20) || null,
          trimString(req.body.vin, 32) || null,
          trimString(req.body.mileage, 40) || null,
          req.body.safety_sensitive === true || req.body.safety_sensitive === 'true',
          trimString(req.body.symptoms_started_at || req.body.symptomsStartedAt, 160) || null,
          trimString(req.body.current_status_note, 2000) || null,
          trimString(req.body.internal_notes, 4000) || null,
          photoUrls,
          JSON.stringify(buildTemplateIntake(req.body)),
          Math.max(0, toIntOrNull(req.body.diagnostic_fee_cents) || 0),
          toIntOrNull(req.body.estimated_repair_cents),
          computeSlaTargetAt(urgency),
          computeFollowUpDueAt(status, scheduledStart),
          scheduledStart,
          req.body.scheduled_end_at || req.body.scheduledEndAt || null,
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

exports.updateDiagnosticRequest = async (req, res, next) => {
  try {
    const existingRes = await pool.query(
      'SELECT * FROM trades_diagnostic_requests WHERE id = $1 AND business_id = $2',
      [req.params.requestId, req.business.id]
    );
    const existing = existingRes.rows[0];
    if (!existing) throw new AppError('Diagnostic request not found', 404, 'not_found');
    const nextStatus = VALID_STATUS.has(req.body.status) ? req.body.status : existing.status;
    const workflowStage = deriveStage(nextStatus, req.body.workflow_stage || existing.workflow_stage);
    const scheduledStart = req.body.scheduled_start_at || req.body.scheduledStartAt || existing.scheduled_start_at;
    const mergedIntake = req.body.template_intake ? { ...(existing.template_intake || {}), ...req.body.template_intake } : existing.template_intake;
    const { rows } = await pool.query(
      `UPDATE trades_diagnostic_requests
       SET assigned_helper_id = COALESCE($1, assigned_helper_id),
           linked_quote_id = COALESCE($2, linked_quote_id),
           status = $3,
           workflow_stage = $4,
           urgency = COALESCE($5, urgency),
           current_status_note = COALESCE($6, current_status_note),
           internal_notes = COALESCE($7, internal_notes),
           diagnostic_fee_cents = COALESCE($8, diagnostic_fee_cents),
           estimated_repair_cents = COALESCE($9, estimated_repair_cents),
           follow_up_due_at = COALESCE($10, follow_up_due_at),
           scheduled_start_at = COALESCE($11, scheduled_start_at),
           scheduled_end_at = COALESCE($12, scheduled_end_at),
           template_intake = COALESCE($13::jsonb, template_intake),
           updated_at = NOW()
       WHERE id = $14 AND business_id = $15
       RETURNING *`,
      [
        req.body.assigned_helper_id || null,
        req.body.linked_quote_id || null,
        nextStatus,
        workflowStage,
        VALID_URGENCY.has(req.body.urgency) ? req.body.urgency : null,
        trimString(req.body.current_status_note, 2000) || null,
        trimString(req.body.internal_notes, 4000) || null,
        toIntOrNull(req.body.diagnostic_fee_cents),
        toIntOrNull(req.body.estimated_repair_cents),
        req.body.follow_up_due_at || req.body.followUpDueAt || computeFollowUpDueAt(nextStatus, scheduledStart),
        scheduledStart || null,
        req.body.scheduled_end_at || req.body.scheduledEndAt || null,
        mergedIntake ? JSON.stringify(mergedIntake) : null,
        req.params.requestId,
        req.business.id,
      ]
    );
    res.json({ request: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.createRecommendation = async (req, res, next) => {
  try {
    const title = trimString(req.body.title, 180);
    if (!title) throw new AppError('Recommendation title is required', 400, 'validation_failed');
    const { rows } = await pool.query(
      `INSERT INTO trades_service_recommendations (
         business_id, diagnostic_request_id, quote_id, title, recommendation_type,
         priority, description, estimated_cents, status
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        req.business.id,
        req.body.diagnostic_request_id || null,
        req.body.quote_id || null,
        title,
        VALID_RECOMMENDATION_TYPE.has(req.body.recommendation_type) ? req.body.recommendation_type : 'repair',
        VALID_RECOMMENDATION_PRIORITY.has(req.body.priority) ? req.body.priority : 'recommended',
        trimString(req.body.description, 4000) || null,
        toIntOrNull(req.body.estimated_cents),
        VALID_RECOMMENDATION_STATUS.has(req.body.status) ? req.body.status : 'open',
      ]
    );
    res.status(201).json({ recommendation: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.updateRecommendation = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE trades_service_recommendations
       SET diagnostic_request_id = COALESCE($1, diagnostic_request_id),
           quote_id = COALESCE($2, quote_id),
           title = COALESCE($3, title),
           recommendation_type = COALESCE($4, recommendation_type),
           priority = COALESCE($5, priority),
           description = COALESCE($6, description),
           estimated_cents = COALESCE($7, estimated_cents),
           status = COALESCE($8, status),
           updated_at = NOW()
       WHERE id = $9 AND business_id = $10
       RETURNING *`,
      [
        req.body.diagnostic_request_id || null,
        req.body.quote_id || null,
        trimString(req.body.title, 180) || null,
        VALID_RECOMMENDATION_TYPE.has(req.body.recommendation_type) ? req.body.recommendation_type : null,
        VALID_RECOMMENDATION_PRIORITY.has(req.body.priority) ? req.body.priority : null,
        trimString(req.body.description, 4000) || null,
        toIntOrNull(req.body.estimated_cents),
        VALID_RECOMMENDATION_STATUS.has(req.body.status) ? req.body.status : null,
        req.params.recommendationId,
        req.business.id,
      ]
    );
    if (!rows.length) throw new AppError('Recommendation not found', 404, 'not_found');
    res.json({ recommendation: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.deleteRecommendation = async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM trades_service_recommendations WHERE id = $1 AND business_id = $2',
      [req.params.recommendationId, req.business.id]
    );
    if (!result.rowCount) throw new AppError('Recommendation not found', 404, 'not_found');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

exports.createTrustRecord = async (req, res, next) => {
  try {
    const title = trimString(req.body.title, 180);
    const type = trimString(req.body.record_type, 60);
    if (!title || !type) throw new AppError('Record type and title are required', 400, 'validation_failed');
    const { rows } = await pool.query(
      `INSERT INTO trades_trust_records (
         business_id, record_type, title, issuer, status, expires_on, document_url, notes
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        req.business.id,
        type,
        title,
        trimString(req.body.issuer, 180) || null,
        VALID_TRUST_STATUS.has(req.body.status) ? req.body.status : 'active',
        req.body.expires_on || null,
        trimString(req.body.document_url, 2000) || null,
        trimString(req.body.notes, 4000) || null,
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
      `UPDATE trades_trust_records
       SET record_type = COALESCE($1, record_type),
           title = COALESCE($2, title),
           issuer = COALESCE($3, issuer),
           status = COALESCE($4, status),
           expires_on = COALESCE($5, expires_on),
           document_url = COALESCE($6, document_url),
           notes = COALESCE($7, notes),
           updated_at = NOW()
       WHERE id = $8 AND business_id = $9
       RETURNING *`,
      [
        trimString(req.body.record_type, 60) || null,
        trimString(req.body.title, 180) || null,
        trimString(req.body.issuer, 180) || null,
        VALID_TRUST_STATUS.has(req.body.status) ? req.body.status : null,
        req.body.expires_on || null,
        trimString(req.body.document_url, 2000) || null,
        trimString(req.body.notes, 4000) || null,
        req.params.recordId,
        req.business.id,
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
      'DELETE FROM trades_trust_records WHERE id = $1 AND business_id = $2',
      [req.params.recordId, req.business.id]
    );
    if (!result.rowCount) throw new AppError('Trust record not found', 404, 'not_found');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
