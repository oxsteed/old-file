'use strict';

/**
 * Shared booking-request lifecycle for calendar + messenger.
 * Canonical store: booking_requests (migrations 176 → 537+).
 */

const pool = require('../db');
const logger = require('../utils/logger');
const socketService = require('./socketService');
const { withTransaction } = require('../utils/transaction');
const availabilityService = require('./helperAvailabilityService');
const {
  canProviderRespond,
  canCustomerRespond,
  toPublicBookingRequestCard,
  toChatStatus,
  normalizeClock,
  normalizeDate,
  buildStatusMessage,
} = require('./chatBookingRequests');
const {
  assertConversationParticipant,
  assertGuestInquiryAccess,
  assertBusinessAccess,
} = require('./chatThreadAccess');

const INBOX_STATUSES = ['pending', 'counter_proposed'];
// Expired requests are never actionable: the read-side expiry (expireIfStale)
// and the expiry worker transition them, and the respond paths below refuse
// anything whose window has lapsed, so 'expired' is intentionally absent here.
const PROVIDER_RESPOND_STATUSES = ['pending', 'counter_proposed'];

async function loadBooking(id) {
  if (!id) return null;
  const { rows } = await pool.query('SELECT * FROM booking_requests WHERE id = $1', [id]);
  return rows[0] || null;
}

async function logAudit(bookingId, action, actorId, actorType, oldStatus, newStatus, db = pool) {
  try {
    await db.query(
      `INSERT INTO booking_request_audit_log
         (booking_request_id, action, actor_id, actor_type, old_status, new_status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [bookingId, action, actorId || null, actorType || null, oldStatus || null, newStatus || null],
    );
  } catch (err) {
    logger.warn('[bookingLifecycle] audit failed', { error: err.message });
  }
}

/**
 * Publish an expired booking as a public job when the customer chose the
 * marketplace fallback (auto_post_on_expiry). Moved here from
 * bookingController so read-side expiry (expireIfStale) and the expiry worker
 * share one implementation; the controller keeps the socket/push wrapper.
 * Returns { booking, jobId } or null when not eligible.
 */
async function autoPostExpiredBooking(bookingId) {
  return withTransaction(
    pool,
    async (client) => {
      const bookingResult = await client.query(
        `SELECT * FROM booking_requests
          WHERE id = $1
          FOR UPDATE`,
        [bookingId],
      );
      const booking = bookingResult.rows[0];
      if (!booking || booking.status !== 'pending' || !booking.auto_post_on_expiry || !booking.customer_id) {
        return null;
      }
      if (new Date(booking.expires_at) > new Date()) {
        return null;
      }

      const title = String(booking.service_name || 'Service request').trim().slice(0, 255) || 'Service request';
      const description = [
        booking.description,
        booking.requested_date ? `Requested date: ${booking.requested_date}` : null,
        booking.requested_start_time && booking.requested_end_time
          ? `Requested time: ${booking.requested_start_time}–${booking.requested_end_time}`
          : 'The provider had not published availability; please coordinate a time.',
        booking.service_location ? `Service location: ${booking.service_location}` : null,
      ]
        .filter(Boolean)
        .join('\n\n');

      const jobResult = await client.query(
        `INSERT INTO jobs (
           client_id, title, description, category_name,
           location_address, status, expires_at
         ) VALUES ($1, $2, $3, $4, $5, 'published', NOW() + INTERVAL '30 days')
         RETURNING id`,
        [booking.customer_id, title, description || title, title.slice(0, 100), booking.service_location || null],
      );
      const job = jobResult.rows[0];

      const updatedResult = await client.query(
        `UPDATE booking_requests
            SET status = 'expired',
                converted_to_job_id = $2,
                marketplace_posted_at = CURRENT_TIMESTAMP,
                helper_response_reason = COALESCE(
                  helper_response_reason,
                  'Published as a public job after the request window expired'
                ),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND status = 'pending'
          RETURNING *`,
        [booking.id, job.id],
      );
      if (!updatedResult.rows[0]) {
        throw new Error('Booking changed before marketplace fallback could be recorded');
      }

      await client.query(
        `INSERT INTO booking_request_audit_log
          (booking_request_id, action, actor_id, actor_type, old_status, new_status, metadata)
         VALUES ($1, 'auto_posted', NULL, 'system', 'pending', 'expired', $2::jsonb)`,
        [booking.id, JSON.stringify({ jobId: job.id })],
      );
      return { booking: updatedResult.rows[0], jobId: job.id };
    },
    'autoPostExpiredBooking',
  );
}

async function expireIfStale(bookingRow) {
  if (!bookingRow || bookingRow.status !== 'pending') return bookingRow;
  const exp = new Date(bookingRow.expires_at);
  if (!(exp instanceof Date) || Number.isNaN(exp.getTime()) || exp > new Date()) {
    return bookingRow;
  }
  // The customer's chosen marketplace fallback wins over plain expiry, even
  // on read paths, so a provider opening an overdue inbox never silently
  // suppresses the auto-post the customer asked for.
  if (bookingRow.auto_post_on_expiry && bookingRow.customer_id) {
    try {
      const posted = await autoPostExpiredBooking(bookingRow.id);
      if (posted?.booking) {
        await emitBookingEvent({ booking: posted.booking, event: 'expired' });
        return posted.booking;
      }
    } catch (e) {
      logger.warn('[bookingLifecycle] auto-post on read failed', { error: e.message });
    }
    return bookingRow;
  }
  const r = await pool.query(
    `UPDATE booking_requests
        SET status = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [bookingRow.id],
  );
  if (r.rows.length) {
    await logAudit(bookingRow.id, 'expired', null, 'system', 'pending', 'expired');
    await emitBookingEvent({ booking: r.rows[0], event: 'expired' });
    return r.rows[0];
  }
  return bookingRow;
}

function formatTimePart(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return normalizeClock(
      `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`,
    );
  }
  return normalizeClock(value);
}

