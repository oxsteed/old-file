'use strict';

// Phase 7 (gap 11, 15, 17, 19, 21): compliance hardening + reporting.
//
// Temperature logs, prime cost, scheduled report delivery, retention
// policy, and erasure requests. Every handler here reuses the existing
// report functions and the existing audits flow; nothing here invents
// a report builder, a pay override, or a new money movement.

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const { getLocationScope } = require('../services/restaurantLocationAccessService');
const permissionsService = require('../services/permissionsService');
const { sendNotification } = require('../services/notificationService');
const { enqueueStorageDeletion } = require('../services/storageCleanupService');
const { logBusinessAction } = require('../services/businessAuditLog');
const logger = require('../utils/logger');
const temperatureService = require('../services/restaurantTemperatureService');
const primeCostService = require('../services/restaurantPrimeCostService');
const scheduledReports = require('../services/restaurantScheduledReports');
const retentionService = require('../services/restaurantRetentionService');
const breakAttestation = require('../services/restaurantBreakAttestation');
const payrollService = require('../services/restaurantPayrollService');

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function dateParam(value, field) {
  if (value == null || value === '') return null;
  if (!DATE_ONLY_RE.test(String(value))) throw new AppError(`Invalid ${field}`, 400, 'invalid_range');
  return String(value);
}

// Reports policy (S-08): analytics.view_financial, granted to owners
// and managers by default. Temp-log recording is open to any active
// member, like running a checklist; linking a corrective action and
// managing schedules/policies/erasure are manager-only.
async function requireRestaurantAccess(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const restaurant = await resolveRestaurantAccess(userId, restaurantId);
  const allowed = await permissionsService.hasRestaurantPermission(restaurant, userId, ['analytics.view_financial']);
  if (!allowed) throw new AppError('You do not have permission to view reports', 403, 'forbidden');
  return { ...restaurant, locationScope: await getLocationScope(restaurant, userId) };
}

async function requireMemberAccess(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const restaurant = await resolveRestaurantAccess(userId, restaurantId);
  return { ...restaurant, locationScope: await getLocationScope(restaurant, userId) };
}

async function requireManagerAccess(userId, restaurantId) {
  const restaurant = await requireRestaurantAccess(userId, restaurantId);
  const allowed = await permissionsService.hasRestaurantPermission(restaurant, userId, ['settings.manage']);
  if (!allowed) throw new AppError('You do not have permission to manage this restaurant', 403, 'forbidden');
  return restaurant;
}

function assertLocationInScope(scope, locationId) {
  if (locationId == null) return;
  if (scope?.mode === 'assigned' && !scope.location_ids.includes(Number(locationId))) {
    throw new AppError('Location is outside your assigned stores', 403, 'forbidden');
  }
}

function scopedLocationId(scope, locationId) {
  if (scope?.mode === 'assigned') {
    if (locationId != null) {
      assertLocationInScope(scope, locationId);
      return Number(locationId);
    }
    return null;
  }
  return locationId == null ? null : Number(locationId);
}

async function notifyBreachManagers(restaurant, log) {
  try {
    const { rows } = await pool.query(
      `SELECT member_id AS user_id FROM business_members
        WHERE business_id = $1 AND status = 'active' AND role IN ('owner', 'manager')
       UNION
       SELECT user_id FROM businesses WHERE id = $1`,
      [restaurant.business_id]
    );
    for (const row of rows) {
      await sendNotification({
        userId: row.user_id,
        type: 'restaurant_temperature_breach',
        title: `Temperature breach: ${log.area_name}`,
        body: `Reading ${log.reading_celsius} C is outside the ${log.threshold_min_c} C to ${log.threshold_max_c} C range for ${log.area_name} (${log.business_date}). A corrective action is needed.`,
        data: {
          restaurant_id: Number(restaurant.id),
          temperature_log_id: Number(log.id),
          area_name: log.area_name,
          reading_celsius: Number(log.reading_celsius),
          business_date: log.business_date,
        },
        action_url: '/restaurants/merchant?tab=operations',
        idempotencyKey: `temperature-breach:${log.id}:${row.user_id}`,
      });
    }
  } catch (err) {
    // The alert must never fail the log write: the breach is already
    // recorded and visible in the daily view.
    logger.warn('Temperature breach notification failed', { logId: log?.id, error: err.message });
  }
}

