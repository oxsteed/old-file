const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { uploadFile, getPublicUrl } = require('../utils/storage');
const logger = require('../utils/logger');

const VALID_STATUS = new Set(['new', 'discovery_scheduled', 'proposal_sent', 'active', 'in_review', 'approved', 'delivered', 'archived']);
const VALID_STAGE = new Set(['intake', 'discovery', 'proposal', 'production', 'review', 'delivery', 'follow_up', 'closed']);
const VALID_PACKAGE_TYPE = new Set(['session', 'project', 'campaign', 'retainer']);
const VALID_RECORD_TYPE = new Set(['brief', 'proof', 'approval', 'delivery', 'usage_rights', 'testimonial']);
const VALID_RECORD_STATUS = new Set(['pending', 'approved', 'revisions_requested', 'delivered', 'archived']);

function trimString(value, max = 4000) {
  const text = String(value ?? '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function toIntOrNull(value) {
  if (value === '' || value == null) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toArray(value, maxItems = 16, maxLength = 200) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => trimString(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function deriveStage(status, requested) {
  if (VALID_STAGE.has(requested)) return requested;
  if (status === 'archived') return 'closed';
  if (status === 'delivered') return 'follow_up';
  if (status === 'approved') return 'delivery';
  if (status === 'in_review') return 'review';
  if (status === 'active') return 'production';
  if (status === 'proposal_sent') return 'proposal';
  if (status === 'discovery_scheduled') return 'discovery';
  return 'intake';
}

function computeFollowUpDueAt(status) {
  if (status === 'new') return new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (status === 'proposal_sent') return new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  if (status === 'delivered') return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  return new Date(Date.now() + 48 * 60 * 60 * 1000);
}

function computeDeliveryTarget(templateSlug) {
  const daysByTemplate = {
    photographer: 10,
    graphic_design: 14,
    creative_studio: 21,
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
    `INSERT INTO creative_operation_settings (business_id)
     VALUES ($1)
     ON CONFLICT (business_id) DO NOTHING`,
    [businessId]
  );
}

async function loadWorkspace(client, businessId) {
  await ensureSettingsRow(client, businessId);
  const [settingsRes, intakeRes, packagesRes, approvalsRes, metricsRes] = await Promise.all([
    client.query(`SELECT * FROM creative_operation_settings WHERE business_id = $1`, [businessId]),
    client.query(
      `SELECT *
       FROM creative_intake_requests
       WHERE business_id = $1
       ORDER BY
         CASE status
           WHEN 'new' THEN 1
           WHEN 'discovery_scheduled' THEN 2
           WHEN 'proposal_sent' THEN 3
           WHEN 'active' THEN 4
           WHEN 'in_review' THEN 5
           ELSE 6
         END,
         created_at DESC
       LIMIT 100`,
      [businessId]
    ),
    client.query(
      `SELECT *
       FROM creative_project_packages
       WHERE business_id = $1
       ORDER BY active DESC, created_at DESC`,
      [businessId]
    ),
    client.query(
      `SELECT *
       FROM creative_approval_records
       WHERE business_id = $1
       ORDER BY
         CASE status
           WHEN 'pending' THEN 1
           WHEN 'revisions_requested' THEN 2
           ELSE 3
         END,
         due_at NULLS LAST,
         created_at DESC`,
      [businessId]
    ),
    client.query(
      `WITH intake_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE status IN ('new', 'discovery_scheduled', 'proposal_sent', 'active', 'in_review'))::int AS open_intakes,
           COUNT(*) FILTER (WHERE status = 'proposal_sent')::int AS proposals_waiting,
           COUNT(*) FILTER (WHERE status = 'delivered' AND created_at >= NOW() - INTERVAL '30 day')::int AS delivered_last_30,
           COUNT(*) FILTER (WHERE follow_up_due_at IS NOT NULL AND follow_up_due_at <= NOW() AND status <> 'archived')::int AS follow_up_due
         FROM creative_intake_requests
         WHERE business_id = $1
       ),
       package_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE active = TRUE)::int AS active_packages,
           COALESCE(SUM(price_cents) FILTER (WHERE active = TRUE), 0)::bigint AS package_value_cents
         FROM creative_project_packages
         WHERE business_id = $1
       ),
       approval_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE status IN ('pending', 'revisions_requested'))::int AS approvals_pending,
           COUNT(*) FILTER (WHERE due_at IS NOT NULL AND due_at <= NOW() AND status IN ('pending', 'revisions_requested'))::int AS approvals_overdue
         FROM creative_approval_records
         WHERE business_id = $1
       )
       SELECT *
       FROM intake_stats, package_stats, approval_stats`,
      [businessId]
    ),
  ]);

  return {
    settings: settingsRes.rows[0],
    intakeRequests: intakeRes.rows,
    packages: packagesRes.rows,
    approvalRecords: approvalsRes.rows,
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
          active_template: business.active_template || 'creative_studio',
        },
        settings: {
          response_promise_hours: workspace.settings.response_promise_hours,
          discovery_call_label: workspace.settings.discovery_call_label,
          delivery_window_days: workspace.settings.delivery_window_days,
          approval_turnaround_hours: workspace.settings.approval_turnaround_hours,
          revision_policy: workspace.settings.revision_policy,
          approval_policy: workspace.settings.approval_policy,
          follow_up_prompt: workspace.settings.follow_up_prompt,
          testimonial_prompt: workspace.settings.testimonial_prompt,
          gallery_focus_tags: workspace.settings.gallery_focus_tags,
          deliverable_types: workspace.settings.deliverable_types,
          trust_artifacts: workspace.settings.trust_artifacts,
          preferred_contact_channel: workspace.settings.preferred_contact_channel,
        },
        packages: workspace.packages.filter((item) => item.active).slice(0, 6),
        approvalRecords: workspace.approvalRecords.slice(0, 6),
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
      `UPDATE creative_operation_settings
       SET response_promise_hours = COALESCE($2, response_promise_hours),
           discovery_call_label = COALESCE($3, discovery_call_label),
           delivery_window_days = COALESCE($4, delivery_window_days),
           approval_turnaround_hours = COALESCE($5, approval_turnaround_hours),
           revision_policy = $6,
           approval_policy = $7,
           follow_up_prompt = $8,
           testimonial_prompt = $9,
           gallery_focus_tags = CASE WHEN $10::text[] IS NULL OR cardinality($10::text[]) = 0 THEN gallery_focus_tags ELSE $10::text[] END,
           deliverable_types = CASE WHEN $11::text[] IS NULL OR cardinality($11::text[]) = 0 THEN deliverable_types ELSE $11::text[] END,
           trust_artifacts = CASE WHEN $12::text[] IS NULL OR cardinality($12::text[]) = 0 THEN trust_artifacts ELSE $12::text[] END,
           preferred_contact_channel = COALESCE($13, preferred_contact_channel),
           updated_at = NOW()
       WHERE business_id = $1
       RETURNING *`,
      [
        req.business.id,
        toIntOrNull(req.body.response_promise_hours),
        trimString(req.body.discovery_call_label, 120) || null,
        toIntOrNull(req.body.delivery_window_days),
        toIntOrNull(req.body.approval_turnaround_hours),
        trimString(req.body.revision_policy, 2000) || null,
        trimString(req.body.approval_policy, 2000) || null,
        trimString(req.body.follow_up_prompt, 2000) || null,
        trimString(req.body.testimonial_prompt, 2000) || null,
        toArray(req.body.gallery_focus_tags, 12, 120).length ? toArray(req.body.gallery_focus_tags, 12, 120) : null,
        toArray(req.body.deliverable_types, 12, 120).length ? toArray(req.body.deliverable_types, 12, 120) : null,
        toArray(req.body.trust_artifacts, 12, 140).length ? toArray(req.body.trust_artifacts, 12, 140) : null,
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

exports.createIntakeRequest = async (req, res, next) => {
  try {
    const business = await getBusinessOrThrow(req.params.businessId);
    const projectType = trimString(req.body.project_type || req.body.projectType, 180);
    if (!projectType) throw new AppError('Project type is required', 400, 'validation_failed');

    let photoUrls = [];
    if (req.files?.length) {
      const uploads = await Promise.allSettled(
        req.files.slice(0, 5).map((file) => uploadFile(file.buffer, 'creative-intakes', file.originalname, file.mimetype))
      );
      photoUrls = uploads
        .filter((result) => result.status === 'fulfilled' && result.value)
        .map((result) => getPublicUrl(result.value));
      const failed = uploads.filter((result) => result.status === 'rejected' || !result.value).length;
      if (failed) logger.warn('Creative intake photo upload skipped', { failed, total: req.files.length });
    }

    const templateSlug = trimString(req.body.template_slug, 60) || business.active_template || 'creative_studio';
    const status = VALID_STATUS.has(req.body.status) ? req.body.status : 'new';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO creative_intake_requests (
           business_id, requester_id, linked_quote_id, status, workflow_stage, template_slug,
           project_type, project_goal, style_direction, deadline_notes, asset_needs, revision_scope,
           package_interest, budget_notes, contact_name, contact_email, contact_phone,
           preferred_contact_channel, reference_links, photo_urls, internal_notes, customer_visible_note,
           follow_up_due_at, delivery_target_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::text[],$20,$21,$22,$23,$24)
         RETURNING *`,
        [
          business.id,
          req.user?.id || null,
          req.body.linked_quote_id || null,
          status,
          deriveStage(status, req.body.workflow_stage),
          templateSlug,
          projectType,
          trimString(req.body.project_goal || req.body.projectGoal, 3000) || null,
          trimString(req.body.style_direction || req.body.styleDirection, 3000) || null,
          trimString(req.body.deadline_notes || req.body.deadlineNotes, 255) || null,
          trimString(req.body.asset_needs || req.body.assetNeeds, 3000) || null,
          trimString(req.body.revision_scope || req.body.revisionScope, 255) || null,
          trimString(req.body.package_interest || req.body.packageInterest, 180) || null,
          trimString(req.body.budget_notes || req.body.budgetNotes, 255) || null,
          trimString(req.body.contact_name || req.body.contactName, 160) || null,
          trimString(req.body.contact_email || req.body.contactEmail, 255) || null,
          trimString(req.body.contact_phone || req.body.contactPhone, 60) || null,
          trimString(req.body.preferred_contact_channel || req.body.preferredContactChannel, 30) || null,
          toArray(req.body.reference_links, 8, 300),
          photoUrls,
          trimString(req.body.internal_notes, 4000) || null,
          trimString(req.body.customer_visible_note, 2000) || null,
          computeFollowUpDueAt(status),
          computeDeliveryTarget(templateSlug),
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
  try {
    const status = VALID_STATUS.has(req.body.status) ? req.body.status : null;
    const { rows } = await pool.query(
      `UPDATE creative_intake_requests
       SET linked_quote_id = COALESCE($3, linked_quote_id),
           status = COALESCE($4, status),
           workflow_stage = COALESCE($5, workflow_stage),
           package_interest = COALESCE($6, package_interest),
           internal_notes = COALESCE($7, internal_notes),
           customer_visible_note = COALESCE($8, customer_visible_note),
           follow_up_due_at = COALESCE($9, follow_up_due_at),
           delivery_target_at = COALESCE($10, delivery_target_at),
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
        req.body.delivery_target_at || null,
      ]
    );
    if (!rows.length) throw new AppError('Creative intake request not found', 404, 'not_found');
    res.json({ request: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.createPackage = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO creative_project_packages (
         business_id, package_name, package_type, target_templates, description,
         price_cents, revision_rounds, deliverables, active
       )
       VALUES ($1,$2,$3,$4::text[],$5,$6,$7,$8::text[],$9)
       RETURNING *`,
      [
        req.business.id,
        trimString(req.body.package_name, 180),
        VALID_PACKAGE_TYPE.has(req.body.package_type) ? req.body.package_type : 'project',
        toArray(req.body.target_templates, 8, 60).length ? toArray(req.body.target_templates, 8, 60) : ['creative_studio'],
        trimString(req.body.description, 3000) || null,
        Math.max(0, toIntOrNull(req.body.price_cents) || 0),
        toIntOrNull(req.body.revision_rounds),
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
      `UPDATE creative_project_packages
       SET package_name = COALESCE($3, package_name),
           package_type = COALESCE($4, package_type),
           target_templates = CASE WHEN $5::text[] IS NULL OR cardinality($5::text[]) = 0 THEN target_templates ELSE $5::text[] END,
           description = COALESCE($6, description),
           price_cents = COALESCE($7, price_cents),
           revision_rounds = COALESCE($8, revision_rounds),
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
        toIntOrNull(req.body.revision_rounds),
        Array.isArray(req.body.deliverables) ? toArray(req.body.deliverables, 12, 180) : null,
        typeof req.body.active === 'boolean' ? req.body.active : null,
      ]
    );
    if (!rows.length) throw new AppError('Creative package not found', 404, 'not_found');
    res.json({ package: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.deletePackage = async (req, res, next) => {
  try {
    const result = await pool.query(
      `DELETE FROM creative_project_packages
       WHERE id = $1
         AND business_id = $2`,
      [req.params.packageId, req.business.id]
    );
    if (!result.rowCount) throw new AppError('Creative package not found', 404, 'not_found');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

exports.createApprovalRecord = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO creative_approval_records (
         business_id, intake_request_id, record_type, title, status, due_at, asset_url, notes
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        req.business.id,
        req.body.intake_request_id || null,
        VALID_RECORD_TYPE.has(req.body.record_type) ? req.body.record_type : 'approval',
        trimString(req.body.title, 180),
        VALID_RECORD_STATUS.has(req.body.status) ? req.body.status : 'pending',
        req.body.due_at || null,
        trimString(req.body.asset_url, 2000) || null,
        trimString(req.body.notes, 3000) || null,
      ]
    );
    res.status(201).json({ record: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.updateApprovalRecord = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE creative_approval_records
       SET intake_request_id = COALESCE($3, intake_request_id),
           record_type = COALESCE($4, record_type),
           title = COALESCE($5, title),
           status = COALESCE($6, status),
           due_at = COALESCE($7, due_at),
           asset_url = COALESCE($8, asset_url),
           notes = COALESCE($9, notes),
           updated_at = NOW()
       WHERE id = $1
         AND business_id = $2
       RETURNING *`,
      [
        req.params.recordId,
        req.business.id,
        req.body.intake_request_id || null,
        VALID_RECORD_TYPE.has(req.body.record_type) ? req.body.record_type : null,
        trimString(req.body.title, 180) || null,
        VALID_RECORD_STATUS.has(req.body.status) ? req.body.status : null,
        req.body.due_at || null,
        trimString(req.body.asset_url, 2000) || null,
        trimString(req.body.notes, 3000) || null,
      ]
    );
    if (!rows.length) throw new AppError('Creative approval record not found', 404, 'not_found');
    res.json({ record: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.deleteApprovalRecord = async (req, res, next) => {
  try {
    const result = await pool.query(
      `DELETE FROM creative_approval_records
       WHERE id = $1
         AND business_id = $2`,
      [req.params.recordId, req.business.id]
    );
    if (!result.rowCount) throw new AppError('Creative approval record not found', 404, 'not_found');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