/**
 * Calendar + shared list shape (camelCase + conversation/source for UI).
 */
function toCalendarBooking(row) {
  if (!row) return null;
  const status = toChatStatus(row.status);
  return {
    id: row.id,
    customerId: row.customer_id,
    helperId: row.helper_id,
    businessId: row.business_id || null,
    serviceName: row.service_name,
    requestedDate: row.requested_date,
    requestedStartTime: row.requested_start_time,
    requestedEndTime: row.requested_end_time,
    serviceLocation: row.service_location,
    description: row.description,
    status,
    expiresAt: row.expires_at,
    confirmationHours: row.confirmation_hours,
    availabilityMode: row.availability_mode || 'scheduled',
    autoPostOnExpiry: Boolean(row.auto_post_on_expiry),
    marketplacePostedAt: row.marketplace_posted_at || null,
    acceptedAt: row.accepted_at,
    declinedAt: row.declined_at,
    helperResponseReason: row.helper_response_reason,
    convertedToJobId: row.converted_to_job_id,
    conversationId: row.conversation_id || null,
    guestSessionId: row.guest_session_id || null,
    appointmentId: row.appointment_id != null ? String(row.appointment_id) : null,
    businessAppointmentId: row.business_appointment_id || null,
    source: row.source || 'direct',
    serviceId: row.service_id || null,
    timezone: row.timezone || null,
    counter_proposed_at: row.counter_proposed_at,
    counter_date: row.counter_date,
    counter_start_time: row.counter_start_time,
    counter_end_time: row.counter_end_time,
    counter_message: row.counter_message,
    counter_status: row.counter_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customerName: row.customer_name || null,
    customerAvatar: row.customer_avatar || null,
    canRespond: canProviderRespond(row).ok,
    canCustomerRespond: canCustomerRespond(row).ok,
  };
}

/**
 * Same provider authz as chat `/api/chat/booking-requests/*`:
 * helper owner, business owner/member, conversation helper/business, guest inquiry provider.
 */
async function isProviderForBooking(userId, booking) {
  if (!userId || !booking) return false;
  if (booking.helper_id && String(booking.helper_id) === String(userId)) return true;
  if (booking.business_id) {
    const biz = await assertBusinessAccess(userId, booking.business_id);
    if (biz) return true;
  }
  if (booking.conversation_id) {
    const conv = await assertConversationParticipant(userId, booking.conversation_id);
    if (conv && conv.helper_id && String(conv.helper_id) === String(userId)) return true;
    if (conv?.business_id) {
      const biz = await assertBusinessAccess(userId, conv.business_id);
      if (biz) return true;
    }
  }
  if (booking.guest_session_id) {
    const guest = await assertGuestInquiryAccess(userId, booking.guest_session_id);
    if (guest) return true;
  }
  return false;
}

/** Active business ids the user owns or is an active member of. */
async function resolveProviderBusinessIds(userId) {
  if (!userId) return [];
  const { rows } = await pool
    .query(
      `SELECT id FROM businesses WHERE user_id = $1 AND is_active = TRUE
       UNION
       SELECT bm.business_id AS id
         FROM business_members bm
         JOIN businesses b ON b.id = bm.business_id AND b.is_active = TRUE
        WHERE bm.member_id = $1 AND bm.status = 'active'`,
      [userId],
    )
    .catch(() => ({ rows: [] }));
  return rows.map((r) => r.id).filter(Boolean);
}

/**
 * List inbox rows for a provider actor (helper + business-scoped parity with chat).
 * Includes guest requests (LEFT JOIN users). Default: pending + counter_proposed.
 */
async function listIncomingForProvider(providerUserId, { status, statuses } = {}) {
  let statusList;
  if (Array.isArray(statuses) && statuses.length) {
    statusList = statuses.map((s) => toChatStatus(s));
  } else if (status === 'all' || status === '*') {
    statusList = null;
  } else if (status) {
    statusList = [toChatStatus(status)];
  } else {
    statusList = [...INBOX_STATUSES];
  }

  const businessIds = await resolveProviderBusinessIds(providerUserId);
  const params = [providerUserId, businessIds];
  let statusClause = '';
  if (statusList) {
    statusClause = ` AND br.status = ANY($${params.length + 1}::text[])`;
    params.push(statusList);
  }

  const { rows } = await pool.query(
    `SELECT br.*,
            NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS customer_name,
            u.profile_photo_url AS customer_avatar
       FROM booking_requests br
       LEFT JOIN users u ON u.id = br.customer_id
      WHERE (
        br.helper_id = $1
        OR (br.business_id IS NOT NULL AND br.business_id = ANY($2::int[]))
        OR EXISTS (
          SELECT 1 FROM conversations c
           WHERE c.id = br.conversation_id
             AND (
               c.helper_id = $1
               OR (c.business_id IS NOT NULL AND c.business_id = ANY($2::int[]))
             )
        )
        OR EXISTS (
          SELECT 1 FROM guest_profile_chat_inbound g
           WHERE g.id = br.guest_session_id
             AND (
               g.helper_id = $1
               OR (g.business_id IS NOT NULL AND g.business_id = ANY($2::int[]))
             )
        )
      )
      ${statusClause}
      ORDER BY br.created_at DESC`,
    params,
  );

  const out = [];
  for (const row of rows) {
    const maybeExpired = await expireIfStale(row);
    // After expire, re-check against requested status list
    if (statusList && !statusList.includes(toChatStatus(maybeExpired.status))) {
      continue;
    }
    out.push(toCalendarBooking({ ...row, ...maybeExpired }));
  }
  return out;
}