// ── Temperature logs (gap 11) ────────────────────────────────────────

exports.recordTemperatureLog = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireMemberAccess(req.user.id, restaurantId);
    const body = req.body || {};
    const locationId = body.locationId == null && body.location_id == null
      ? null : Number(body.locationId ?? body.location_id);
    assertLocationInScope(restaurant.locationScope, locationId);
    const { log, thresholds, breach } = await temperatureService.recordTemperatureLog(pool, {
      restaurantId,
      locationId,
      areaId: body.areaId == null && body.area_id == null ? null : Number(body.areaId ?? body.area_id),
      areaName: body.areaName ?? body.area_name ?? null,
      stationLabel: body.stationLabel ?? body.station_label ?? null,
      readingCelsius: body.readingCelsius ?? body.reading_celsius,
      note: body.note ?? null,
      recordedBy: req.user.id,
      businessDate: dateParam(body.businessDate ?? body.business_date, 'businessDate'),
    });
    if (breach) await notifyBreachManagers(restaurant, log);
    res.status(201).json({ log, thresholds, breach });
  } catch (err) { next(err); }
};

exports.listTemperatureLogs = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const scope = restaurant.locationScope;
    let locationId = req.query.locationId == null ? null : Number(req.query.locationId);
    if (scope?.mode === 'assigned' && locationId == null) {
      // Assigned-scope readers see their stores; the summary below is
      // computed per store, so the list defaults to all of them.
      locationId = null;
    } else {
      locationId = scopedLocationId(scope, locationId);
    }
    const logs = await temperatureService.listTemperatureLogs(pool, {
      restaurantId,
      locationId,
      fromDate: dateParam(req.query.from, 'from'),
      toDate: dateParam(req.query.to, 'to'),
      breachOnly: req.query.breachOnly === 'true' || req.query.breach_only === 'true',
      limit: req.query.limit,
      offset: req.query.offset,
    });
    const businessDate = dateParam(req.query.date, 'date')
      || new Intl.DateTimeFormat('en-CA', { timeZone: restaurant.timezone || 'UTC' }).format(new Date());
    const summary = await temperatureService.dailyTemperatureSummary(pool, {
      restaurantId, locationId, businessDate,
    });
    res.json({ logs, summary });
  } catch (err) { next(err); }
};

exports.linkTemperatureCorrectiveAction = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireManagerAccess(req.user.id, restaurantId);
    const logId = parsePositiveInt(req.params.logId);
    const actionId = parsePositiveInt(req.body?.correctiveActionId ?? req.body?.corrective_action_id);
    if (!logId || !actionId) throw new AppError('logId and correctiveActionId are required', 400, 'validation_failed');
    const log = await temperatureService.linkCorrectiveAction(pool, {
      restaurantId, logId, correctiveActionId: actionId,
    });
    await logBusinessAction(req, {
      business_id: Number(restaurant.business_id),
      action: 'restaurant.temperature_log.action_linked',
      target_type: 'temperature_log',
      target_id: logId,
      after_state: { corrective_action_id: actionId },
    });
    res.json({ log });
  } catch (err) { next(err); }
};

// ── Prime cost (gap 15) ──────────────────────────────────────────────

exports.primeCost = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const timezone = payrollService.resolveReportTimezone(restaurant);
    const { fromDate, toDate } = payrollService.parseLocalRange(req.query || {}, timezone);
    const locationIds = restaurant.locationScope?.mode === 'assigned'
      ? restaurant.locationScope.location_ids
      : (req.query.locationId == null ? null : [Number(req.query.locationId)]);
    const prime = await primeCostService.computePrimeCost({
      restaurant, fromDate, toDate, locationIds,
    });
    res.json(prime);
  } catch (err) { next(err); }
};

// ── Break attestations (gap 17) ─────────────────────────────────────

