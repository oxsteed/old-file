const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { canAccessBusinessTeam } = require('../utils/businessOwnership');
const { uploadFile, getPublicUrl } = require('../utils/storage');
const logger = require('../utils/logger');

const VALID_STATUSES = new Set([
  'reported',
  'accepted',
  'scheduled',
  'assigned',
  'in_progress',
  'completed',
  'rejected',
  'cancelled',
]);

const VALID_URGENCY = new Set(['emergency', 'urgent', 'normal', 'low']);

function trimString(value, max = 4000) {
  const text = String(value ?? '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function toNumberOrNull(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function mapStatusFromAction(status, scheduledStart, assignedHelperId) {
  if (VALID_STATUSES.has(status)) return status;
  if (assignedHelperId) return 'assigned';
  if (scheduledStart) return 'scheduled';
  return 'accepted';
}

async function getBusinessOrThrow(businessId, requireActive = true) {
  const { rows } = await pool.query(
    `SELECT b.id, b.user_id AS owner_id, b.business_name, b.address_street,
            b.address_city, b.address_state, b.address_zip, b.address_country,
            b.is_active, b.active_template, hp.active_template AS helper_active_template
     FROM businesses b
     LEFT JOIN helper_profiles hp ON hp.user_id = b.user_id
     WHERE b.id = $1`,
    [businessId]
  );
  const business = rows[0];
  if (!business || (requireActive && business.is_active === false)) {
    throw new AppError('Business not found', 404, 'not_found');
  }
  return business;
}

async function loadRequestForUser(requestId, userId) {
  const { rows } = await pool.query(
    `SELECT r.*, b.business_name, b.user_id AS business_owner_id
     FROM property_maintenance_requests r
     JOIN businesses b ON b.id = r.business_id
     WHERE r.id = $1
       AND (
         r.requester_id = $2
         OR r.assigned_helper_id = $2
         OR b.user_id = $2
         OR EXISTS (
           SELECT 1 FROM business_members bm
           WHERE bm.business_id = r.business_id
             AND bm.member_id = $2
             AND bm.status = 'active'
         )
       )`,
    [requestId, userId]
  );
  return rows[0] || null;
}

async function insertEvent(client, requestId, actorId, type, fromStatus, toStatus, note, metadata = {}) {
  await client.query(
    `INSERT INTO property_maintenance_request_events
       (request_id, actor_id, event_type, from_status, to_status, note, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [requestId, actorId || null, type, fromStatus || null, toStatus || null, note || null, JSON.stringify(metadata)]
  );
}

exports.getPublicBusiness = async (req, res, next) => {
  try {
    const business = await getBusinessOrThrow(req.params.businessId);
    return res.json({
      business: {
        id: business.id,
        business_name: business.business_name,
        address_city: business.address_city,
        address_state: business.address_state,
        active_template: business.active_template || business.helper_active_template || 'default',
      },
      workflow: {
        statuses: Array.from(VALID_STATUSES),
        urgency: Array.from(VALID_URGENCY),
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.createRequest = async (req, res, next) => {
  try {
    const business = await getBusinessOrThrow(req.params.businessId);
    const fields = {};
    const title = trimString(req.body.title, 200);
    const description = trimString(req.body.description, 4000);
    const issueCategory = trimString(req.body.issue_category || req.body.issueCategory || 'General', 80);
    const urgency = VALID_URGENCY.has(req.body.urgency) ? req.body.urgency : 'normal';

    if (title.length < 6) fields.title = 'Title is required';
    if (description.length < 20) fields.description = 'Please describe the issue in more detail';
    if (!issueCategory) fields.issue_category = 'Issue category is required';
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    let photoUrls = [];
    if (req.files?.length) {
      const nonImage = req.files.find((file) => !String(file.mimetype || '').startsWith('image/'));
      if (nonImage) {
        throw new AppError('Only image files can be attached to maintenance requests', 400, 'invalid_file_type');
      }
      const uploads = await Promise.allSettled(
        req.files.slice(0, 5).map((file) => uploadFile(file.buffer, 'maintenance-requests', file.originalname, file.mimetype))
      );
      photoUrls = uploads
        .filter((result) => result.status === 'fulfilled' && result.value)
        .map((result) => getPublicUrl(result.value));
      const failed = uploads.filter((result) => result.status === 'rejected' || !result.value).length;
      if (failed) logger.warn('Maintenance request photo upload skipped', { failed, total: req.files.length });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [request] } = await client.query(
        `INSERT INTO property_maintenance_requests (
           business_id, owner_id, requester_id, urgency, issue_category, title, description,
           property_label, unit_label, access_notes, preferred_times, permission_to_enter,
           contact_name, contact_email, contact_phone, photo_urls
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING *`,
        [
          business.id,
          business.owner_id,
          req.user.id,
          urgency,
          issueCategory,
          title,
          description,
          trimString(req.body.property_label || req.body.propertyLabel, 200) || null,
          trimString(req.body.unit_label || req.body.unitLabel, 100) || null,
          trimString(req.body.access_notes || req.body.accessNotes, 2000) || null,
          trimString(req.body.preferred_times || req.body.preferredTimes, 1200) || null,
          req.body.permission_to_enter === true || req.body.permission_to_enter === 'true',
          trimString(req.body.contact_name || req.body.contactName, 160) || null,
          trimString(req.body.contact_email || req.body.contactEmail, 255) || null,
          trimString(req.body.contact_phone || req.body.contactPhone, 60) || null,
          photoUrls,
        ]
      );
      await insertEvent(client, request.id, req.user.id, 'created', null, 'reported', 'Tenant submitted maintenance request');
      await client.query('COMMIT');
      return res.status(201).json({ request });
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

exports.listBusinessRequests = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const access = await canAccessBusinessTeam(req.user.id, businessId);
    if (!access) throw new AppError('Business not found', 404, 'not_found');

    const status = req.query.status && VALID_STATUSES.has(req.query.status) ? req.query.status : null;
    const params = [businessId];
    let where = 'WHERE r.business_id = $1';
    if (status) {
      params.push(status);
      where += ` AND r.status = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT r.*, u.first_name, u.last_name, u.email AS requester_email,
              ah.first_name AS assigned_first_name, ah.last_name AS assigned_last_name
       FROM property_maintenance_requests r
       LEFT JOIN users u ON u.id = r.requester_id
       LEFT JOIN users ah ON ah.id = r.assigned_helper_id
       ${where}
       ORDER BY
         CASE r.status
           WHEN 'reported' THEN 1
           WHEN 'accepted' THEN 2
           WHEN 'scheduled' THEN 3
           WHEN 'assigned' THEN 4
           WHEN 'in_progress' THEN 5
           ELSE 6
         END,
         r.created_at DESC
       LIMIT 100`,
      params
    );

    const { rows: [stats] } = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status IN ('reported','accepted','scheduled','assigned','in_progress'))::int AS open_count,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_count,
         COALESCE(SUM(actual_cost), 0)::numeric AS actual_cost_total
       FROM property_maintenance_requests
       WHERE business_id = $1`,
      [businessId]
    );

    return res.json({ requests: rows, stats });
  } catch (err) {
    next(err);
  }
};

exports.getRequest = async (req, res, next) => {
  try {
    const request = await loadRequestForUser(req.params.id, req.user.id);
    if (!request) throw new AppError('Maintenance request not found', 404, 'not_found');
    const { rows: events } = await pool.query(
      `SELECT e.*, u.first_name, u.last_name
       FROM property_maintenance_request_events e
       LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.request_id = $1
       ORDER BY e.created_at ASC`,
      [request.id]
    );
    return res.json({ request, events });
  } catch (err) {
    next(err);
  }
};

exports.updateRequest = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [existing] } = await client.query(
      `SELECT r.*, b.user_id AS business_owner_id
       FROM property_maintenance_requests r
       JOIN businesses b ON b.id = r.business_id
       WHERE r.id = $1
       FOR UPDATE`,
      [req.params.id]
    );
    if (!existing) throw new AppError('Maintenance request not found', 404, 'not_found');
    const access = await canAccessBusinessTeam(req.user.id, existing.business_id);
    if (!access && existing.assigned_helper_id !== req.user.id) {
      throw new AppError('Not authorized', 403, 'forbidden');
    }

    const assignedHelperId = trimString(req.body.assigned_helper_id || req.body.assignedHelperId, 80) || existing.assigned_helper_id;
    const scheduledStart = req.body.scheduled_start_at || req.body.scheduledStartAt || existing.scheduled_start_at;
    const nextStatus = mapStatusFromAction(req.body.status, scheduledStart, assignedHelperId);
    const tenantVisibleNotes = req.body.tenant_visible_notes !== undefined
      ? trimString(req.body.tenant_visible_notes, 2000)
      : existing.tenant_visible_notes;
    const ownerNotes = req.body.owner_notes !== undefined
      ? trimString(req.body.owner_notes, 4000)
      : existing.owner_notes;

    const { rows: [request] } = await client.query(
      `UPDATE property_maintenance_requests
       SET status = $1,
           assigned_helper_id = $2,
           scheduled_start_at = $3,
           scheduled_end_at = $4,
           estimated_cost = $5,
           actual_cost = $6,
           vendor_name = $7,
           owner_notes = $8,
           tenant_visible_notes = $9,
           updated_at = NOW(),
           status_updated_at = CASE WHEN status <> $1 THEN NOW() ELSE status_updated_at END
       WHERE id = $10
       RETURNING *`,
      [
        nextStatus,
        assignedHelperId || null,
        scheduledStart || null,
        req.body.scheduled_end_at || req.body.scheduledEndAt || existing.scheduled_end_at || null,
        toNumberOrNull(req.body.estimated_cost ?? req.body.estimatedCost) ?? existing.estimated_cost,
        toNumberOrNull(req.body.actual_cost ?? req.body.actualCost) ?? existing.actual_cost,
        req.body.vendor_name !== undefined ? trimString(req.body.vendor_name, 180) : existing.vendor_name,
        ownerNotes || null,
        tenantVisibleNotes || null,
        existing.id,
      ]
    );
    await insertEvent(
      client,
      request.id,
      req.user.id,
      existing.status === nextStatus ? 'updated' : 'status_changed',
      existing.status,
      nextStatus,
      tenantVisibleNotes || ownerNotes || null
    );
    await client.query('COMMIT');
    return res.json({ request });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

