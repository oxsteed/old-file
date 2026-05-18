const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');

const VALID_STATUS = new Set(['new', 'discovery_scheduled', 'proposal_sent', 'active', 'waiting_on_client', 'completed', 'archived']);
const VALID_STAGE = new Set(['intake', 'scoping', 'documents', 'delivery', 'follow_up', 'closed']);
const VALID_PACKAGE_TYPE = new Set(['session', 'engagement', 'retainer', 'filing']);
const VALID_RECORD_TYPE = new Set(['license', 'document', 'deadline', 'deliverable', 'compliance', 'follow_up']);
const VALID_RECORD_STATUS = new Set(['pending', 'ready', 'completed', 'expired', 'archived']);

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
  if (status === 'archived') return 'closed';
  if (status === 'completed') return 'follow_up';
  if (status === 'waiting_on_client') return 'documents';
  if (status === 'active') return 'delivery';
  if (status === 'proposal_sent') return 'scoping';
  return 'intake';
}

function computeFollowUpDueAt(status) {
  if (status === 'new') return new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (status === 'proposal_sent') return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  if (status === 'completed') return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return new Date(Date.now() + 48 * 60 * 60 * 1000);
}

function computeObligationDueAt(templateSlug) {
  const daysByTemplate = {
    accountant: 30,
    consulting_coaching: 14,
    legal_admin: 21,
  };
  const days = daysByTemplate[templateSlug] || 30;
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
    `INSERT INTO professional_operation_settings (business_id)
     VALUES ($1)
     ON CONFLICT (business_id) DO NOTHING`,
    [businessId]
  );
}