/**
 * Parse a booking's requested slot into Date objects (server-local wall clock,
 * matching the availability template model). Returns null when the booking
 * carries no usable time (e.g. request_only before a time is agreed).
 */
function parseBookingSlot(booking) {
  const date = normalizeDate(booking.requested_date);
  const start = normalizeClock(booking.requested_start_time);
  const end = normalizeClock(booking.requested_end_time);
  if (!date || !start || !end) return null;
  const startDate = new Date(`${date}T${start}:00`);
  const endDate = new Date(`${date}T${end}:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    return null;
  }
  return { date, start, end, startDate, endDate };
}

function slotConflictError(code, reason) {
  const e = new Error(code);
  e.code = code;
  if (reason) e.reason = reason;
  e.status = 409;
  return e;
}

/**
 * A pending request whose response window has passed. Respond paths refuse
 * these instead of resurrecting them; the caller is expected to run
 * expireIfStale first so the row (and the customer's auto-post fallback)
 * transitions properly.
 */
function isStalePending(row) {
  if (!row || row.status !== 'pending' || !row.expires_at) return false;
  const exp = new Date(row.expires_at);
  return !Number.isNaN(exp.getTime()) && exp <= new Date();
}

function expiredError() {
  const err = new Error('This booking request has expired');
  err.code = 'expired';
  err.status = 409;
  return err;
}

function businessServiceMissingError() {
  const err = new Error('The requested service is no longer offered by this business');
  err.code = 'business_service_missing';
  err.status = 409;
  return err;
}

// Appointment-step failures that must roll the whole accept back (the slot
// was lost to a race, or the business appointment cannot be created).
const ACCEPT_ROLLBACK_CODES = new Set([
  'SCHEDULING_CONFLICT',
  'HELPER_UNAVAILABLE',
  'business_service_missing',
]);

/**
 * Helper-scoped conflict protection: overlapping appointments + the unified
 * true-availability check. Throws SCHEDULING_CONFLICT / HELPER_UNAVAILABLE.
 * `excludeAppointmentId` skips the booking's own already-linked appointment
 * so re-accepting a request that created its appointment up front never
 * conflicts with itself. Callers must hold the helper advisory lock
 * (pg_advisory_xact_lock on `appointments:<helperId>`) so concurrent accepts
 * serialize.
 */
async function checkHelperSlotFree(helperId, startDate, endDate, db, excludeAppointmentId = null) {
  const params = [helperId, startDate, endDate];
  let excludeClause = '';
  if (excludeAppointmentId != null) {
    excludeClause = ` AND id <> $${params.length + 1}`;
    params.push(excludeAppointmentId);
  }
  const overlap = await db.query(
    `SELECT 1
       FROM appointments
      WHERE helper_id = $1
        AND status IN ('requested','confirmed','in_progress')
        AND scheduled_start_time < $3
        AND scheduled_end_time > $2${excludeClause}
      LIMIT 1`,
    params,
  );
  if (overlap.rows.length > 0) throw slotConflictError('SCHEDULING_CONFLICT');
  const helperTimeZone = await availabilityService.getHelperTimeZone(db, helperId);
  const slotCheck = await availabilityService.isSlotFree(
    helperId,
    startDate.toISOString(),
    endDate.toISOString(),
    db,
    helperTimeZone,
  );
  if (!slotCheck.free) throw slotConflictError('HELPER_UNAVAILABLE', slotCheck.reason);
}

/**
 * Business-scoped conflict protection: overlapping business_appointments.
 * This is the same store the business slot engine reads, so an accepted
 * booking can never be re-offered. `excludeAppointmentId` skips the booking's
 * own already-linked business appointment. Callers must hold the business
 * advisory lock (pg_advisory_xact_lock on
 * `business_appointments:<businessId>`).
 */
async function checkBusinessSlotFree(businessId, startDate, endDate, db, excludeAppointmentId = null) {
  const params = [businessId, startDate, endDate];
  let excludeClause = '';
  if (excludeAppointmentId != null) {
    excludeClause = ` AND id <> $${params.length + 1}`;
    params.push(excludeAppointmentId);
  }
  const overlap = await db.query(
    `SELECT 1
       FROM business_appointments
      WHERE business_id = $1
        AND status IN ('pending','confirmed','in_progress')
        AND start_time < $3
        AND end_time > $2${excludeClause}
      LIMIT 1`,
    params,
  );
  if (overlap.rows.length > 0) throw slotConflictError('SCHEDULING_CONFLICT');
}

/**
 * Shared pre-accept / pre-create slot validation. Returns { ok } or
 * { ok:false, code, message } so controllers can answer 409 without throwing.
 */
async function validateBookingSlot({ helperId, businessId, date, start, end, requestOnly = false }, db = pool) {
  if (requestOnly) return { ok: true };
  const slot = parseBookingSlot({ requested_date: date, requested_start_time: start, requested_end_time: end });
  if (!slot) {
    return { ok: false, code: 'validation_failed', message: 'Invalid date or time range' };
  }
  try {
    if (businessId) {
      await checkBusinessSlotFree(businessId, slot.startDate, slot.endDate, db);
    } else if (helperId) {
      await checkHelperSlotFree(helperId, slot.startDate, slot.endDate, db);
    }
    return { ok: true, slot };
  } catch (e) {
    if (e.code === 'SCHEDULING_CONFLICT') {
      return { ok: false, code: 'slot_conflict', message: 'That time is no longer available' };
    }
    if (e.code === 'HELPER_UNAVAILABLE') {
      return {
        ok: false,
        code: 'helper_unavailable',
        message: 'The helper is not available at that time',
        reason: e.reason,
      };
    }
    throw e;
  }
}

function advisoryLockKey(booking) {
  return booking.business_id
    ? `business_appointments:${booking.business_id}`
    : `appointments:${booking.helper_id}`;
}

async function confirmOrCreateHelperAppointment(booking, helperId, { source = 'booking_accept', db = pool } = {}) {
  if (booking.appointment_id) {
    const { rows } = await db.query(
      `UPDATE appointments
          SET status = 'confirmed',
              updated_at = NOW()
        WHERE id = $1 AND helper_id = $2 AND status IN ('requested', 'confirmed')
        RETURNING *`,
      [booking.appointment_id, helperId],
    );
    return rows[0] || null;
  }

  const slot = parseBookingSlot(booking);
  if (!slot) return null;

  // Guarded: overlap + true availability (caller holds the advisory lock).
  await checkHelperSlotFree(helperId, slot.startDate, slot.endDate, db);

  const duration = Math.max(15, Math.min(480, Math.round((slot.endDate - slot.startDate) / 60000) || 60));
  const customerId = booking.customer_id || '00000000-0000-4000-8000-000000000001';

  const { rows } = await db.query(
    `INSERT INTO appointments (
       customer_id, helper_id, job_id, service_description,
       scheduled_start_time, scheduled_end_time, estimated_duration_minutes,
       customer_notes, status, created_by_user_id,
       source, guest_name, guest_email
     ) VALUES (
       $1, $2, NULL, $3, $4, $5, $6, $7, 'confirmed', $8,
       $9, NULL, NULL
     ) RETURNING *`,
    [
      customerId,
      helperId,
      booking.service_name || 'Booked service',
      slot.startDate,
      slot.endDate,
      duration,
      [
        booking.source ? `source=${booking.source}` : null,
        booking.conversation_id ? `conversation_id=${booking.conversation_id}` : null,
        `booking_request_id=${booking.id}`,
      ]
        .filter(Boolean)
        .join(' | '),
      helperId,
      source,
    ],
  );
  const appt = rows[0];
  if (appt?.id) {
    await db.query(
      'UPDATE booking_requests SET appointment_id = $2, updated_at = NOW() WHERE id = $1',
      [booking.id, appt.id],
    );
  }
  return appt;
}

/**
 * Resolve the business service a booking refers to: explicit service_id first
 * (a business_services UUID stored as TEXT on the booking), then a
 * case-insensitive name match within the business. Returns null when no
 * active service matches; callers reject the accept cleanly instead of
 * leaving an accepted booking invisible to the business calendar
 * (business_appointments.service_id is NOT NULL).
 */
async function resolveBusinessService(booking, db) {
  const idText = String(booking.service_id || '').trim();
  if (idText) {
    const { rows } = await db.query(
      `SELECT id, name, base_price_cents
         FROM business_services
        WHERE id::text = $1 AND business_id = $2 AND is_active = TRUE`,
      [idText, booking.business_id],
    );
    if (rows[0]) return rows[0];
  }
  const name = String(booking.service_name || '').trim();
  if (name) {
    const { rows } = await db.query(
      `SELECT id, name, base_price_cents
         FROM business_services
        WHERE business_id = $1 AND is_active = TRUE AND LOWER(name) = LOWER($2)
        ORDER BY id
        LIMIT 1`,
      [booking.business_id, name],
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

/**
 * Business booking acceptance creates a business_appointments row in the
 * business's own calendar (status confirmed, staff assigned to the accepting
 * owner), never a row in the owner's personal appointments table.
 */
async function confirmOrCreateBusinessAppointment(booking, helperId, { db = pool } = {}) {
  if (booking.business_appointment_id) {
    const { rows } = await db.query(
      `UPDATE business_appointments
          SET status = 'confirmed', updated_at = NOW()
        WHERE id = $1 AND business_id = $2 AND status IN ('pending', 'confirmed')
        RETURNING *`,
      [booking.business_appointment_id, booking.business_id],
    );
    return rows[0] || null;
  }

  const slot = parseBookingSlot(booking);
  if (!slot) return null;

  // Guarded: overlap against the same store the slot engine reads.
  await checkBusinessSlotFree(booking.business_id, slot.startDate, slot.endDate, db);

  const service = await resolveBusinessService(booking, db);
  if (!service) {
    // business_appointments.service_id is NOT NULL: there is no safe way to
    // accept without a service, so fail the accept instead of leaving an
    // accepted booking invisible to the business calendar.
    throw businessServiceMissingError();
  }
  const priceCents = Number.isFinite(Number(service.base_price_cents)) ? Number(service.base_price_cents) : 0;

  let customerName = booking.customer_name || null;
  let customerEmail = null;
  let customerPhone = null;
  if (booking.customer_id) {
    const { rows } = await db.query(
      'SELECT first_name, last_name, email, phone FROM users WHERE id = $1',
      [booking.customer_id],
    );
    const u = rows[0];
    if (u) {
      customerName = customerName || [u.first_name, u.last_name].filter(Boolean).join(' ') || null;
      customerEmail = u.email || null;
      customerPhone = u.phone || null;
    }
  }
  const notes = [
    booking.description,
    booking.source ? `source=${booking.source}` : null,
    booking.conversation_id ? `conversation_id=${booking.conversation_id}` : null,
    `booking_request_id=${booking.id}`,
  ]
    .filter(Boolean)
    .join(' | ');

  const { rows } = await db.query(
    `INSERT INTO business_appointments (
       business_id, service_id, staff_id, customer_id, customer_name, customer_email,
       customer_phone, customer_notes, start_time, end_time,
       base_price_cents, final_price_cents, status
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'confirmed'
     )
     RETURNING *`,
    [
      booking.business_id,
      service.id,
      helperId || null,
      booking.customer_id || null,
      customerName,
      customerEmail,
      customerPhone,
      notes || null,
      slot.startDate,
      slot.endDate,
      priceCents,
      priceCents,
    ],
  );
  const appt = rows[0];
  if (appt?.id) {
    await db.query(
      'UPDATE booking_requests SET business_appointment_id = $2, updated_at = NOW() WHERE id = $1',
      [booking.id, appt.id],
    );
  }
  return appt;
}

async function confirmOrCreateAppointment(booking, helperId, opts = {}) {
  if (booking.business_id) {
    return confirmOrCreateBusinessAppointment(booking, helperId, opts);
  }
  return confirmOrCreateHelperAppointment(booking, helperId, opts);
}

async function cancelLinkedAppointment(booking, helperId, db = pool) {
  if (booking.business_appointment_id && booking.business_id) {
    const { rows } = await db.query(
      `UPDATE business_appointments
          SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND business_id = $2 AND status IN ('pending', 'confirmed', 'in_progress')
        RETURNING *`,
      [booking.business_appointment_id, booking.business_id],
    );
    return rows[0] || null;
  }
  if (!booking.appointment_id) return null;
  const { rows } = await db.query(
    `UPDATE appointments
        SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1 AND helper_id = $2 AND status IN ('requested', 'confirmed')
      RETURNING *`,
    [booking.appointment_id, helperId],
  );
  return rows[0] || null;
}

async function syncAppointmentTimes(booking, date, start, end, db = pool) {
  const startDate = new Date(`${date}T${start}:00`);
  const endDate = new Date(`${date}T${end}:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    return null;
  }
  if (booking.business_appointment_id && booking.business_id) {
    const { rows } = await db.query(
      `UPDATE business_appointments
          SET start_time = $2,
              end_time = $3,
              updated_at = NOW()
        WHERE id = $1 AND business_id = $4 AND status IN ('pending', 'confirmed')
        RETURNING *`,
      [booking.business_appointment_id, startDate, endDate, booking.business_id],
    );
    return rows[0] || null;
  }
  if (!booking.appointment_id) return null;
  const duration = Math.max(15, Math.min(480, Math.round((endDate - startDate) / 60000) || 60));
  const { rows } = await db.query(
    `UPDATE appointments
        SET scheduled_start_time = $2,
            scheduled_end_time = $3,
            estimated_duration_minutes = $4,
            updated_at = NOW()
      WHERE id = $1 AND status IN ('requested', 'confirmed')
      RETURNING *`,
    [booking.appointment_id, startDate, endDate, duration],
  );
  return rows[0] || null;
}