exports.listBreakAttestations = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const attestations = await breakAttestation.listAttestations(pool, {
      businessId: Number(restaurant.business_id),
      fromDate: dateParam(req.query.from, 'from'),
      toDate: dateParam(req.query.to, 'to'),
      waivedOnly: req.query.waivedOnly === 'true',
      disputedOnly: req.query.disputedOnly === 'true',
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ attestations });
  } catch (err) { next(err); }
};

// ── Scheduled reports (gap 19) ──────────────────────────────────────

exports.listScheduledReports = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows } = await pool.query(
      `SELECT * FROM restaurant_scheduled_reports
        WHERE restaurant_id = $1 ORDER BY id`,
      [restaurantId]
    );
    res.json({ schedules: rows });
  } catch (err) { next(err); }
};

exports.createScheduledReport = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const input = scheduledReports.validateScheduleInput(req.body || {});
    // Money flows W2: recipients must be members of the
    // restaurant's business (or the business owner); outsiders and
    // non-member emails are rejected before the schedule is stored.
    await scheduledReports.validateScheduleRecipients(pool, {
      businessId: Number(restaurant.business_id),
      recipients: input.recipients,
    });
    assertLocationInScope(restaurant.locationScope, input.locationId);
    // Phase 8 Track D/E: a digest's anchor restaurant must belong
    // to the digest's brand, or the digest would report on a brand
    // the anchor never joined.
    if (input.brandId != null) {
      const brandService = require('../services/restaurantBrandService');
      const restaurants = await brandService.listBrandRestaurants(pool, input.brandId);
      if (!restaurants.some((row) => Number(row.id) === restaurantId)) {
        throw new AppError('This restaurant does not belong to that brand', 400, 'validation_failed');
      }
    }
    const { rows: [row] } = await pool.query(
      `INSERT INTO restaurant_scheduled_reports
         (restaurant_id, location_id, brand_id, report_type, frequency,
          delivery_channel, recipients, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING *`,
      [
        restaurantId, input.locationId, input.brandId, input.reportType, input.frequency,
        input.deliveryChannel, JSON.stringify(input.recipients), req.user.id,
      ]
    );
    await logBusinessAction(req, {
      business_id: Number(restaurant.business_id),
      action: 'restaurant.scheduled_report.created',
      target_type: 'scheduled_report',
      target_id: row.id,
      after_state: row,
    });
    res.status(201).json({ schedule: row });
  } catch (err) { next(err); }
};

exports.updateScheduledReport = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const scheduleId = parsePositiveInt(req.params.scheduleId);
    if (!scheduleId) throw new AppError('Schedule not found', 404, 'schedule_not_found');
    const input = scheduledReports.validateScheduleInput(req.body || {});
    // Money flows W2: see createScheduledReport — membership is
    // re-checked on every update, so an outsider cannot be added
    // by editing an existing schedule.
    await scheduledReports.validateScheduleRecipients(pool, {
      businessId: Number(restaurant.business_id),
      recipients: input.recipients,
    });
    assertLocationInScope(restaurant.locationScope, input.locationId);
    if (input.brandId != null) {
      const brandService = require('../services/restaurantBrandService');
      const restaurants = await brandService.listBrandRestaurants(pool, input.brandId);
      if (!restaurants.some((row) => Number(row.id) === restaurantId)) {
        throw new AppError('This restaurant does not belong to that brand', 400, 'validation_failed');
      }
    }
    const { rows: [row] } = await pool.query(
      `UPDATE restaurant_scheduled_reports
          SET location_id = $2, brand_id = $3, report_type = $4, frequency = $5,
              delivery_channel = $6, recipients = $7::jsonb,
              enabled = COALESCE($8::boolean, enabled), updated_at = NOW()
        WHERE id = $1 AND restaurant_id = $9
        RETURNING *`,
      [
        scheduleId, input.locationId, input.brandId, input.reportType, input.frequency,
        input.deliveryChannel, JSON.stringify(input.recipients),
        req.body?.enabled ?? null, restaurantId,
      ]
    );
    if (!row) throw new AppError('Schedule not found', 404, 'schedule_not_found');
    res.json({ schedule: row });
  } catch (err) { next(err); }
};

