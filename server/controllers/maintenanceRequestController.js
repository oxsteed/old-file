const pool = require('../db');
const path = require('path');
const { AppError } = require('../middleware/errorHandler');
const jobSchema = require('../validation/jobSchema');
const { canAccessBusinessTeam } = require('../utils/businessOwnership');
const { toPrivatePhotoRef, withHydratedPhotos, withHydratedPhotosList, resolvePhotoKey } = require('../utils/intakeMedia');
const { copyObject, deleteFile, getPublicUrl } = require('../utils/storage');
const { uploadFilesOrThrow } = require('../utils/uploadBatch');
const { notifyIntakeReceived } = require('../utils/intakeNotifications');
const { sendNotification } = require('../services/notificationService');
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
const VALID_WORKFLOW_STAGES = new Set(['intake', 'triage', 'dispatch', 'scheduled', 'repair', 'follow_up', 'closed']);
const VALID_INTAKE_CHANNELS = new Set(['tenant_portal', 'phone', 'email', 'internal']);
const VALID_BILL_TO = new Set(['owner', 'tenant', 'hoa', 'internal']);

function trimString(value, max = 4000) {
  const text = String(value ?? '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function toNumberOrNull(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function computeSlaTargetAt(urgency) {
  const hours = {
    emergency: 4,
    urgent: 12,
    normal: 24,
    low: 72,
  }[urgency] || 24;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function computeFollowUpDueAt(status, scheduledStartAt) {
  if (status === 'completed') return new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  if (scheduledStartAt) return new Date(new Date(scheduledStartAt).getTime() + 12 * 60 * 60 * 1000);
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

function deriveWorkflowStage(status, requestedStage) {
  if (VALID_WORKFLOW_STAGES.has(requestedStage)) return requestedStage;
  if (status === 'completed') return 'closed';
  if (status === 'in_progress') return 'repair';
  if (status === 'assigned') return 'dispatch';
  if (status === 'scheduled') return 'scheduled';
  if (status === 'accepted') return 'triage';
  return 'intake';
}

function buildTemplateIntake(body = {}) {
  return {
    location_area: trimString(body.location_area || body.locationArea, 120) || null,
    symptom_started_at: trimString(body.symptom_started_at || body.symptomStartedAt, 120) || null,
    best_update_channel: trimString(body.best_update_channel || body.bestUpdateChannel, 40) || null,
    entry_preference: trimString(body.entry_preference || body.entryPreference, 120) || null,
    resident_present_required: body.resident_present_required === true || body.resident_present_required === 'true',
    pets_on_site: body.pets_on_site === true || body.pets_on_site === 'true',
    asset_label: trimString(body.asset_label || body.assetLabel, 160) || null,
  };
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
            b.is_active, b.active_template, hp.active_template AS helper_active_template,
            b.is_listed, b.is_hidden_by_admin
     FROM businesses b
     LEFT JOIN helper_profiles hp ON hp.user_id = b.user_id
     WHERE b.id = $1`,
    [businessId]
  );
  const business = rows[0];
  // Review P1-210: unlisted or admin-hidden businesses don't take public intake.
  if (!business || (requireActive && (business.is_active === false || business.is_listed === false || business.is_hidden_by_admin === true))) {
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
    const { rows: settingRows } = await pool.query(
      `SELECT intake_enabled, emergency_phone, emergency_instructions, after_hours_policy,
              response_promise_hours, supported_issue_categories, tenant_portal_intro
       FROM property_operation_settings
       WHERE business_id = $1`,
      [business.id]
    );
    const settings = settingRows[0] || null;
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
      propertyOperations: settings
        ? {
            intake_enabled: settings.intake_enabled,
            emergency_phone: settings.emergency_phone,
            emergency_instructions: settings.emergency_instructions,
            after_hours_policy: settings.after_hours_policy,
            response_promise_hours: settings.response_promise_hours,
            supported_issue_categories: settings.supported_issue_categories,
            tenant_portal_intro: settings.tenant_portal_intro,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
};

exports.createRequest = async (req, res, next) => {
  try {
    const business = await getBusinessOrThrow(req.params.businessId);
    const { rows: settingRows } = await pool.query(
      'SELECT intake_enabled FROM property_operation_settings WHERE business_id = $1',
      [business.id]
    );
    if (settingRows[0] && settingRows[0].intake_enabled === false) {
      throw new AppError('Maintenance intake is currently closed', 409, 'intake_disabled');
    }
    const fields = {};
    const title = trimString(req.body.title, 200);
    const description = trimString(req.body.description, 4000);
    const issueCategory = trimString(req.body.issue_category || req.body.issueCategory || 'General', 80);
    const urgency = VALID_URGENCY.has(req.body.urgency) ? req.body.urgency : 'normal';
    const intakeChannel = VALID_INTAKE_CHANNELS.has(req.body.intake_channel) ? req.body.intake_channel : 'tenant_portal';
    const billableParty = VALID_BILL_TO.has(req.body.billable_party) ? req.body.billable_party : null;
    const templateIntake = buildTemplateIntake(req.body);
    const workflowStage = deriveWorkflowStage('reported', req.body.workflow_stage);
    const slaTargetAt = computeSlaTargetAt(urgency);
    const followUpDueAt = computeFollowUpDueAt('reported', null);

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
      const uploads = await uploadFilesOrThrow(req.files, 'maintenance-requests', {
        code: 'maintenance_request_media_upload_failed',
        label: 'maintenance request photo',
      });
      photoUrls = uploads.map((key) => toPrivatePhotoRef(key));
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [request] } = await client.query(
        `INSERT INTO property_maintenance_requests (
           business_id, owner_id, requester_id, urgency, issue_category, title, description,
           property_label, unit_label, access_notes, preferred_times, permission_to_enter,
           contact_name, contact_email, contact_phone, photo_urls, workflow_stage,
           intake_channel, billable_party, template_intake, sla_target_at, follow_up_due_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22)
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
          workflowStage,
          intakeChannel,
          billableParty,
          JSON.stringify(templateIntake),
          slaTargetAt,
          followUpDueAt,
        ]
      );
      await insertEvent(client, request.id, req.user.id, 'created', null, 'reported', 'Tenant submitted maintenance request');
      await client.query('COMMIT');
      // Notify the business owner: submitted maintenance intakes must be observable.
      // Fire-and-forget: the helper never throws and never blocks the response.
      notifyIntakeReceived({ businessId: business.id, intakeId: request.id, area: 'maintenance' });
      return res.status(201).json({ request: await withHydratedPhotos(request) });
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
         COUNT(*) FILTER (WHERE workflow_stage = 'follow_up')::int AS follow_up_count,
         COUNT(*) FILTER (WHERE sla_target_at IS NOT NULL AND sla_target_at < NOW() AND status NOT IN ('completed', 'cancelled', 'rejected'))::int AS overdue_sla_count,
         COALESCE(SUM(actual_cost), 0)::numeric AS actual_cost_total
       FROM property_maintenance_requests
       WHERE business_id = $1`,
      [businessId]
    );

    return res.json({ requests: await withHydratedPhotosList(rows), stats });
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
    return res.json({ request: await withHydratedPhotos(request), events });
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
    const workflowStage = deriveWorkflowStage(nextStatus, req.body.workflow_stage);
    const tenantVisibleNotes = req.body.tenant_visible_notes !== undefined
      ? trimString(req.body.tenant_visible_notes, 2000)
      : existing.tenant_visible_notes;
    const ownerNotes = req.body.owner_notes !== undefined
      ? trimString(req.body.owner_notes, 4000)
      : existing.owner_notes;
    const resolutionSummary = req.body.resolution_summary !== undefined
      ? trimString(req.body.resolution_summary, 4000)
      : existing.resolution_summary;
    const nextScheduledEnd = req.body.scheduled_end_at || req.body.scheduledEndAt || existing.scheduled_end_at || null;
    const nextFollowUpAt = req.body.follow_up_due_at
      || req.body.followUpDueAt
      || computeFollowUpDueAt(nextStatus, scheduledStart);
    const nextTemplateIntake = req.body.template_intake
      ? { ...(existing.template_intake || {}), ...req.body.template_intake }
      : existing.template_intake;

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
           workflow_stage = $10,
           billable_party = COALESCE($11, billable_party),
           follow_up_due_at = $12,
           resolution_summary = $13,
           template_intake = COALESCE($14::jsonb, template_intake),
           updated_at = NOW(),
           status_updated_at = CASE WHEN status <> $1 THEN NOW() ELSE status_updated_at END
       WHERE id = $15
       RETURNING *`,
      [
        nextStatus,
        assignedHelperId || null,
        scheduledStart || null,
        nextScheduledEnd,
        toNumberOrNull(req.body.estimated_cost ?? req.body.estimatedCost) ?? existing.estimated_cost,
        toNumberOrNull(req.body.actual_cost ?? req.body.actualCost) ?? existing.actual_cost,
        req.body.vendor_name !== undefined ? trimString(req.body.vendor_name, 180) : existing.vendor_name,
        ownerNotes || null,
        tenantVisibleNotes || null,
        workflowStage,
        VALID_BILL_TO.has(req.body.billable_party) ? req.body.billable_party : null,
        nextFollowUpAt,
        resolutionSummary || null,
        nextTemplateIntake ? JSON.stringify(nextTemplateIntake) : null,
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
    // A newly assigned helper must be able to discover the assignment:
    // notify them (the assigned queue at GET /assigned is the durable
    // surface; this is the push). Fire-and-forget: never blocks the update.
    const prevAssignee = existing.assigned_helper_id || null;
    const nextAssignee = request.assigned_helper_id || null;
    if (nextAssignee && String(nextAssignee) !== String(prevAssignee)) {
      sendNotification({
        userId: nextAssignee,
        type: 'maintenance_request_assigned',
        data: {
          request_id: String(request.id),
          business_id: String(request.business_id),
          title: request.title || '',
        },
        action_url: '/helper-dashboard?tab=pulse',
        idempotencyKey: `maintenance-assigned:${request.id}:${nextAssignee}`,
      }).catch((err) => logger.warn('[maintenance] assignment notification failed', {
        requestId: request.id,
        error: err.message,
      }));
    }
    return res.json({ request: await withHydratedPhotos(request) });
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

    // Review P2-9-F10: this used to INSERT into jobs directly, skipping the
    // shared job-posting validation. Run the constructed input through the
    // same schema POST /api/jobs uses so invalid jobs fail fast at 422.
    const jobInput = {
      title: request.title,
      description: [
        request.description,
        request.property_label ? `Property: ${request.property_label}` : '',
        request.unit_label ? `Unit: ${request.unit_label}` : '',
        request.access_notes ? `Access notes: ${request.access_notes}` : '',
        request.preferred_times ? `Preferred times: ${request.preferred_times}` : '',
        request.permission_to_enter ? 'Tenant granted permission to enter if required.' : '',
      ].filter(Boolean).join('\n\n'),
      category_name: request.issue_category,
      budget_type: 'open',
      urgency: request.urgency === 'emergency' || request.urgency === 'urgent' ? 'asap' : 'flexible',
      location_address: request.property_label || request.address_street || null,
      location_city: request.address_city || null,
      location_state: request.address_state || null,
      location_zip: request.address_zip || null,
      location_country: request.address_country || null,
      scheduled_date: request.scheduled_start_at ? new Date(request.scheduled_start_at).toISOString().slice(0, 10) : null,
      scheduled_time: request.scheduled_start_at || null,
    };
    const { patch: canonicalInput } = jobSchema.normalizeJobInput(jobInput, { mode: 'legacy' });
    for (const key of ['title', 'description', 'location_city', 'location_country']) {
      if (!Object.prototype.hasOwnProperty.call(canonicalInput, key)) canonicalInput[key] = null;
    }
    const schemaErrs = jobSchema.validateJobFields(canonicalInput, { mode: 'create' });
    if (Object.keys(schemaErrs).length) {
      if (schemaErrs.location_city) schemaErrs.location = schemaErrs.location_city;
      throw new AppError('Validation failed', 422, 'validation_failed', schemaErrs);
    }

    const description = jobInput.description;

    const { rows: [job] } = await client.query(
      `INSERT INTO jobs (
         client_id, title, description, category_name, budget_type, urgency, is_urgent,
         site_access, job_type_label, notes, location_address, location_city,
         location_state, location_zip, location_country, media_urls,
         preferred_helper_id, preferred_helper_name, scheduled_date, scheduled_time,
         status, expires_at, metadata
       )
       VALUES ($1,$2,$3,$4,'open',$5,$6,'standard','one_time',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'published',now() + interval '30 days',$18)
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
        [],
        request.assigned_helper_id || null,
        request.vendor_name || null,
        request.scheduled_start_at ? new Date(request.scheduled_start_at).toISOString().slice(0, 10) : null,
        request.scheduled_start_at || null,
        // Review P2-9-F10: keep the tenant (requester) linked on the job;
        // the job is posted by the business owner but originated from them.
        JSON.stringify({
          maintenance_request_id: request.id,
          tenant_requester_id: request.requester_id || null,
          converted_from: 'property_maintenance_request',
        }),
      ]
    );

    // Review P3-6-F10: intake photos are private. Converting to a public job
    // is an explicit publish step: copy each photo under the public jobs/
    // prefix and point the job's media at the public copies. The private
    // intake originals stay where they are. On any failure the job insert
    // rolls back and the copied objects are removed best-effort.
    const publishedKeys = [];
    let publishedUrls = [];
    try {
      const photoRefs = Array.isArray(request.photo_urls) ? request.photo_urls : [];
      for (const ref of photoRefs) {
        const sourceKey = resolvePhotoKey(ref);
        if (!sourceKey) continue;
        const base = path.basename(sourceKey).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'photo';
        const destKey = `jobs/${job.id}/${Date.now()}-${base}`;
        await copyObject(sourceKey, destKey);
        publishedKeys.push(destKey);
      }
      publishedUrls = publishedKeys.map((key) => getPublicUrl(key));
      if (publishedUrls.length) {
        const { rows: [withMedia] } = await client.query(
          `UPDATE jobs SET media_urls = $1 WHERE id = $2 RETURNING *`,
          [publishedUrls, job.id]
        );
        if (withMedia) Object.assign(job, withMedia);
      }
    } catch (publishErr) {
      await Promise.allSettled(publishedKeys.map((key) => deleteFile(key)));
      throw publishErr;
    }

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
    // Customer 360 watchlist: notify watching admins (best-effort).
    try {
      const { notifyWatchers } = require('./customer360Controller');
      await notifyWatchers({
        targetUserIds: [String(job.client_id || req.user.id)],
        eventType: 'booking',
        refId: job.id,
        title: job.title,
      });
    } catch (watchErr) { /* never fail the response */ }
    return res.status(201).json({ request: await withHydratedPhotos(updated), job });
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
    return res.json({ requests: await withHydratedPhotosList(rows) });
  } catch (err) {
    next(err);
  }
};

// Assigned helpers need a first-class queue; `/my` intentionally remains the
// requester's history and must not silently change meaning by account role.
exports.listAssignedRequests = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, b.business_name
         FROM property_maintenance_requests r
         JOIN businesses b ON b.id = r.business_id
        WHERE r.assigned_helper_id = $1
        ORDER BY COALESCE(r.scheduled_start_at, r.created_at) ASC
        LIMIT 100`,
      [req.user.id]
    );
    return res.json({ requests: await withHydratedPhotosList(rows) });
  } catch (err) {
    next(err);
  }
};
