const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');

const DEFAULT_ISSUE_CATEGORIES = [
  'Plumbing',
  'Electrical',
  'Appliance',
  'Heating / Cooling',
  'Doors / Locks',
  'Pest concern',
  'Safety concern',
  'General repair',
];

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
  return value
    .map((item) => trimString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function toJsonArray(value, maxItems = 12, maxLength = 200) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => trimString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeComplianceStatus(status, dueDate, completedAt) {
  if (completedAt) return 'complete';
  if (status === 'complete') return 'complete';
  if (dueDate && new Date(dueDate) < new Date()) return 'overdue';
  if (status === 'in_progress') return 'in_progress';
  return 'pending';
}

async function getBusinessOrThrow(businessId) {
  const { rows } = await pool.query(
    `SELECT id, business_name, active_template, is_active, user_id AS owner_id
     FROM businesses
     WHERE id = $1`,
    [businessId]
  );
  const business = rows[0];
  if (!business || business.is_active === false) {
    throw new AppError('Business not found', 404, 'not_found');
  }
  return business;
}

async function ensureSettingsRow(client, businessId) {
  await client.query(
    `INSERT INTO property_operation_settings (business_id)
     VALUES ($1)
     ON CONFLICT (business_id) DO NOTHING`,
    [businessId]
  );
}

async function loadWorkspace(client, businessId) {
  await ensureSettingsRow(client, businessId);

  const [settingsRes, unitsRes, packagesRes, complianceRes, maintenanceRes, metricsRes] = await Promise.all([
    client.query(
      `SELECT *
       FROM property_operation_settings
       WHERE business_id = $1`,
      [businessId]
    ),
    client.query(
      `SELECT *
       FROM property_portfolio_units
       WHERE business_id = $1
       ORDER BY property_label, unit_label NULLS FIRST, created_at DESC`,
      [businessId]
    ),
    client.query(
      `SELECT *
       FROM property_management_packages
       WHERE business_id = $1
       ORDER BY is_active DESC, sort_order ASC, created_at DESC`,
      [businessId]
    ),
    client.query(
      `SELECT c.*,
              u.property_label AS unit_property_label,
              u.unit_label AS unit_name
       FROM property_compliance_records c
       LEFT JOIN property_portfolio_units u ON u.id = c.unit_id
       WHERE c.business_id = $1
       ORDER BY
         CASE c.status
           WHEN 'overdue' THEN 1
           WHEN 'pending' THEN 2
           WHEN 'in_progress' THEN 3
           ELSE 4
         END,
         c.due_date NULLS LAST,
         c.created_at DESC`,
      [businessId]
    ),
    client.query(
      `SELECT id, title, status, workflow_stage, urgency, property_label, unit_label,
              scheduled_start_at, follow_up_due_at, sla_target_at, vendor_name,
              updated_at, created_at, actual_cost, billable_party
       FROM property_maintenance_requests
       WHERE business_id = $1
       ORDER BY created_at DESC
       LIMIT 12`,
      [businessId]
    ),
    client.query(
      `WITH request_stats AS (
         SELECT
           COUNT(*)::int AS total_requests,
           COUNT(*) FILTER (WHERE status IN ('reported', 'accepted', 'scheduled', 'assigned', 'in_progress'))::int AS open_requests,
           COUNT(*) FILTER (WHERE workflow_stage = 'follow_up')::int AS follow_up_requests,
           COUNT(*) FILTER (WHERE sla_target_at IS NOT NULL AND sla_target_at < NOW() AND status NOT IN ('completed', 'cancelled', 'rejected'))::int AS overdue_sla,
           COALESCE(SUM(actual_cost), 0)::numeric AS recorded_cost_total
         FROM property_maintenance_requests
         WHERE business_id = $1
       ),
       compliance_stats AS (
         SELECT
           COUNT(*)::int AS compliance_total,
           COUNT(*) FILTER (WHERE status = 'overdue' OR (status <> 'complete' AND due_date IS NOT NULL AND due_date < CURRENT_DATE))::int AS compliance_overdue,
           COUNT(*) FILTER (WHERE status = 'complete')::int AS compliance_complete
         FROM property_compliance_records
         WHERE business_id = $1
       ),
       unit_stats AS (
         SELECT
           COUNT(*)::int AS total_units,
           COUNT(*) FILTER (WHERE occupancy_status = 'turnover')::int AS turnover_units,
           COUNT(*) FILTER (WHERE occupancy_status = 'vacant')::int AS vacant_units
         FROM property_portfolio_units
         WHERE business_id = $1
       ),
       package_stats AS (
         SELECT COUNT(*) FILTER (WHERE is_active)::int AS active_packages
         FROM property_management_packages
         WHERE business_id = $1
       )
       SELECT *
       FROM request_stats, compliance_stats, unit_stats, package_stats`,
      [businessId]
    ),
  ]);

  const settings = settingsRes.rows[0];
  const units = unitsRes.rows;
  const packages = packagesRes.rows;
  const compliance = complianceRes.rows.map((record) => ({
    ...record,
    status: normalizeComplianceStatus(record.status, record.due_date, record.completed_at),
  }));
  const recentRequests = maintenanceRes.rows;
  const metrics = metricsRes.rows[0] || {};

  const followUps = [
    ...recentRequests
      .filter((request) => request.follow_up_due_at && new Date(request.follow_up_due_at) <= new Date() && !['completed', 'cancelled', 'rejected'].includes(request.status))
      .map((request) => ({
        id: `request-${request.id}`,
        type: 'maintenance_follow_up',
        title: request.title,
        due_at: request.follow_up_due_at,
        detail: `${request.property_label || 'Property'}${request.unit_label ? ` · ${request.unit_label}` : ''} needs a tenant/vendor follow-up.`,
      })),
    ...compliance
      .filter((record) => record.status === 'overdue' || (record.due_date && new Date(record.due_date) <= new Date()))
      .slice(0, 8)
      .map((record) => ({
        id: `compliance-${record.id}`,
        type: 'compliance_due',
        title: record.title,
        due_at: record.due_date,
        detail: `${record.record_type}${record.unit_property_label ? ` · ${record.unit_property_label}` : ''} is due or overdue.`,
      })),
  ]
    .sort((a, b) => new Date(a.due_at || 0) - new Date(b.due_at || 0))
    .slice(0, 12);

  return {
    settings,
    units,
    packages,
    compliance,
    recentRequests,
    metrics,
    followUps,
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
          intake_enabled: workspace.settings.intake_enabled,
          emergency_phone: workspace.settings.emergency_phone,
          emergency_instructions: workspace.settings.emergency_instructions,
          after_hours_policy: workspace.settings.after_hours_policy,
          response_promise_hours: workspace.settings.response_promise_hours,
          supported_issue_categories: workspace.settings.supported_issue_categories?.length
            ? workspace.settings.supported_issue_categories
            : DEFAULT_ISSUE_CATEGORIES,
          trust_artifacts: workspace.settings.trust_artifacts || [],
          managed_property_types: workspace.settings.managed_property_types || [],
          tenant_portal_intro: workspace.settings.tenant_portal_intro,
        },
        packages: workspace.packages.filter((item) => item.is_active).slice(0, 6),
        metrics: {
          total_units: workspace.metrics.total_units || 0,
          open_requests: workspace.metrics.open_requests || 0,
          compliance_complete: workspace.metrics.compliance_complete || 0,
          compliance_overdue: workspace.metrics.compliance_overdue || 0,
        },
      });
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