exports.deleteScheduledReport = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const scheduleId = parsePositiveInt(req.params.scheduleId);
    if (!scheduleId) throw new AppError('Schedule not found', 404, 'schedule_not_found');
    const { rowCount } = await pool.query(
      'DELETE FROM restaurant_scheduled_reports WHERE id = $1 AND restaurant_id = $2',
      [scheduleId, restaurantId]
    );
    if (!rowCount) throw new AppError('Schedule not found', 404, 'schedule_not_found');
    await logBusinessAction(req, {
      business_id: Number(restaurant.business_id),
      action: 'restaurant.scheduled_report.deleted',
      target_type: 'scheduled_report',
      target_id: scheduleId,
    });
    res.json({ deleted: true });
  } catch (err) { next(err); }
};

exports.listScheduledReportDeliveries = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const scheduleId = req.query.scheduleId == null ? null : parsePositiveInt(req.query.scheduleId);
    const params = [restaurantId];
    let where = 'sr.restaurant_id = $1';
    if (scheduleId != null) {
      params.push(scheduleId);
      where += ` AND d.scheduled_report_id = $${params.length}`;
    }
    params.push(Math.min(Math.max(Number(req.query.limit) || 50, 1), 200));
    const { rows } = await pool.query(
      `SELECT d.* FROM restaurant_scheduled_report_deliveries d
         JOIN restaurant_scheduled_reports sr ON sr.id = d.scheduled_report_id
        WHERE ${where}
        ORDER BY d.business_date DESC, d.created_at DESC
        LIMIT $${params.length}`,
      params
    );
    res.json({ deliveries: rows });
  } catch (err) { next(err); }
};

// Run one schedule now for a business date (default yesterday). The
// deliveries ledger dedupes: re-running for the same date replays
// instead of sending twice.
exports.runScheduledReportNow = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const scheduleId = parsePositiveInt(req.params.scheduleId);
    if (!scheduleId) throw new AppError('Schedule not found', 404, 'schedule_not_found');
    const { rows: [schedule] } = await pool.query(
      `SELECT * FROM restaurant_scheduled_reports WHERE id = $1 AND restaurant_id = $2`,
      [scheduleId, restaurantId]
    );
    if (!schedule) throw new AppError('Schedule not found', 404, 'schedule_not_found');
    const timezone = restaurant.timezone || 'UTC';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
    const businessDate = dateParam(req.body?.businessDate ?? req.body?.business_date, 'businessDate')
      || scheduledReports.shiftDateString(today, -1);
    const asOf = new Date();
    const payload = await scheduledReports.buildScheduledReport(pool, {
      restaurant, schedule, businessDate, asOf,
    });
    // Item 14 (same defect as the nightly run): claim the delivery
    // as 'pending' before sending, so a failed manual send is
    // recorded 'failed' and retryable instead of stuck 'sent'.
    const claim = await scheduledReports.claimScheduledReportDelivery(pool, {
      schedule, businessDate, asOf,
    });
    if (!claim.delivery) return res.json({ delivery: null, replayed: true, payload });
    try {
      // Background-jobs audit #41: a {success:false} recipient is a
      // failed delivery, not a partial success. Throw so the catch
      // below marks the claimed row 'failed' (keeping the delivered
      // count) and the date stays retryable.
      const outcome = await scheduledReports.deliverScheduledReport(pool, { schedule, payload });
      if (outcome.failed > 0) {
        const err = new Error(`Scheduled report delivery failed for ${outcome.failed} of ${outcome.delivered + outcome.failed} recipient(s): ${outcome.errors.map((e) => e.error).join('; ')}`);
        err.deliveryRecipientCount = outcome.delivered;
        throw err;
      }
      const recipientCount = outcome.delivered;
      await scheduledReports.markDeliverySent(pool, { deliveryId: claim.delivery.id, recipientCount });
      await pool.query(
        `UPDATE restaurant_scheduled_reports
            SET last_run_at = NOW(), last_business_date = $2::date, updated_at = NOW()
          WHERE id = $1`,
        [schedule.id, businessDate]
      );
      res.json({ delivery: { ...claim.delivery, status: 'sent', recipient_count: recipientCount }, replayed: false, payload });
    } catch (err) {
      await scheduledReports.markDeliveryFailed(pool, { deliveryId: claim.delivery.id, error: err.message, recipientCount: err.deliveryRecipientCount ?? null }).catch(() => {});
      throw err;
    }
  } catch (err) { next(err); }
};