async function loadWorkspace(client, businessId) {
  await ensureSettingsRow(client, businessId);
  const [settingsRes, requestsRes, packagesRes, recordsRes, metricsRes] = await Promise.all([
    client.query(`SELECT * FROM professional_operation_settings WHERE business_id = $1`, [businessId]),
    client.query(
      `SELECT *
       FROM professional_engagement_requests
       WHERE business_id = $1
       ORDER BY
         CASE status
           WHEN 'new' THEN 1
           WHEN 'discovery_scheduled' THEN 2
           WHEN 'proposal_sent' THEN 3
           WHEN 'active' THEN 4
           ELSE 5
         END,
         created_at DESC
       LIMIT 100`,
      [businessId]
    ),
    client.query(
      `SELECT *
       FROM professional_service_packages
       WHERE business_id = $1
       ORDER BY active DESC, created_at DESC`,
      [businessId]
    ),
    client.query(
      `SELECT *
       FROM professional_compliance_records
       WHERE business_id = $1
       ORDER BY
         CASE status
           WHEN 'pending' THEN 1
           WHEN 'expired' THEN 2
           ELSE 3
         END,
         due_at NULLS LAST,
         created_at DESC`,
      [businessId]
    ),
    client.query(
      `WITH request_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE status IN ('new', 'discovery_scheduled', 'proposal_sent', 'active', 'waiting_on_client'))::int AS open_requests,
           COUNT(*) FILTER (WHERE status = 'proposal_sent')::int AS proposals_waiting,
           COUNT(*) FILTER (WHERE follow_up_due_at IS NOT NULL AND follow_up_due_at <= NOW() AND status <> 'archived')::int AS follow_up_due,
           COUNT(*) FILTER (WHERE obligation_due_at IS NOT NULL AND obligation_due_at <= NOW() AND status <> 'archived')::int AS obligations_due
         FROM professional_engagement_requests
         WHERE business_id = $1
       ),
       package_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE active = TRUE)::int AS active_packages,
           COALESCE(SUM(price_cents) FILTER (WHERE active = TRUE), 0)::bigint AS package_value_cents
         FROM professional_service_packages
         WHERE business_id = $1
       ),
       record_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE status IN ('pending', 'expired'))::int AS records_needing_attention,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_records
         FROM professional_compliance_records
         WHERE business_id = $1
       )
       SELECT *
       FROM request_stats, package_stats, record_stats`,
      [businessId]
    ),
  ]);

  return {
    settings: settingsRes.rows[0],
    engagementRequests: requestsRes.rows,
    packages: packagesRes.rows,
    complianceRecords: recordsRes.rows,
    metrics: metricsRes.rows[0] || {},
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
          active_template: business.active_template || 'consulting_coaching',
        },
        settings: {
          response_promise_hours: workspace.settings.response_promise_hours,
          consultation_label: workspace.settings.consultation_label,
          recurring_reminder_days: workspace.settings.recurring_reminder_days,
          document_checklist: workspace.settings.document_checklist,
          obligation_types: workspace.settings.obligation_types,
          trust_artifacts: workspace.settings.trust_artifacts,
          follow_up_prompt: workspace.settings.follow_up_prompt,
          engagement_policy: workspace.settings.engagement_policy,
          preferred_contact_channel: workspace.settings.preferred_contact_channel,
        },
        packages: workspace.packages.filter((item) => item.active).slice(0, 6),
        complianceRecords: workspace.complianceRecords.slice(0, 6),
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
      `UPDATE professional_operation_settings
       SET response_promise_hours = COALESCE($2, response_promise_hours),
           consultation_label = COALESCE($3, consultation_label),
           recurring_reminder_days = COALESCE($4, recurring_reminder_days),
           document_checklist = CASE WHEN $5::text[] IS NULL OR cardinality($5::text[]) = 0 THEN document_checklist ELSE $5::text[] END,
           obligation_types = CASE WHEN $6::text[] IS NULL OR cardinality($6::text[]) = 0 THEN obligation_types ELSE $6::text[] END,
           trust_artifacts = CASE WHEN $7::text[] IS NULL OR cardinality($7::text[]) = 0 THEN trust_artifacts ELSE $7::text[] END,
           follow_up_prompt = $8,
           engagement_policy = $9,
           preferred_contact_channel = COALESCE($10, preferred_contact_channel),
           updated_at = NOW()
       WHERE business_id = $1
       RETURNING *`,
      [
        req.business.id,
        toIntOrNull(req.body.response_promise_hours),
        trimString(req.body.consultation_label, 120) || null,
        toIntOrNull(req.body.recurring_reminder_days),
        toArray(req.body.document_checklist, 12, 140).length ? toArray(req.body.document_checklist, 12, 140) : null,
        toArray(req.body.obligation_types, 12, 140).length ? toArray(req.body.obligation_types, 12, 140) : null,
        toArray(req.body.trust_artifacts, 12, 140).length ? toArray(req.body.trust_artifacts, 12, 140) : null,
        trimString(req.body.follow_up_prompt, 2000) || null,
        trimString(req.body.engagement_policy, 2000) || null,
        trimString(req.body.preferred_contact_channel, 30) || null,
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

exports.createEngagementRequest = async (req, res, next) => {
  try {
    const business = await getBusinessOrThrow(req.params.businessId);
    const serviceNeed = trimString(req.body.service_need || req.body.serviceNeed, 180);
    if (!serviceNeed) throw new AppError('Service need is required', 400, 'validation_failed');

    const templateSlug = trimString(req.body.template_slug, 60) || business.active_template || 'consulting_coaching';
    const status = VALID_STATUS.has(req.body.status) ? req.body.status : 'new';
    const { rows } = await pool.query(
      `INSERT INTO professional_engagement_requests (
         business_id, requester_id, linked_quote_id, status, workflow_stage, template_slug,
         service_need, business_context, timeline_notes, document_summary, package_interest,
         budget_notes, contact_name, contact_email, contact_phone, preferred_contact_channel,
         internal_notes, customer_visible_note, follow_up_due_at, obligation_due_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [
        business.id,
        req.user?.id || null,
        req.body.linked_quote_id || null,
        status,
        deriveStage(status, req.body.workflow_stage),
        templateSlug,
        serviceNeed,
        trimString(req.body.business_context || req.body.businessContext, 3000) || null,
        trimString(req.body.timeline_notes || req.body.timelineNotes, 255) || null,
        trimString(req.body.document_summary || req.body.documentSummary, 3000) || null,
        trimString(req.body.package_interest || req.body.packageInterest, 180) || null,
        trimString(req.body.budget_notes || req.body.budgetNotes, 255) || null,
        trimString(req.body.contact_name || req.body.contactName, 160) || null,
        trimString(req.body.contact_email || req.body.contactEmail, 255) || null,
        trimString(req.body.contact_phone || req.body.contactPhone, 60) || null,
        trimString(req.body.preferred_contact_channel || req.body.preferredContactChannel, 30) || null,
        trimString(req.body.internal_notes, 4000) || null,
        trimString(req.body.customer_visible_note, 2000) || null,
        computeFollowUpDueAt(status),
        computeObligationDueAt(templateSlug),
      ]
    );
    res.status(201).json({ request: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.updateEngagementRequest = async (req, res, next) => {
  try {
    const status = VALID_STATUS.has(req.body.status) ? req.body.status : null;
    const { rows } = await pool.query(
      `UPDATE professional_engagement_requests
       SET linked_quote_id = COALESCE($3, linked_quote_id),
           status = COALESCE($4, status),
           workflow_stage = COALESCE($5, workflow_stage),
           package_interest = COALESCE($6, package_interest),
           internal_notes = COALESCE($7, internal_notes),
           customer_visible_note = COALESCE($8, customer_visible_note),
           follow_up_due_at = COALESCE($9, follow_up_due_at),
           obligation_due_at = COALESCE($10, obligation_due_at),
           updated_at = NOW()
       WHERE id = $1
         AND business_id = $2
       RETURNING *`,
      [
        req.params.requestId,
        req.business.id,
        req.body.linked_quote_id || null,
        status,
        status ? deriveStage(status, req.body.workflow_stage) : (VALID_STAGE.has(req.body.workflow_stage) ? req.body.workflow_stage : null),
        trimString(req.body.package_interest, 180) || null,
        trimString(req.body.internal_notes, 4000) || null,
        trimString(req.body.customer_visible_note, 2000) || null,
        req.body.follow_up_due_at || null,
        req.body.obligation_due_at || null,
      ]
    );
    if (!rows.length) throw new AppError('Engagement request not found', 404, 'not_found');
    res.json({ request: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.createPackage = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO professional_service_packages (
         business_id, package_name, package_type, target_templates, description,
         price_cents, cadence_label, deliverables, active
       )
       VALUES ($1,$2,$3,$4::text[],$5,$6,$7,$8::text[],$9)
       RETURNING *`,
      [
        req.business.id,
        trimString(req.body.package_name, 180),
        VALID_PACKAGE_TYPE.has(req.body.package_type) ? req.body.package_type : 'engagement',
        toArray(req.body.target_templates, 8, 60).length ? toArray(req.body.target_templates, 8, 60) : ['consulting_coaching'],
        trimString(req.body.description, 3000) || null,
        Math.max(0, toIntOrNull(req.body.price_cents) || 0),
        trimString(req.body.cadence_label, 120) || null,
        toArray(req.body.deliverables, 12, 180),
        req.body.active !== false,
      ]
    );
    res.status(201).json({ package: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.updatePackage = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE professional_service_packages
       SET package_name = COALESCE($3, package_name),
           package_type = COALESCE($4, package_type),
           target_templates = CASE WHEN $5::text[] IS NULL OR cardinality($5::text[]) = 0 THEN target_templates ELSE $5::text[] END,
           description = COALESCE($6, description),
           price_cents = COALESCE($7, price_cents),
           cadence_label = COALESCE($8, cadence_label),
           deliverables = CASE WHEN $9::text[] IS NULL THEN deliverables ELSE $9::text[] END,
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
        trimString(req.body.cadence_label, 120) || null,
        Array.isArray(req.body.deliverables) ? toArray(req.body.deliverables, 12, 180) : null,
        typeof req.body.active === 'boolean' ? req.body.active : null,
      ]
    );
    if (!rows.length) throw new AppError('Professional package not found', 404, 'not_found');
    res.json({ package: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.deletePackage = async (req, res, next) => {
  try {
    const result = await pool.query(
      `DELETE FROM professional_service_packages
       WHERE id = $1
         AND business_id = $2`,
      [req.params.packageId, req.business.id]
    );
    if (!result.rowCount) throw new AppError('Professional package not found', 404, 'not_found');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

exports.createComplianceRecord = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO professional_compliance_records (
         business_id, engagement_request_id, record_type, title, status, due_at, document_url, notes
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        req.business.id,
        req.body.engagement_request_id || null,
        VALID_RECORD_TYPE.has(req.body.record_type) ? req.body.record_type : 'document',
        trimString(req.body.title, 180),
        VALID_RECORD_STATUS.has(req.body.status) ? req.body.status : 'pending',
        req.body.due_at || null,
        trimString(req.body.document_url, 2000) || null,
        trimString(req.body.notes, 3000) || null,
      ]
    );
    res.status(201).json({ record: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.updateComplianceRecord = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE professional_compliance_records
       SET engagement_request_id = COALESCE($3, engagement_request_id),
           record_type = COALESCE($4, record_type),
           title = COALESCE($5, title),
           status = COALESCE($6, status),
           due_at = COALESCE($7, due_at),
           document_url = COALESCE($8, document_url),
           notes = COALESCE($9, notes),
           updated_at = NOW()
       WHERE id = $1
         AND business_id = $2
       RETURNING *`,
      [
        req.params.recordId,
        req.business.id,
        req.body.engagement_request_id || null,
        VALID_RECORD_TYPE.has(req.body.record_type) ? req.body.record_type : null,
        trimString(req.body.title, 180) || null,
        VALID_RECORD_STATUS.has(req.body.status) ? req.body.status : null,
        req.body.due_at || null,
        trimString(req.body.document_url, 2000) || null,
        trimString(req.body.notes, 3000) || null,
      ]
    );
    if (!rows.length) throw new AppError('Compliance record not found', 404, 'not_found');
    res.json({ record: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.deleteComplianceRecord = async (req, res, next) => {
  try {
    const result = await pool.query(
      `DELETE FROM professional_compliance_records
       WHERE id = $1
         AND business_id = $2`,
      [req.params.recordId, req.business.id]
    );
    if (!result.rowCount) throw new AppError('Compliance record not found', 404, 'not_found');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