/**
 * Active owner + members for a business (for user-room fanout without spam).
 * Dedupes ids; caller should exclude already-notified helper/customer.
 */
async function listBusinessMemberUserIds(businessId) {
  if (!businessId) return [];
  const { rows } = await pool
    .query(
      `SELECT b.user_id AS id
         FROM businesses b
        WHERE b.id = $1 AND b.is_active = TRUE AND b.user_id IS NOT NULL
       UNION
       SELECT bm.member_id AS id
         FROM business_members bm
         JOIN businesses b ON b.id = bm.business_id AND b.is_active = TRUE
        WHERE bm.business_id = $1
          AND bm.status = 'active'
          AND bm.member_id IS NOT NULL`,
      [businessId],
    )
    .catch(() => ({ rows: [] }));
  return [...new Set(rows.map((r) => r.id).filter(Boolean).map(String))];
}

function emitToUserRooms(userId, event, payload) {
  if (!userId) return;
  socketService.broadcastToUser(userId, 'booking:updated', payload);
  socketService.broadcastToUser(userId, 'booking:chat_updated', payload);
  if (event === 'requested') {
    socketService.broadcastToUser(userId, 'booking:new', payload);
  }
}

async function emitBookingEvent({ booking, event, actorId = null }) {
  const card = toPublicBookingRequestCard(booking);
  if (!card) return;
  const payload = {
    bookingId: card.id,
    status: card.status,
    booking: card,
    event,
    actorId,
    conversationId: booking.conversation_id || null,
    guestSessionId: booking.guest_session_id || null,
    businessId: booking.business_id || null,
  };
  try {
    const notified = new Set();
    if (booking.helper_id) {
      emitToUserRooms(booking.helper_id, event, payload);
      notified.add(String(booking.helper_id));
    }
    if (booking.customer_id) {
      emitToUserRooms(booking.customer_id, event, payload);
      notified.add(String(booking.customer_id));
    }
    if (booking.conversation_id && typeof socketService.broadcastToConversation === 'function') {
      socketService.broadcastToConversation(booking.conversation_id, 'booking:chat_updated', payload);
    }
    if (booking.guest_session_id) {
      try {
        socketService.io?.to?.(`guest_session_${booking.guest_session_id}`)?.emit?.(
          'booking:chat_updated',
          payload,
        );
      } catch {
        /* optional */
      }
    }
    // Business-scoped bookings: room + member user rooms (skip helper/customer already notified).
    if (booking.business_id) {
      if (typeof socketService.broadcastToBusinessCalendar === 'function') {
        socketService.broadcastToBusinessCalendar(booking.business_id, 'booking:updated', payload);
        socketService.broadcastToBusinessCalendar(booking.business_id, 'booking:chat_updated', payload);
        if (event === 'requested') {
          socketService.broadcastToBusinessCalendar(booking.business_id, 'booking:new', payload);
        }
      }
      const memberIds = await listBusinessMemberUserIds(booking.business_id);
      for (const mid of memberIds) {
        if (notified.has(String(mid))) continue;
        emitToUserRooms(mid, event, payload);
        notified.add(String(mid));
      }
    }
  } catch (e) {
    logger.warn('[bookingLifecycle] emit failed', { error: e.message });
  }
}