exports.convertToJob = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [request] } = await client.query(
      `SELECT r.*, b.business_name, b.address_street, b.address_city, b.address_state,
              b.address_zip, b.address_country, b.user_id AS business_owner_id
       FROM property_maintenance_requests r
       JOIN businesses b ON b.id = r.business_id
       WHERE r.id = $1
       FOR UPDATE`,
      [req.params.id]
    );
    if (!request) throw new AppError('Maintenance request not found', 404, 'not_found');
    const access = await canAccessBusinessTeam(req.user.id, request.business_id);
    if (!access) throw new AppError('Not authorized', 403, 'forbidden');
    if (request.job_id) throw new AppError('Request already has a job', 409, 'state_conflict');

    const description = [
      request.description,
      request.property_label ? `Property: ${request.property_label}` : '',
      request.unit_label ? `Unit: ${request.unit_label}` : '',
      request.access_notes ? `Access notes: ${request.access_notes}` : '',
      request.preferred_times ? `Preferred times: ${request.preferred_times}` : '',
      request.permission_to_enter ? 'Tenant granted permission to enter if required.' : '',
    ].filter(Boolean).join('\n\n');

    const { rows: [job] } = await client.query(
      `INSERT INTO jobs (
         client_id, title, description, category_name, budget_type, urgency, is_urgent,
         site_access, job_type_label, notes, location_address, location_city,
         location_state, location_zip, location_country, media_urls,
         preferred_helper_id, preferred_helper_name, scheduled_date, scheduled_time,
         status, expires_at
       )
       VALUES ($1,$2,$3,$4,'open',$5,$6,'standard','one_time',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'published',now() + interval '30 days')
       RETURNING *`,
      [
        request.business_owner_id,
        request.title,
        description,
        request.issue_category,
        request.urgency === 'emergency' || request.urgency === 'urgent' ? 'asap' : 'flexible',
        request.urgency === 'emergency' || request.urgency === 'urgent',
        `Created from maintenance request ${request.id}`,
        request.property_label || request.address_street || null,
        request.address_city || null,
        request.address_state || null,
        request.address_zip || null,
        request.address_country || null,
        request.photo_urls || [],
        request.assigned_helper_id || null,
        request.vendor_name || null,
        request.scheduled_start_at ? new Date(request.scheduled_start_at).toISOString().slice(0, 10) : null,
        request.scheduled_start_at || null,
      ]
    );

    const { rows: [updated] } = await client.query(
      `UPDATE property_maintenance_requests
       SET job_id = $1,
           status = CASE WHEN status IN ('reported','accepted') THEN 'scheduled' ELSE status END,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [job.id, request.id]
    );
    await insertEvent(client, request.id, req.user.id, 'converted_to_job', request.status, updated.status, `Created job ${job.id}`, { job_id: job.id });
    await client.query('COMMIT');
    return res.status(201).json({ request: updated, job });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

exports.listMyRequests = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, b.business_name
       FROM property_maintenance_requests r
       JOIN businesses b ON b.id = r.business_id
       WHERE r.requester_id = $1
       ORDER BY r.created_at DESC
       LIMIT 100`,
      [req.user.id]
    );
    return res.json({ requests: rows });
  } catch (err) {
    next(err);
  }
};
