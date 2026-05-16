'use strict';

/**
 * server/middleware/enforceBookingRules.js
 *
 * Phase 2c: validate a POST /api/businesses/:businessId/appointments
 * request body against the business_booking_rules table and the actual
 * business_appointments calendar.
 *
 * Runs BEFORE businessAppointmentsController.createAppointment.
 * Bails early with 4xx when:
 *   - service is missing or inactive
 *   - start_time is in the past or before min_advance_booking_hours
 *   - start_time is past max_advance_booking_days
 *   - end_time - start_time != service.duration_minutes (within 1 min tolerance)
 *   - the staff_id (if provided) is not assigned to the service
 *   - the slot is already filled to max_capacity for that staff_id (proper
 *     per-staff overbooking guard, fixes the "service-wide" check that
 *     existed in createAppointment).
 *
 * Attaches `req.bookingValidation` with normalized fields the controller
 * can use without re-querying:
 *   { service, startTimeIso, endTimeIso, staffId }
 */

const pool = require('../db');
const { sendError } = require('../utils/apiError');

const BLOCKING = ['pending', 'confirmed', 'in_progress', 'completed'];

function parseInt10(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }

module.exports = async function enforceBookingRules(req, res, next) {
  try {
    const businessId = parseInt10(req.params.businessId);
    if (!businessId) return sendError(res, 400, 'Invalid business id', 'invalid_business_id');

    const body = req.body || {};
    const serviceId = parseInt10(body.service_id);
    const staffId   = body.staff_id ? String(body.staff_id) : null;
    const startTime = body.start_time ? new Date(body.start_time) : null;
    const endTime   = body.end_time   ? new Date(body.end_time)   : null;

    if (!serviceId)  return sendError(res, 400, 'service_id is required', 'validation_failed');
    if (!startTime || isNaN(startTime.getTime())) return sendError(res, 400, 'start_time is invalid', 'validation_failed');
    if (!endTime   || isNaN(endTime.getTime()))   return sendError(res, 400, 'end_time is invalid',   'validation_failed');
    if (endTime <= startTime) return sendError(res, 400, 'end_time must be after start_time', 'validation_failed');

    // 1) Service exists, is bookable, and matches the business
    const svcRes = await pool.query(
      `SELECT id, business_id, duration_minutes, max_capacity, min_notice_hours,
              is_active, allow_online_booking, deleted_at
         FROM business_services
        WHERE id = $1 AND business_id = $2`,
      [serviceId, businessId]
    );
    const svc = svcRes.rows[0];
    if (!svc) return sendError(res, 404, 'Service not found', 'service_not_found');
    if (svc.deleted_at) return sendError(res, 410, 'Service has been deleted', 'service_deleted');
    if (svc.is_active === false) return sendError(res, 409, 'Service is inactive', 'service_inactive');

    // Duration sanity (1 min tolerance for clock skew)
    const requestedMin = Math.round((endTime.getTime() - startTime.getTime()) / 60000);
    if (svc.duration_minutes && Math.abs(requestedMin - svc.duration_minutes) > 1) {
      return sendError(res, 400, `Booking duration must equal service duration (${svc.duration_minutes} min)`,
        'duration_mismatch');
    }

    // 2) Booking rules
    const rulesRes = await pool.query(
      `SELECT min_advance_booking_hours, max_advance_booking_days
         FROM business_booking_rules WHERE business_id = $1 LIMIT 1`,
      [businessId]
    );
    const rules = rulesRes.rows[0] || { min_advance_booking_hours: 0, max_advance_booking_days: 365 };
    const minNotice = Math.max(svc.min_notice_hours || 0, rules.min_advance_booking_hours || 0);
    const now = new Date();
    if (startTime < new Date(now.getTime() + minNotice * 3600 * 1000)) {
      return sendError(res, 400, `Booking requires at least ${minNotice}h advance notice`, 'min_notice_violated');
    }
    const maxAdvance = (rules.max_advance_booking_days || 365) * 24 * 3600 * 1000;
    if (startTime > new Date(now.getTime() + maxAdvance)) {
      return sendError(res, 400, `Booking is past the max advance window of ${rules.max_advance_booking_days} days`,
        'max_advance_violated');
    }

    // 3) Staff (if provided) must be assigned to this service
    if (staffId) {
      const staffRes = await pool.query(
        `SELECT 1 FROM business_service_staff
          WHERE service_id = $1 AND staff_id = $2 AND is_available = TRUE`,
        [serviceId, staffId]
      );
      if (!staffRes.rows.length) {
        return sendError(res, 400, 'Staff member is not assigned to this service', 'staff_not_assigned');
      }
    }

    // 4) Per-staff overbooking guard.
    // If staff_id is provided, conflict count is per (service, staff) at this time.
    // If no staff_id, conflict count is per service across all staff (legacy behavior).
    const conflictRes = await pool.query(
      staffId
        ? `SELECT COUNT(*)::int AS n FROM business_appointments
            WHERE service_id = $1 AND staff_id = $2
              AND status = ANY($3)
              AND start_time < $5 AND end_time > $4`
        : `SELECT COUNT(*)::int AS n FROM business_appointments
            WHERE service_id = $1
              AND status = ANY($2)
              AND start_time < $4 AND end_time > $3`,
      staffId
        ? [serviceId, staffId, BLOCKING, startTime.toISOString(), endTime.toISOString()]
        : [serviceId, BLOCKING, startTime.toISOString(), endTime.toISOString()]
    );
    const taken = conflictRes.rows[0] ? conflictRes.rows[0].n : 0;
    if (taken >= (svc.max_capacity || 1)) {
      return sendError(res, 409, 'No availability at this time', 'slot_full');
    }

    // 5) Blocked time exclusion (service-wide or per-staff)
    const blockRes = await pool.query(
      `SELECT 1 FROM business_service_blocked_times
        WHERE business_id = $1
          AND (service_id = $2 OR service_id IS NULL)
          ${staffId ? 'AND (staff_id = $3 OR staff_id IS NULL)' : ''}
          AND start_time < ${staffId ? '$5' : '$4'}
          AND end_time   > ${staffId ? '$4' : '$3'}`,
      staffId
        ? [businessId, serviceId, staffId, startTime.toISOString(), endTime.toISOString()]
        : [businessId, serviceId, startTime.toISOString(), endTime.toISOString()]
    );
    if (blockRes.rows.length) {
      return sendError(res, 409, 'This time is blocked', 'time_blocked');
    }

    req.bookingValidation = {
      service: svc,
      startTimeIso: startTime.toISOString(),
      endTimeIso:   endTime.toISOString(),
      staffId,
    };
    next();
  } catch (err) { next(err); }
};