/**
 * Accept: pending | counter_proposed → accepted + appointment confirm/create.
 *
 * Refuses stale (lapsed-window) and already auto-posted bookings, and
 * request-only bookings with no agreed time yet (the provider must
 * counter-propose a time first). Runs inside one transaction holding a
 * helper- or business-scoped advisory lock. The slot is conflict-checked
 * BEFORE the status flip, so two requests racing for the same time cannot
 * both confirm: the loser gets a 409 and its booking stays untouched.
 */
async function acceptBookingRequest({ booking, actorId, actorType = 'helper', appointmentSource = 'booking_accept' }) {
  const gate = canProviderRespond(booking);
  if (!gate.ok) {
    const err = new Error(gate.reason || 'invalid_status');
    err.code = gate.reason || 'invalid_status';
    err.status = 409;
    throw err;
  }
  if (booking.converted_to_job_id) {
    const err = new Error('This request was already published as a public job');
    err.code = 'already_posted';
    err.status = 409;
    throw err;
  }
  // The window lapsed before the accept: transition the row (honoring the
  // customer's auto-post fallback) and refuse instead of resurrecting it.
  if (isStalePending(booking)) {
    await expireIfStale(booking);
    throw expiredError();
  }
  const oldStatus = booking.status;

  let outcome;
  try {
    outcome = await withTransaction(
      pool,
      async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [advisoryLockKey(booking)]);

      const { rows: currentRows } = await client.query('SELECT * FROM booking_requests WHERE id = $1', [booking.id]);
      const current = currentRows[0];
      if (!current) {
        const err = new Error('Booking request not found');
        err.code = 'not_found';
        err.status = 404;
        throw err;
      }
      // Re-check staleness inside the lock: the window may have lapsed
      // between the pre-check and the re-read.
      if (isStalePending(current)) {
        throw expiredError();
      }
      const gate2 = canProviderRespond(current);
      if (!gate2.ok) {
        const err = new Error(gate2.reason || 'invalid_status');
        err.code = gate2.reason || 'invalid_status';
        err.status = 409;
        throw err;
      }
      if (current.converted_to_job_id) {
        const err = new Error('This request was already published as a public job');
        err.code = 'already_posted';
        err.status = 409;
        throw err;
      }

      // A concrete time must be agreed before accepting: request-only
      // bookings get their time via a counter-proposal first.
      const slot = parseBookingSlot(current);
      if (!slot) {
        throw slotConflictError(
          'time_required',
          'An agreed time is required before accepting. Propose a time first.',
        );
      }

      // Conflict pre-check before flipping status: a double-booked slot fails
      // the accept cleanly instead of accepting without an appointment. The
      // booking's own already-linked appointment is excluded so it never
      // conflicts with itself. Business bookings also resolve their service
      // up front: without an active service no business appointment can be
      // created (service_id is NOT NULL), so the accept must fail here.
      if (current.business_id) {
        await checkBusinessSlotFree(
          current.business_id,
          slot.startDate,
          slot.endDate,
          client,
          current.business_appointment_id,
        );
        const service = await resolveBusinessService(current, client);
        if (!service) throw businessServiceMissingError();
      } else {
        await checkHelperSlotFree(
          current.helper_id,
          slot.startDate,
          slot.endDate,
          client,
          current.appointment_id,
        );
      }

      const { rows } = await client.query(
        `UPDATE booking_requests
            SET status = 'accepted',
                accepted_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP,
                helper_response_reason = NULL,
                counter_status = CASE
                  WHEN counter_status = 'pending' THEN 'accepted'
                  ELSE counter_status
                END
          WHERE id = $1 AND status = ANY($2::text[])
          RETURNING *`,
        [current.id, PROVIDER_RESPOND_STATUSES],
      );
      if (!rows[0]) {
        const err = new Error('Booking is no longer pending');
        err.code = 'invalid_status';
        err.status = 409;
        throw err;
      }
      const updated = rows[0];
      let appointment = null;
      try {
        appointment = await confirmOrCreateAppointment(updated, updated.helper_id, {
          source: appointmentSource,
          db: client,
        });
      } catch (e) {
        // A race lost between pre-check and insert (or a service deactivated
        // in between) rolls the whole accept back. Other failures keep the
        // accept but skip the appointment, as before.
        if (ACCEPT_ROLLBACK_CODES.has(e.code)) throw e;
        logger.warn('[bookingLifecycle] appointment confirm/create failed', { error: e.message });
      }
      await logAudit(updated.id, 'accepted', actorId, actorType, oldStatus, 'accepted', client);
      // Mirror the DB link the confirm step wrote (business or helper side).
      const linked = appointment?.id
        ? {
            ...updated,
            appointment_id: updated.business_id ? updated.appointment_id : appointment.id,
            business_appointment_id: updated.business_id ? appointment.id : updated.business_appointment_id,
          }
        : updated;
      return { booking: linked, appointment };
    },
    'acceptBookingRequest',
  );
  } catch (e) {
    // The window lapsed between the pre-check and the re-read: the
    // transaction rolled back, so transition the row here (honoring the
    // customer's auto-post fallback) instead of leaving it pending.
    if (e.code === 'expired') {
      await expireIfStale(booking);
    }
    throw e;
  }

  await emitBookingEvent({ booking: outcome.booking, event: 'accepted', actorId });
  return outcome;
}