// ── Retention + erasure (gap 21) ─────────────────────────────────────

exports.getRetentionPolicies = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireManagerAccess(req.user.id, restaurantId);
    const locationId = req.query.locationId == null ? null : Number(req.query.locationId);
    assertLocationInScope(restaurant.locationScope, locationId);
    const policies = await retentionService.getRetentionPolicies(pool, {
      restaurantId, locationId,
    });
    res.json({ policies, default_years: retentionService.DEFAULT_RETENTION_YEARS });
  } catch (err) { next(err); }
};

exports.setRetentionPolicy = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireManagerAccess(req.user.id, restaurantId);
    const body = req.body || {};
    const locationId = body.locationId == null && body.location_id == null
      ? null : Number(body.locationId ?? body.location_id);
    assertLocationInScope(restaurant.locationScope, locationId);
    const policy = await retentionService.setRetentionPolicy(pool, {
      restaurantId,
      locationId,
      recordClass: body.recordClass ?? body.record_class,
      retentionYears: body.retentionYears ?? body.retention_years,
      jurisdictionCode: body.jurisdictionCode ?? body.jurisdiction_code ?? null,
      source: body.source || 'operator',
      updatedBy: req.user.id,
    });
    await logBusinessAction(req, {
      business_id: Number(restaurant.business_id),
      action: 'restaurant.retention_policy.updated',
      target_type: 'retention_policy',
      target_id: policy.id,
      after_state: policy,
    });
    res.json({ policy });
  } catch (err) { next(err); }
};

exports.listErasureRequests = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireManagerAccess(req.user.id, restaurantId);
    const { rows } = await pool.query(
      `SELECT er.*, COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS user_name
         FROM restaurant_erasure_requests er
         JOIN users u ON u.id = er.user_id
        WHERE er.business_id = $1 AND (er.restaurant_id IS NULL OR er.restaurant_id = $2)
        ORDER BY er.requested_at DESC
        LIMIT 100`,
      [Number(restaurant.business_id), restaurantId]
    );
    res.json({ requests: rows });
  } catch (err) { next(err); }
};