exports.getBusinessWorkspace = async (req, res, next) => {
  try {
    const client = await pool.connect();
    try {
      const workspace = await loadWorkspace(client, req.business.id);
      return res.json(workspace);
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

exports.updateSettings = async (req, res, next) => {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await ensureSettingsRow(client, req.business.id);
      const issueCategories = toArray(req.body.supported_issue_categories, 24, 80);
      const trustArtifacts = toArray(req.body.trust_artifacts, 16, 120);
      const propertyTypes = toArray(req.body.managed_property_types, 12, 80);
      const { rows } = await client.query(
        `UPDATE property_operation_settings
         SET intake_enabled = COALESCE($2, intake_enabled),
             emergency_phone = $3,
             emergency_instructions = $4,
             after_hours_policy = $5,
             response_promise_hours = COALESCE($6, response_promise_hours),
             follow_up_interval_hours = COALESCE($7, follow_up_interval_hours),
             default_bill_to = COALESCE($8, default_bill_to),
             supported_issue_categories = CASE WHEN $9::text[] IS NULL OR cardinality($9::text[]) = 0 THEN supported_issue_categories ELSE $9::text[] END,
             trust_artifacts = CASE WHEN $10::text[] IS NULL OR cardinality($10::text[]) = 0 THEN trust_artifacts ELSE $10::text[] END,
             managed_property_types = CASE WHEN $11::text[] IS NULL OR cardinality($11::text[]) = 0 THEN managed_property_types ELSE $11::text[] END,
             service_area_notes = $12,
             tenant_portal_intro = $13,
             updated_at = NOW()
         WHERE business_id = $1
         RETURNING *`,
        [
          req.business.id,
          req.body.intake_enabled,
          trimString(req.body.emergency_phone, 60) || null,
          trimString(req.body.emergency_instructions, 2000) || null,
          trimString(req.body.after_hours_policy, 2000) || null,
          toIntOrNull(req.body.response_promise_hours),
          toIntOrNull(req.body.follow_up_interval_hours),
          trimString(req.body.default_bill_to, 24) || null,
          issueCategories.length ? issueCategories : null,
          trustArtifacts.length ? trustArtifacts : null,
          propertyTypes.length ? propertyTypes : null,
          trimString(req.body.service_area_notes, 1200) || null,
          trimString(req.body.tenant_portal_intro, 2000) || null,
        ]
      );
      await client.query('COMMIT');
      return res.json({ settings: rows[0] });
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

exports.createUnit = async (req, res, next) => {
  try {
    const propertyLabel = trimString(req.body.property_label, 200);
    if (!propertyLabel) throw new AppError('Property label is required', 400, 'validation_failed');

    const { rows } = await pool.query(
      `INSERT INTO property_portfolio_units (
         business_id, property_label, unit_label, property_type, occupancy_status,
         contact_name, contact_phone, contact_email, access_summary, priority_tier, notes
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        req.business.id,
        propertyLabel,
        trimString(req.body.unit_label, 100) || null,
        trimString(req.body.property_type, 80) || 'Apartment',
        trimString(req.body.occupancy_status, 32) || 'occupied',
        trimString(req.body.contact_name, 160) || null,
        trimString(req.body.contact_phone, 60) || null,
        trimString(req.body.contact_email, 255) || null,
        trimString(req.body.access_summary, 2000) || null,
        trimString(req.body.priority_tier, 24) || 'standard',
        trimString(req.body.notes, 2000) || null,
      ]
    );
    return res.status(201).json({ unit: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.updateUnit = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE property_portfolio_units
       SET property_label = COALESCE($1, property_label),
           unit_label = COALESCE($2, unit_label),
           property_type = COALESCE($3, property_type),
           occupancy_status = COALESCE($4, occupancy_status),
           contact_name = COALESCE($5, contact_name),
           contact_phone = COALESCE($6, contact_phone),
           contact_email = COALESCE($7, contact_email),
           access_summary = COALESCE($8, access_summary),
           priority_tier = COALESCE($9, priority_tier),
           notes = COALESCE($10, notes),
           updated_at = NOW()
       WHERE id = $11 AND business_id = $12
       RETURNING *`,
      [
        trimString(req.body.property_label, 200) || null,
        trimString(req.body.unit_label, 100) || null,
        trimString(req.body.property_type, 80) || null,
        trimString(req.body.occupancy_status, 32) || null,
        trimString(req.body.contact_name, 160) || null,
        trimString(req.body.contact_phone, 60) || null,
        trimString(req.body.contact_email, 255) || null,
        trimString(req.body.access_summary, 2000) || null,
        trimString(req.body.priority_tier, 24) || null,
        trimString(req.body.notes, 2000) || null,
        req.params.unitId,
        req.business.id,
      ]
    );
    if (!rows.length) throw new AppError('Unit not found', 404, 'not_found');
    return res.json({ unit: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.deleteUnit = async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM property_portfolio_units WHERE id = $1 AND business_id = $2',
      [req.params.unitId, req.business.id]
    );
    if (!rowCount) throw new AppError('Unit not found', 404, 'not_found');
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

exports.createPackage = async (req, res, next) => {
  try {
    const name = trimString(req.body.name, 160);
    if (!name) throw new AppError('Package name is required', 400, 'validation_failed');
    const { rows } = await pool.query(
      `INSERT INTO property_management_packages (
         business_id, name, description, pricing_model, bill_to_party, base_price_cents,
         after_hours_surcharge_cents, target_turnaround_hours, includes, is_active, sort_order
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
       RETURNING *`,
      [
        req.business.id,
        name,
        trimString(req.body.description, 2000) || null,
        trimString(req.body.pricing_model, 32) || 'flat',
        trimString(req.body.bill_to_party, 24) || 'owner',
        Math.max(0, toIntOrNull(req.body.base_price_cents) || 0),
        Math.max(0, toIntOrNull(req.body.after_hours_surcharge_cents) || 0),
        toIntOrNull(req.body.target_turnaround_hours),
        JSON.stringify(toJsonArray(req.body.includes)),
        req.body.is_active !== false,
        toIntOrNull(req.body.sort_order) || 0,
      ]
    );
    return res.status(201).json({ package: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.updatePackage = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE property_management_packages
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           pricing_model = COALESCE($3, pricing_model),
           bill_to_party = COALESCE($4, bill_to_party),
           base_price_cents = COALESCE($5, base_price_cents),
           after_hours_surcharge_cents = COALESCE($6, after_hours_surcharge_cents),
           target_turnaround_hours = COALESCE($7, target_turnaround_hours),
           includes = COALESCE($8::jsonb, includes),
           is_active = COALESCE($9, is_active),
           sort_order = COALESCE($10, sort_order),
           updated_at = NOW()
       WHERE id = $11 AND business_id = $12
       RETURNING *`,
      [
        trimString(req.body.name, 160) || null,
        trimString(req.body.description, 2000) || null,
        trimString(req.body.pricing_model, 32) || null,
        trimString(req.body.bill_to_party, 24) || null,
        toIntOrNull(req.body.base_price_cents),
        toIntOrNull(req.body.after_hours_surcharge_cents),
        toIntOrNull(req.body.target_turnaround_hours),
        Array.isArray(req.body.includes) ? JSON.stringify(toJsonArray(req.body.includes)) : null,
        req.body.is_active,
        toIntOrNull(req.body.sort_order),
        req.params.packageId,
        req.business.id,
      ]
    );
    if (!rows.length) throw new AppError('Package not found', 404, 'not_found');
    return res.json({ package: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.deletePackage = async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM property_management_packages WHERE id = $1 AND business_id = $2',
      [req.params.packageId, req.business.id]
    );
    if (!rowCount) throw new AppError('Package not found', 404, 'not_found');
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

exports.createComplianceRecord = async (req, res, next) => {
  try {
    const title = trimString(req.body.title, 180);
    const recordType = trimString(req.body.record_type, 80);
    if (!title || !recordType) {
      throw new AppError('Record type and title are required', 400, 'validation_failed');
    }

    const completedAt = req.body.completed_at ? new Date(req.body.completed_at) : null;
    const dueDate = req.body.due_date || null;
    const status = normalizeComplianceStatus(trimString(req.body.status, 32), dueDate, completedAt);

    const { rows } = await pool.query(
      `INSERT INTO property_compliance_records (
         business_id, unit_id, record_type, title, status, due_date, completed_at,
         vendor_name, document_url, notes
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        req.business.id,
        req.body.unit_id || null,
        recordType,
        title,
        status,
        dueDate,
        completedAt,
        trimString(req.body.vendor_name, 180) || null,
        trimString(req.body.document_url, 2000) || null,
        trimString(req.body.notes, 4000) || null,
      ]
    );
    return res.status(201).json({ record: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.updateComplianceRecord = async (req, res, next) => {
  try {
    const completedAt = req.body.completed_at ? new Date(req.body.completed_at) : null;
    const dueDate = req.body.due_date || null;
    const status = req.body.status || dueDate || completedAt
      ? normalizeComplianceStatus(trimString(req.body.status, 32), dueDate, completedAt)
      : null;

    const { rows } = await pool.query(
      `UPDATE property_compliance_records
       SET unit_id = COALESCE($1, unit_id),
           record_type = COALESCE($2, record_type),
           title = COALESCE($3, title),
           status = COALESCE($4, status),
           due_date = COALESCE($5, due_date),
           completed_at = COALESCE($6, completed_at),
           vendor_name = COALESCE($7, vendor_name),
           document_url = COALESCE($8, document_url),
           notes = COALESCE($9, notes),
           updated_at = NOW()
       WHERE id = $10 AND business_id = $11
       RETURNING *`,
      [
        req.body.unit_id || null,
        trimString(req.body.record_type, 80) || null,
        trimString(req.body.title, 180) || null,
        status,
        dueDate,
        completedAt,
        trimString(req.body.vendor_name, 180) || null,
        trimString(req.body.document_url, 2000) || null,
        trimString(req.body.notes, 4000) || null,
        req.params.recordId,
        req.business.id,
      ]
    );
    if (!rows.length) throw new AppError('Compliance record not found', 404, 'not_found');
    return res.json({ record: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.deleteComplianceRecord = async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM property_compliance_records WHERE id = $1 AND business_id = $2',
      [req.params.recordId, req.business.id]
    );
    if (!rowCount) throw new AppError('Compliance record not found', 404, 'not_found');
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