/**
 * Decline: pending | counter_proposed → declined; cancel linked appointment.
 */
async function declineBookingRequest({ booking, actorId, actorType = 'helper', reason = null }) {
  const gate = canProviderRespond(booking);
  if (!gate.ok) {
    const err = new Error(gate.reason || 'invalid_status');
    err.code = gate.reason || 'invalid_status';
    err.status = 409;
    throw err;
  }
  if (isStalePending(booking)) {
    await expireIfStale(booking);
    throw expiredError();
  }
  const oldStatus = booking.status;
  const note = reason ? String(reason).trim().slice(0, 500) : null;
  const { rows } = await pool.query(
    `UPDATE booking_requests
        SET status = 'declined',
            declined_at = CURRENT_TIMESTAMP,
            helper_response_reason = $2,
            updated_at = CURRENT_TIMESTAMP,
            counter_status = CASE
              WHEN counter_status = 'pending' THEN 'declined'
              ELSE counter_status
            END
      WHERE id = $1 AND status = ANY($3::text[])
      RETURNING *`,
    [booking.id, note, PROVIDER_RESPOND_STATUSES],
  );
  if (!rows[0]) {
    const err = new Error('Booking is no longer pending');
    err.code = 'invalid_status';
    err.status = 409;
    throw err;
  }
  const updated = rows[0];
  try {
    await cancelLinkedAppointment(updated, updated.helper_id);
  } catch (e) {
    logger.warn('[bookingLifecycle] appointment cancel failed', { error: e.message });
  }
  await logAudit(updated.id, 'declined', actorId, actorType, oldStatus, 'declined');
  await emitBookingEvent({ booking: updated, event: 'declined', actorId });
  return { booking: updated };
}