exports.createErasureRequest = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireMemberAccess(req.user.id, restaurantId);
    const body = req.body || {};
    const targetUserId = body.userId ?? body.user_id ?? req.user.id;
    const isManager = await permissionsService.hasRestaurantPermission(restaurant, req.user.id, ['settings.manage']);
    if (String(targetUserId) !== String(req.user.id) && !isManager) {
      throw new AppError('You can only request erasure for yourself', 403, 'forbidden');
    }
    const { rows: [row] } = await pool.query(
      `INSERT INTO restaurant_erasure_requests
         (business_id, restaurant_id, user_id, requested_by, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        Number(restaurant.business_id), restaurantId, targetUserId,
        req.user.id, body.reason == null ? null : String(body.reason).slice(0, 1000),
      ]
    );
    res.status(201).json({ request: row });
  } catch (err) { next(err); }
};

exports.decideErasureRequest = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireManagerAccess(req.user.id, restaurantId);
    const requestId = parsePositiveInt(req.params.requestId);
    const decision = req.body?.decision ?? req.body?.status;
    if (!requestId || (decision !== 'approved' && decision !== 'rejected')) {
      throw new AppError('decision must be approved or rejected', 400, 'validation_failed');
    }
    const { rows: [existing] } = await pool.query(
      `SELECT * FROM restaurant_erasure_requests
        WHERE id = $1 AND business_id = $2`,
      [requestId, Number(restaurant.business_id)]
    );
    if (!existing || existing.status !== 'requested') {
      throw new AppError('Erasure request not found or already decided', 404, 'erasure_request_not_found');
    }
    // Finding 46: a manager can never approve their own erasure
    // request — erasing personal data needs a second manager's
    // approval. (Rejecting your own request is a withdrawal, not an
    // approval, so it stays allowed.)
    if (decision === 'approved' && String(existing.requested_by) === String(req.user.id)) {
      throw new AppError(
        'You cannot approve your own erasure request; a different manager must approve it',
        409,
        'erasure_self_approval'
      );
    }
    const { rows: [row] } = await pool.query(
      `UPDATE restaurant_erasure_requests
          SET status = $1, decided_by = $2, decided_at = NOW(), updated_at = NOW()
        WHERE id = $3 AND business_id = $4 AND status = 'requested'
        RETURNING *`,
      [decision, req.user.id, requestId, Number(restaurant.business_id)]
    );
    if (!row) throw new AppError('Erasure request not found or already decided', 404, 'erasure_request_not_found');
    res.json({ request: row });
  } catch (err) { next(err); }
};

// Complete an approved erasure: anonymize personal content, keep the
// wage-and-hour history rows. Storage files go through the cleanup
// queue; the outcome records counts only, never storage keys.
exports.runErasureRequest = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireManagerAccess(req.user.id, restaurantId);
    const requestId = parsePositiveInt(req.params.requestId);
    if (!requestId) throw new AppError('Erasure request not found', 404, 'erasure_request_not_found');
    const { rows: [request] } = await pool.query(
      `SELECT * FROM restaurant_erasure_requests
        WHERE id = $1 AND business_id = $2 AND status = 'approved'`,
      [requestId, Number(restaurant.business_id)]
    );
    if (!request) throw new AppError('Erasure request not found or not approved', 404, 'erasure_request_not_found');
    const { rows: [offboarding] } = await pool.query(
      `SELECT retain_until FROM staff_offboarding_records
        WHERE business_id = $1 AND user_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [Number(restaurant.business_id), request.user_id]
    );
    // Finding 12: erasure needs an offboarding record with an expired
    // retain_until. With no record the gate was silently bypassed
    // (retainUntil null skipped the date check); refuse instead of
    // completing, naming the missing retention.
    if (!offboarding) {
      throw new AppError(
        'No offboarding retention record exists for this person; erasure requires an expired retention record',
        409,
        'retention_record_missing'
      );
    }
    const outcome = await retentionService.anonymizeFormerStaff(pool, {
      businessId: Number(restaurant.business_id),
      restaurantId: request.restaurant_id == null ? restaurantId : Number(request.restaurant_id),
      userId: request.user_id,
      retainUntil: offboarding?.retain_until || null,
    });
    if (outcome.skipped) {
      if (outcome.reason === 'retention_not_established') {
        return res.status(409).json({
          error: 'No offboarding retention record exists for this person; erasure requires an expired retention record',
          code: 'retention_record_missing',
          retain_until: null,
        });
      }
      return res.status(409).json({
        error: 'Retention has not expired for this person',
        code: 'retention_not_expired',
        retain_until: outcome.retain_until,
      });
    }
    for (const key of outcome.storageKeysToDelete || []) {
      await enqueueStorageDeletion(key, 'staff_erasure');
    }
    const storedOutcome = { ...outcome };
    delete storedOutcome.storageKeysToDelete;
    const { rows: [completed] } = await pool.query(
      `UPDATE restaurant_erasure_requests
          SET status = 'completed', completed_at = NOW(), outcome = $2::jsonb, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [requestId, JSON.stringify(storedOutcome)]
    );
    await logBusinessAction(req, {
      business_id: Number(restaurant.business_id),
      action: 'restaurant.erasure.completed',
      target_type: 'erasure_request',
      target_id: requestId,
      after_state: { user_id: request.user_id, ...storedOutcome },
    });
    res.json({ request: completed });
  } catch (err) { next(err); }
};