/**
 * Provider propose different time → counter_proposed (+ legacy counter_* sync).
 */
async function proposeBookingTime({ booking, actorId, actorType = 'helper', date, start, end, note = null }) {
  const gate = canProviderRespond(booking);
  if (!gate.ok) {
    const err = new Error(gate.reason || 'invalid_status');
    err.code = gate.reason || 'invalid_status';
    err.status = 409;
    throw err;
  }
  if (isStalePending(booking)) {
    await expireIfStale(booking);
    throw expiredError();
  }
  const d = normalizeDate(date);
  const s = normalizeClock(start);
  const e = normalizeClock(end);
  if (!d || !s || !e) {
    const err = new Error('requestedDate, start, and end are required');
    err.code = 'validation_failed';
    err.status = 400;
    throw err;
  }
  if (s >= e) {
    const err = new Error('End time must be after start time');
    err.code = 'validation_failed';
    err.status = 400;
    throw err;
  }
  // A counter-proposal is a concrete commitment: it must be in the future and
  // the proposed time must actually be free (schedule, blocks, appointments).
  const nowLocal = new Date();
  const todayStr = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(
    nowLocal.getDate(),
  ).padStart(2, '0')}`;
  if (d < todayStr) {
    const err = new Error('Cannot propose a time in the past');
    err.code = 'validation_failed';
    err.status = 400;
    throw err;
  }
  const slotCheck = await validateBookingSlot({
    helperId: booking.helper_id,
    businessId: booking.business_id,
    date: d,
    start: s,
    end: e,
  });
  if (!slotCheck.ok) {
    const err = new Error(slotCheck.message || 'Proposed time is not available');
    err.code = slotCheck.code || 'slot_conflict';
    err.status = 409;
    throw err;
  }
  const startSql = s.length === 5 ? `${s}:00` : s;
  const endSql = e.length === 5 ? `${e}:00` : e;
  const noteClean = note ? String(note).trim().slice(0, 500) : null;
  const oldStatus = booking.status;

  let updated;
  try {
    const { rows } = await pool.query(
      `UPDATE booking_requests
          SET requested_date = $2,
              requested_start_time = $3,
              requested_end_time = $4,
              status = 'counter_proposed',
              helper_response_reason = $5,
              counter_proposed_at = CURRENT_TIMESTAMP,
              counter_date = $2,
              counter_start_time = $3,
              counter_end_time = $4,
              counter_message = $5,
              counter_status = 'pending',
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = ANY($6::text[])
        RETURNING *`,
      [booking.id, d, startSql, endSql, noteClean, PROVIDER_RESPOND_STATUSES],
    );
    updated = rows[0];
  } catch (sqlErr) {
    // Older DBs without counter_proposed in CHECK — fall back to pending + counter_* only
    if (sqlErr.code === '23514') {
      const { rows } = await pool.query(
        `UPDATE booking_requests
            SET requested_date = $2,
                requested_start_time = $3,
                requested_end_time = $4,
                status = 'pending',
                helper_response_reason = $5,
                counter_proposed_at = CURRENT_TIMESTAMP,
                counter_date = $2,
                counter_start_time = $3,
                counter_end_time = $4,
                counter_message = $5,
                counter_status = 'pending',
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND status = 'pending'
          RETURNING *`,
        [booking.id, d, startSql, endSql, noteClean],
      );
      updated = rows[0];
    } else {
      throw sqlErr;
    }
  }
  if (!updated) {
    const err = new Error('Booking is no longer pending');
    err.code = 'invalid_status';
    err.status = 409;
    throw err;
  }

  try {
    await syncAppointmentTimes(updated, d, s, e);
  } catch (syncErr) {
    logger.warn('[bookingLifecycle] appointment time sync failed', { error: syncErr.message });
  }

  await logAudit(updated.id, 'counter_proposed', actorId, actorType, oldStatus, updated.status);
  await emitBookingEvent({ booking: updated, event: 'counter_proposed', actorId });
  return { booking: updated };
}

/**
 * Customer accepts provider-proposed time (status must be counter_proposed,
 * or legacy counter_status=pending). Same transactional conflict protection as
 * provider accept: advisory lock + pre-check before the status flip.
 */
async function customerAcceptBookingRequest({
  booking,
  actorId,
  actorType = 'customer',
  appointmentSource = 'booking_customer_accept',
}) {
  const isCanonical = toChatStatus(booking.status) === 'counter_proposed';
  const isLegacy = booking.counter_status === 'pending' && toChatStatus(booking.status) === 'pending';
  if (!isCanonical && !isLegacy) {
    const gate = canCustomerRespond(booking);
    const err = new Error(gate.reason || 'invalid_status');
    err.code = gate.reason || 'invalid_status';
    err.status = 409;
    throw err;
  }

  const oldStatus = booking.status;

  let outcome;
  try {
    outcome = await withTransaction(
      pool,
      async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [advisoryLockKey(booking)]);

      let working = booking;
      // Legacy: apply counter_* into requested_* first
      if (isLegacy && booking.counter_date) {
        const { rows: migrated } = await client.query(
          `UPDATE booking_requests
              SET requested_date = counter_date,
                  requested_start_time = counter_start_time,
                  requested_end_time = counter_end_time,
                  status = 'counter_proposed',
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND counter_status = 'pending'
            RETURNING *`,
          [booking.id],
        );
        working = migrated[0] || booking;
      }

      // Re-check staleness inside the lock: the window may have lapsed while
      // the counter-proposal sat unanswered.
      if (isStalePending(working)) {
        throw expiredError();
      }

      // The customer accepts a concrete proposed time; without one there is
      // nothing to accept.
      const slot = parseBookingSlot(working);
      if (!slot) {
        throw slotConflictError(
          'time_required',
          'No proposed time is available to accept.',
        );
      }
      if (working.business_id) {
        await checkBusinessSlotFree(
          working.business_id,
          slot.startDate,
          slot.endDate,
          client,
          working.business_appointment_id,
        );
        const service = await resolveBusinessService(working, client);
        if (!service) throw businessServiceMissingError();
      } else {
        await checkHelperSlotFree(
          working.helper_id,
          slot.startDate,
          slot.endDate,
          client,
          working.appointment_id,
        );
      }

      const { rows } = await client.query(
        `UPDATE booking_requests
            SET status = 'accepted',
                accepted_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP,
                counter_status = 'accepted'
          WHERE id = $1 AND status = 'counter_proposed'
          RETURNING *`,
        [working.id],
      );
      if (!rows[0]) {
        const err = new Error('Booking is no longer counter-proposed');
        err.code = 'invalid_status';
        err.status = 409;
        throw err;
      }
      const updated = rows[0];
      let appointment = null;
      try {
        appointment = await confirmOrCreateAppointment(updated, updated.helper_id, {
          source: appointmentSource,
          db: client,
        });
      } catch (e) {
        if (ACCEPT_ROLLBACK_CODES.has(e.code)) throw e;
        logger.warn('[bookingLifecycle] customer-accept appointment failed', { error: e.message });
      }
      await logAudit(updated.id, 'accepted', actorId, actorType, oldStatus, 'accepted', client);
      const linked = appointment?.id
        ? {
            ...updated,
            appointment_id: updated.business_id ? updated.appointment_id : appointment.id,
            business_appointment_id: updated.business_id ? appointment.id : updated.business_appointment_id,
          }
        : updated;
      return { booking: linked, appointment };
    },
    'customerAcceptBookingRequest',
  );
  } catch (e) {
    // Same stale-window race as provider accept: transition the row after
    // rollback instead of leaving it pending.
    if (e.code === 'expired') {
      await expireIfStale(booking);
    }
    throw e;
  }

  await emitBookingEvent({ booking: outcome.booking, event: 'accepted', actorId });
  return outcome;
}

async function customerDeclineBookingRequest({ booking, actorId, actorType = 'customer', reason = null }) {
  const isCanonical = toChatStatus(booking.status) === 'counter_proposed';
  const isLegacy = booking.counter_status === 'pending' && toChatStatus(booking.status) === 'pending';
  if (!isCanonical && !isLegacy) {
    const gate = canCustomerRespond(booking);
    const err = new Error(gate.reason || 'invalid_status');
    err.code = gate.reason || 'invalid_status';
    err.status = 409;
    throw err;
  }
  const oldStatus = booking.status;
  const note = reason ? String(reason).trim().slice(0, 500) : null;
  const { rows } = await pool.query(
    `UPDATE booking_requests
        SET status = 'declined',
            declined_at = CURRENT_TIMESTAMP,
            helper_response_reason = COALESCE($2, helper_response_reason),
            updated_at = CURRENT_TIMESTAMP,
            counter_status = 'declined'
      WHERE id = $1 AND (status = 'counter_proposed' OR counter_status = 'pending')
      RETURNING *`,
    [booking.id, note],
  );
  if (!rows[0]) {
    const err = new Error('Booking is no longer counter-proposed');
    err.code = 'invalid_status';
    err.status = 409;
    throw err;
  }
  const updated = rows[0];
  try {
    await cancelLinkedAppointment(updated, updated.helper_id);
  } catch (e) {
    logger.warn('[bookingLifecycle] customer-decline appointment cancel failed', { error: e.message });
  }
  await logAudit(updated.id, 'declined', actorId, actorType, oldStatus, 'declined');
  await emitBookingEvent({ booking: updated, event: 'declined', actorId });
  return { booking: updated };
}

module.exports = {
  INBOX_STATUSES,
  PROVIDER_RESPOND_STATUSES,
  loadBooking,
  expireIfStale,
  autoPostExpiredBooking,
  isProviderForBooking,
  resolveProviderBusinessIds,
  listIncomingForProvider,
  toCalendarBooking,
  parseBookingSlot,
  validateBookingSlot,
  confirmOrCreateAppointment,
  cancelLinkedAppointment,
  syncAppointmentTimes,
  emitBookingEvent,
  listBusinessMemberUserIds,
  acceptBookingRequest,
  declineBookingRequest,
  proposeBookingTime,
  customerAcceptBookingRequest,
  customerDeclineBookingRequest,
  logAudit,
  formatTimePart,
  buildStatusMessage,
  canProviderRespond,
  canCustomerRespond,
  toPublicBookingRequestCard,
  toChatStatus,
  normalizeClock,
  normalizeDate,
};
