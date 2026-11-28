const db = require('../db');
const { isScheduledSessionPaid } = require('../services/consultingPaymentService');
const { sendEmailOrThrow } = require('../utils/email');
const { renderOxSteedEmail } = require('../utils/emailTemplate');
const { sendNotification } = require('../services/notificationService');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const { consultantEnforcement } = require('../services/access/flags');
const { checkPayingAccess, bookingDenial } = require('../services/access/consultantGate');
// Group 10 item 517: canonical zone is the consultant's profile timezone;
// slots are generated in that zone and converted to the client's zone for
// display only. Booking still posts the canonical date/time.
const {
  isValidIanaZone,
  convertWallClock,
  sessionStartInstant,
  getConsultantTimezone,
} = require('../utils/consultingTimezone');

async function publicConsultantExists(consultantId) {
  const enforce = consultantEnforcement() === 'enforce';
  const { rows } = await db.query(
    `SELECT u.id
       FROM users u
      WHERE u.id = $1
        ${enforce ? '' : "AND u.default_mode = 'consultant'"}
        AND u.deleted_at IS NULL
        AND u.is_active = TRUE
        AND u.email_verified = TRUE
        AND u.onboarding_completed = TRUE`,
    [consultantId]
  );
  return rows.length > 0 && (!enforce || (await checkPayingAccess(consultantId)).allowed);
}

function canManageConsultant(req, consultantId) {
  if (!req?.user) return false;
  const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
  return isAdmin || String(req.user.id) === String(consultantId);
}

// Get consultant's recurring availability (day of week schedule)
exports.getConsultantAvailability = async (req, res) => {
  try {
    const { consultantId } = req.params;

    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!canManageConsultant(req, consultantId)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { rows } = await db.query(
      `SELECT id, day_of_week, start_time, end_time, is_active
       FROM consultant_availability
       WHERE consultant_id = $1
       ORDER BY day_of_week, start_time`,
      [consultantId]
    );

    res.json(rows);
  } catch (err) {
    logger.error('Failed to get consultant availability', { error: err.message, consultantId: req.params.consultantId });
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
};

// Set consultant's recurring availability for a day of week
exports.setAvailability = async (req, res) => {
  try {
    const { consultantId } = req.params;
    const { dayOfWeek, startTime, endTime, isActive } = req.body;

    // Validate
    if (typeof dayOfWeek !== 'number' || dayOfWeek < 0 || dayOfWeek > 6) {
      return res.status(400).json({ error: 'Invalid day of week (0-6)' });
    }
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'Start and end times required' });
    }

    // Check if this consultant can be managed by requester
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    // users.id is a UUID - compare as strings, not via parseInt.
    if (req.user.id !== consultantId && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Upsert availability
    const { rows } = await db.query(
      `INSERT INTO consultant_availability (consultant_id, day_of_week, start_time, end_time, is_active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (consultant_id, day_of_week)
       DO UPDATE SET start_time = $3, end_time = $4, is_active = $5, updated_at = NOW()
       RETURNING *`,
      [consultantId, dayOfWeek, startTime, endTime, isActive !== false]
    );

    res.json(rows[0]);
  } catch (err) {
    logger.error('Failed to set availability', { error: err.message, consultantId: req.params.consultantId });
    res.status(500).json({ error: 'Failed to update availability' });
  }
};

// Get blocked dates
exports.getBlockedDates = async (req, res) => {
  try {
    const { consultantId } = req.params;

    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!canManageConsultant(req, consultantId)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { startDate, endDate } = req.query;

    let query = `SELECT id, blocked_date, reason
                 FROM consultant_blocked_dates
                 WHERE consultant_id = $1`;
    const params = [consultantId];

    if (startDate && endDate) {
      query += ` AND blocked_date BETWEEN $2 AND $3`;
      params.push(startDate, endDate);
    }

    query += ` ORDER BY blocked_date`;

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    logger.error('Failed to get blocked dates', { error: err.message, consultantId: req.params.consultantId });
    res.status(500).json({ error: 'Failed to fetch blocked dates' });
  }
};

// Add blocked date (holiday, day off)
exports.addBlockedDate = async (req, res) => {
  try {
    const { consultantId } = req.params;
    const { blockedDate, reason } = req.body;

    if (!blockedDate) {
      return res.status(400).json({ error: 'Blocked date required' });
    }

    // Authorization check
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    // users.id is a UUID - compare as strings, not via parseInt.
    if (req.user.id !== consultantId && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { rows } = await db.query(
      `INSERT INTO consultant_blocked_dates (consultant_id, blocked_date, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (consultant_id, blocked_date)
       DO UPDATE SET reason = $3, updated_at = NOW()
       RETURNING *`,
      [consultantId, blockedDate, reason || null]
    );

    res.json(rows[0]);
  } catch (err) {
    logger.error('Failed to add blocked date', { error: err.message, consultantId: req.params.consultantId });
    res.status(500).json({ error: 'Failed to add blocked date' });
  }
};

// Remove blocked date
exports.removeBlockedDate = async (req, res) => {
  try {
    const { consultantId, dateId } = req.params;

    // Get the blocked date first to verify ownership
    const { rows: blockedRows } = await db.query(
      `SELECT * FROM consultant_blocked_dates WHERE id = $1 AND consultant_id = $2`,
      [dateId, consultantId]
    );

    if (blockedRows.length === 0) {
      return res.status(404).json({ error: 'Blocked date not found' });
    }

    // Authorization check
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    // users.id is a UUID - compare as strings, not via parseInt.
    if (req.user.id !== consultantId && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await db.query(
      `DELETE FROM consultant_blocked_dates WHERE id = $1`,
      [dateId]
    );

    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to remove blocked date', { error: err.message });
    res.status(500).json({ error: 'Failed to remove blocked date' });
  }
};

// Get available time slots for a consultant on a specific date.
// Group 10 item 517: ?timezone=<IANA zone> converts the canonical slots
// to the client's zone for display. The response then carries both the
// canonical values (what booking posts) and the converted values, plus
// the canonical zone. Without the parameter the legacy bare array is
// returned, so the public profile page keeps working unchanged. An
// unknown zone is a 400.
exports.getAvailableSlots = async (req, res) => {
  try {
    const { consultantId } = req.params;
    const { date, durationMinutes = 60, timezone: clientTimezone } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Date parameter required (YYYY-MM-DD)' });
    }

    if (clientTimezone !== undefined && !isValidIanaZone(clientTimezone)) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }

    if (!(await publicConsultantExists(consultantId))) {
      return res.status(404).json({ error: 'Consultant not found' });
    }

    const { rows } = await db.query(
      `SELECT slot_start, slot_end, is_available
       FROM get_consultant_available_slots($1, $2, $3)`,
      [consultantId, date, parseInt(durationMinutes)]
    );

    // Filter out slots that are already booked
    const availableSlots = [];
    for (const slot of rows) {
      const isBooked = await db.query(
        `SELECT 1 FROM consulting_sessions_scheduled
         WHERE consultant_assigned_id = $1
           AND scheduled_date = $2
           AND scheduled_time < $4::time
           AND scheduled_time + make_interval(mins => COALESCE(duration_minutes, 120)) > $3::time
           AND status IN ('confirmed', 'completed')`,
        [consultantId, date, slot.slot_start, slot.slot_end]
      );

      if (isBooked.rows.length === 0) {
        availableSlots.push(slot);
      }
    }

    if (clientTimezone === undefined) return res.json(availableSlots);

    const canonicalZone = await getConsultantTimezone(db, consultantId);
    res.json({
      timezone: canonicalZone,
      client_timezone: clientTimezone,
      date,
      slots: availableSlots.map((slot) => {
        const start = convertWallClock(date, slot.slot_start, canonicalZone, clientTimezone);
        const end = convertWallClock(date, slot.slot_end, canonicalZone, clientTimezone);
        return {
          slot_start: slot.slot_start,
          slot_end: slot.slot_end,
          is_available: slot.is_available,
          client_slot_start: start.time,
          client_slot_end: end.time,
          client_date: start.date,
        };
      }),
    });
  } catch (err) {
    logger.error('Failed to get available slots', { error: err.message, consultantId: req.params.consultantId });
    res.status(500).json({ error: 'Failed to fetch available slots' });
  }
};

// Create the scheduled row a consulting session needs before it can be paid
// for and booked. This is the one client-creatable row in the chain:
//   intake/purchase -> POST /scheduling/sessions (this handler)
//     -> POST /consulting/payment-intent -> Stripe confirm
//     -> POST /consulting/confirm-payment -> widget -> book-slot -> confirmed
//
// The scheduled row's date/time columns are NOT NULL (migration 103), so a
// row that only exists to unblock payment cannot carry NULLs. It carries the
// sentinel 1970-01-01 / 00:00 with status 'pending_confirmation' instead.
// The sentinel is never a real appointment: it is excluded from availability
// checks (those only look at 'confirmed'/'completed' rows), the portal hides
// it behind the pending_confirmation status, and book-slot overwrites it with
// the real date/time when the slot is confirmed. A preferredDate, when sent,
// is validated for shape only and is NOT stored: the booked slot is the one
// chosen later in the widget.
exports.createScheduledSession = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const consultingSessionId = Number(req.body?.consultingSessionId ?? req.body?.sessionId);
    const consultantId = req.body?.consultantId || null;
    const preferredDate = req.body?.preferredDate || null;

    if (!Number.isInteger(consultingSessionId) || consultingSessionId <= 0) {
      return res.status(400).json({ error: 'consultingSessionId required' });
    }

    const { rows: sessionRows } = await db.query(
      `SELECT id, user_id, consultant_assigned_id
       FROM consulting_sessions WHERE id = $1`,
      [consultingSessionId]
    );

    if (sessionRows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionRows[0];

    // Same owner check as bookTimeSlot / createPaymentIntent: only the
    // session owner (or an admin) may create the row that unblocks payment.
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    if (!isAdmin && session.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized for this session' });
    }

    if (consultantId) {
      // A non-admin owner books only the consultant already assigned to the
      // session; an admin may (re)assign by passing a different consultant.
      if (!isAdmin && session.consultant_assigned_id && session.consultant_assigned_id !== consultantId) {
        return res.status(409).json({ error: 'Consultant does not match the assigned consultant' });
      }
      const { rows: consultantRows } = await db.query(
        `SELECT id FROM users
          WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
        [consultantId]
      );
      if (consultantRows.length === 0) {
        return res.status(404).json({ error: 'Consultant not found' });
      }
    }

    if (preferredDate != null) {
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(preferredDate) ? new Date(`${preferredDate}T00:00:00Z`) : null;
      if (!parsed || Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'preferredDate must be a valid date (YYYY-MM-DD)' });
      }
    }

    // Idempotent: the scheduled table has a UNIQUE(session_id), and a
    // retried or refreshed "Schedule session" click must return the row
    // instead of failing on the unique constraint.
    const selectScheduled = `SELECT id, session_id, scheduled_date, scheduled_time, duration_minutes,
              consultant_assigned_id, meeting_link, timezone, status
       FROM consulting_sessions_scheduled WHERE session_id = $1`;
    const { rows: existingRows } = await db.query(selectScheduled, [consultingSessionId]);
    if (existingRows.length > 0) {
      return res.json({ ...existingRows[0], alreadyScheduled: true });
    }

    const assignedConsultant = consultantId || session.consultant_assigned_id || null;
    if (!isAdmin && assignedConsultant && consultantEnforcement() === 'enforce') {
      const decision = await checkPayingAccess(assignedConsultant);
      if (!decision.allowed) return res.status(409).json(bookingDenial(decision));
    }

    const { rows } = await db.query(
      `INSERT INTO consulting_sessions_scheduled
         (session_id, scheduled_date, scheduled_time, duration_minutes, consultant_assigned_id, status)
       VALUES ($1, '1970-01-01', '00:00', 120, $2, 'pending_confirmation')
       ON CONFLICT (session_id) DO NOTHING
       RETURNING id, session_id, scheduled_date, scheduled_time, duration_minutes,
                 consultant_assigned_id, meeting_link, timezone, status`,
      [consultingSessionId, assignedConsultant]
    );
    if (!rows.length) {
      const { rows: [scheduled] } = await db.query(selectScheduled, [consultingSessionId]);
      if (!scheduled) return res.status(409).json({ error: 'Session changed. Please retry.' });
      return res.json({ ...scheduled, alreadyScheduled: true });
    }

    // Notifications audit item 53: the assigned consultant was never told
    // a session was scheduled. Notify through the shared sendNotification
    // path (in-app row + email leg via emailTypes) once the row is
    // durable; a notify failure is logged and never fails the 201. The
    // already-scheduled early return above does not notify, so a retried
    // click cannot double-notify.
    const scheduled = rows[0];
    if (scheduled?.consultant_assigned_id) {
      try {
        const result = await sendNotification({
          userId: scheduled.consultant_assigned_id,
          type: 'consulting_session_scheduled',
          data: {
            session_id: consultingSessionId,
            scheduled_session_id: scheduled.id,
            consultant_id: scheduled.consultant_assigned_id,
          },
          action_url: '/consulting/contractor-dashboard',
          idempotencyKey: `consulting-session-scheduled:${consultingSessionId}`,
        });
        // Notifications audit N6: sendNotification never throws on a
        // delivery failure; it returns { success: false }. Check the
        // result like creditCashoutService.notifySettlement does and
        // record an incident so a stuck provider is visible to an
        // operator instead of silently dropping the consultant notice.
        if (result && result.success !== true) {
          logger.warn('Failed to notify consultant of scheduled session', { error: result.error || 'send_failed', sessionId: consultingSessionId });
          try {
            await require('../services/incidentStore').recordIncident({
              type: 'consulting_session_scheduled_notice_failed',
              severity: 'medium',
              message: `Consultant notice failed for scheduled session ${consultingSessionId}`,
              dedupeKey: `consulting-session-notify:${consultingSessionId}`,
              details: { sessionId: consultingSessionId, consultantId: scheduled.consultant_assigned_id, error: result.error || 'send_failed' },
            });
          } catch (incidentError) {
            logger.warn('Failed to record consultant notice incident', { error: incidentError.message, sessionId: consultingSessionId });
          }
        }
      } catch (err) {
        logger.warn('Failed to notify consultant of scheduled session', { error: err.message, sessionId: consultingSessionId });
      }
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('Failed to create scheduled session', { error: err.message });
    res.status(500).json({ error: 'Failed to create scheduled session' });
  }
};

// Book a time slot for a consulting session
exports.bookTimeSlot = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { consultantId, date, startTime, meetingLink, timezone } = req.body;
    const durationMinutes = parseInt(req.body.durationMinutes, 10) || 120;
    // Group 10 item 507: the client scheduling UI picks the engagement
    // format; it is stored on the scheduled row (meeting_type CHECK in
    // migration 103). Defaults to zoom; an unknown value is a 400, never a
    // silent fallback, so the booked format is always the chosen one.
    const meetingType = req.body.meetingType || req.body.meeting_type || 'zoom';
    const MEETING_TYPES = ['zoom', 'google_meet', 'phone', 'in_person'];
    if (!MEETING_TYPES.includes(meetingType)) {
      return res.status(400).json({ error: 'Invalid meeting format' });
    }

    if (!date || !startTime || !consultantId) {
      return res.status(400).json({ error: 'consultantId, date, and start time required' });
    }

    // Validate duration
    if (durationMinutes <= 0 || durationMinutes > 480) {
      return res.status(400).json({ error: 'Duration must be between 1 and 480 minutes' });
    }

    // Validate date is not in the past and not too far in the future
    const bookingDate = new Date(`${date}T${startTime}`);
    if (Number.isNaN(bookingDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date or time format' });
    }
    const now = new Date();
    const maxFuture = new Date(now.getTime() + 6 * 30 * 24 * 60 * 60 * 1000); // ~6 months
    if (bookingDate < now) {
      return res.status(400).json({ error: 'Cannot book sessions in the past' });
    }
    if (bookingDate > maxFuture) {
      return res.status(400).json({ error: 'Cannot book more than 6 months in advance' });
    }

    // Resolve session + owner via JOIN - consulting_sessions_scheduled does not have customer_id
    const { rows: sessions } = await db.query(
      `SELECT css.id, css.session_id, css.consultant_assigned_id,
              cs.user_id, cs.email, cs.first_name
       FROM consulting_sessions_scheduled css
       JOIN consulting_sessions cs ON css.session_id = cs.id
       WHERE css.id = $1`,
      [sessionId]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessions[0];

    // Authorization: only the session owner or an admin can book on its behalf.
    const isAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'super_admin');
    if (!isAdmin && (!req.user || session.user_id !== req.user.id)) {
      return res.status(403).json({ error: 'Not authorized for this session' });
    }

    // The consultant is selected when the pending scheduled row is created.
    // Do not let a customer replace that assignment at the final booking
    // step: availability and payment are both scoped to the assigned
    // consultant, so accepting a different client-supplied id would move the
    // appointment across accounts without re-running the intake contract.
    if (!isAdmin && session.consultant_assigned_id
      && String(session.consultant_assigned_id) !== String(consultantId)) {
      return res.status(409).json({ error: 'Consultant does not match the assigned consultant' });
    }

    // Do not pin paid bookings to an inactive or soft-deleted consultant.
    // Availability rows can outlive the user lifecycle, so checking the
    // consultant identity here keeps the scheduling and account systems in
    // sync at the final write boundary.
    const { rows: activeConsultantRows } = await db.query(
      `SELECT id FROM users
       WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
      [consultantId]
    );
    if (activeConsultantRows.length === 0) {
      return res.status(404).json({ error: 'Consultant not found' });
    }

    // Platform-approval gate: an unapproved consultant cannot have a paid
    // booking pinned to their calendar. We check the *consultant* (not the
    // caller) — they're the one who needs OxSteed sign-off. Admins bypass.
    if (!isAdmin) {
      const consultantCheck = await checkPayingAccess(consultantId);
      if (!consultantCheck.allowed) {
        return res.status(409).json(bookingDenial(consultantCheck));
      }
    }

    // Review P3-1069: every consulting package is paid; the slot is only
    // booked once the session has a completed payment (Stripe or an
    // admin-recorded off-platform payment). Admins may book on credit.
    if (!isAdmin && !(await isScheduledSessionPaid(session.id))) {
      return res.status(402).json({
        error: 'payment_required',
        message: 'Pay for this consulting session before booking a time slot.',
      });
    }

    // Calculate end time
    const startTimeObj = new Date(`2000-01-01T${startTime}`);
    const endTimeObj = new Date(startTimeObj.getTime() + durationMinutes * 60000);
    const endTime = endTimeObj.toTimeString().slice(0, 5);

    // Verify slot is on consultant's availability
    const { rows: availableSlots } = await db.query(
      `SELECT 1 FROM get_consultant_available_slots($1, $2, $3)
       WHERE slot_start = $4`,
      [consultantId, date, durationMinutes, startTime]
    );

    if (availableSlots.length === 0) {
      return res.status(409).json({ error: 'Selected time slot is not available' });
    }

    // Under enforcement, serialize competing bookings before checking for overlaps.
    // Note: status valid values per migration 103 CHECK: pending_confirmation, confirmed, completed, no_show, cancelled.
    const enforce = consultantEnforcement() === 'enforce';
    const writeBooking = (client) => client.query(
      `UPDATE consulting_sessions_scheduled css_target
       SET scheduled_date = $1,
           scheduled_time = $2,
           duration_minutes = $3,
           meeting_link = $4,
           timezone = $5,
           consultant_assigned_id = $6,
           meeting_type = $10,
           status = 'confirmed',
           updated_at = NOW()
       WHERE css_target.id = $7
         ${enforce ? "AND css_target.status = 'pending_confirmation' AND ($11::boolean OR css_target.consultant_assigned_id IS NULL OR css_target.consultant_assigned_id = $6)" : ''}
         AND NOT EXISTS (
           SELECT 1 FROM consulting_sessions_scheduled other
           WHERE other.consultant_assigned_id = $6
             AND other.scheduled_date = $1
             AND other.scheduled_time < $9
           AND other.scheduled_time + make_interval(mins => COALESCE(other.duration_minutes, 120)) > $8
             AND other.status IN ('confirmed', 'completed')
             AND other.id <> $7
         )
       RETURNING *`,
      [date, startTime, durationMinutes, meetingLink || null,
       timezone || 'America/New_York', consultantId, sessionId,
       startTime, endTime, meetingType, ...(enforce ? [isAdmin] : [])]
    );
    let outcome;
    if (enforce) {
      outcome = await withTransaction(db, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [
          `consulting-booking:${consultantId}:${date}`,
        ]);
        if (!isAdmin) {
          const decision = await checkPayingAccess(consultantId, { client, lockGrant: true });
          if (!decision.allowed) return { denial: bookingDenial(decision) };
        }
        return writeBooking(client);
      }, 'confirm_consulting_booking');
    } else {
      outcome = await writeBooking(db);
    }
    if (outcome.denial) return res.status(409).json(outcome.denial);
    const updated = outcome.rows;

    if (updated.length === 0) {
      return res.status(409).json({ error: 'Time slot conflicts with another session' });
    }

    // Respond first, then send email asynchronously (do not block the response).
    res.json(updated[0]);

    setImmediate(async () => {
      try {
        const consultant = await db.query(
          `SELECT first_name, last_name, email FROM users
           WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
          [consultantId]
        );

        const formattedDate = new Date(`${date}T${startTime}`).toLocaleString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
          timeZone: timezone || 'America/New_York',
        });

        const consultantName = consultant.rows[0]
          ? `${consultant.rows[0].first_name} ${consultant.rows[0].last_name}`
          : 'Your Consultant';

        // Review P3-852: route through the branded template so the email
        // carries both the branded HTML and a text part.
        const rendered = renderOxSteedEmail({
          language: 'en',
          preheader: 'Your consulting session is confirmed',
          eyebrow: 'OXSTEED CONSULTING',
          title: 'Your session is confirmed',
          intro: `Hi ${session.first_name || 'there'}, your consulting session has been scheduled! We look forward to helping you grow your business.`,
          details: [
            { label: 'Consultant', value: consultantName },
            { label: 'Date and time', value: formattedDate },
            { label: 'Duration', value: `${durationMinutes} minutes` },
          ],
          ...(meetingLink ? { cta: { url: meetingLink, label: 'Join meeting' } } : {}),
          footerText: 'The OxSteed Consulting Team',
        });
        await sendEmailOrThrow({
          to: session.email,
          subject: 'Your Consulting Session is Confirmed',
          html: rendered.html,
          text: rendered.text,
        });

        // Notifications audit item 53(b)(c): the consultant was never
        // told the slot was booked — the customer email above was the
        // only notice, and the earlier consulting_session_scheduled
        // notice carries the 1970-01-01 sentinel date because it fires
        // when the row is created, before any slot exists. Tell the
        // consultant the real slot now that it exists, by email and
        // in-app. Each leg is independent: a consultant-email failure
        // must not skip the in-app notice, and vice versa. The in-app
        // notice uses its own key so it never dedupes against the
        // row-creation notice.
        const consultantRow = consultant.rows[0];
        if (consultantRow?.email) {
          try {
            const clientName = session.first_name || 'Your client';
            const consultantRendered = renderOxSteedEmail({
              language: 'en',
              preheader: 'A consulting session was booked',
              eyebrow: 'OXSTEED CONSULTING',
              title: 'A session was booked',
              intro: `Hi ${consultantRow.first_name || 'there'}, ${clientName} booked a consulting session with you.`,
              details: [
                { label: 'Client', value: clientName },
                { label: 'Date and time', value: formattedDate },
                { label: 'Duration', value: `${durationMinutes} minutes` },
              ],
              ...(meetingLink ? { cta: { url: meetingLink, label: 'Join meeting' } } : {}),
              footerText: 'The OxSteed Consulting Team',
            });
            await sendEmailOrThrow({
              to: consultantRow.email,
              subject: 'A Consulting Session Was Booked',
              html: consultantRendered.html,
              text: consultantRendered.text,
            });
          } catch (consultantEmailErr) {
            logger.warn('Failed to send consultant booking email', { error: consultantEmailErr.message, sessionId });
          }
        }
        try {
          const noticeResult = await sendNotification({
            userId: consultantId,
            type: 'consulting_session_scheduled',
            body: `Session booked for ${formattedDate}.`,
            data: {
              session_id: session.session_id,
              scheduled_session_id: sessionId,
              consultant_id: consultantId,
              scheduled_date: date,
              scheduled_time: startTime,
            },
            action_url: '/consulting/contractor-dashboard',
            idempotencyKey: `consulting-session-booked:${sessionId}`,
          });
          if (noticeResult && noticeResult.success !== true) {
            logger.warn('Failed to notify consultant of booked session', { error: noticeResult.error || 'send_failed', sessionId });
            try {
              await require('../services/incidentStore').recordIncident({
                type: 'consulting_session_booked_notice_failed',
                severity: 'medium',
                message: `Consultant booked-session notice failed for scheduled session ${sessionId}`,
                dedupeKey: `consulting-session-booked-notify:${sessionId}`,
                details: { sessionId, consultantId, error: noticeResult.error || 'send_failed' },
              });
            } catch (incidentError) {
              logger.warn('Failed to record consultant booked notice incident', { error: incidentError.message, sessionId });
            }
          }
        } catch (noticeErr) {
          logger.warn('Failed to notify consultant of booked session', { error: noticeErr.message, sessionId });
        }
      } catch (emailErr) {
        logger.warn('Failed to send session confirmation email', { error: emailErr.message, sessionId });
      }
    });
    return;
  } catch (err) {
    logger.error('Failed to book time slot', { error: err.message });
    res.status(500).json({ error: 'Failed to book time slot' });
  }
};

// Get next available date/slots for a consultant
// Group 10 item 517: ?timezone=<IANA zone> converts the slot times to the
// client's zone for display. With the parameter the response is an object
// carrying the canonical zone plus per-slot converted times; without it
// the legacy bare array is returned.
exports.getNextAvailableDates = async (req, res) => {
  try {
    const { consultantId } = req.params;
    const { fromDate, daysAhead = 30, durationMinutes = 60, timezone: clientTimezone } = req.query;

    if (clientTimezone !== undefined && !isValidIanaZone(clientTimezone)) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }

    if (!(await publicConsultantExists(consultantId))) {
      return res.status(404).json({ error: 'Consultant not found' });
    }

    const canonicalZone = clientTimezone !== undefined
      ? await getConsultantTimezone(db, consultantId)
      : null;
    const startDate = fromDate ? new Date(fromDate) : new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + parseInt(daysAhead));

    const availableDates = [];

    // Check next N days for availability
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];

      const { rows: slots } = await db.query(
        `SELECT slot_start, slot_end FROM get_consultant_available_slots($1, $2, $3)`,
        [consultantId, dateStr, durationMinutes]
      );

      if (slots.length > 0) {
        // Filter already booked slots
        const availableSlots = [];
        for (const slot of slots) {
          const { rows: booked } = await db.query(
            `SELECT 1 FROM consulting_sessions_scheduled
             WHERE consultant_assigned_id = $1
               AND scheduled_date = $2
               AND scheduled_time < $4::time
               AND scheduled_time + make_interval(mins => COALESCE(duration_minutes, 120)) > $3::time
               AND status IN ('confirmed', 'completed')`,
            [consultantId, dateStr, slot.slot_start, slot.slot_end]
          );

          if (booked.length === 0) {
            availableSlots.push(
              clientTimezone === undefined
                ? slot.slot_start
                : {
                  slot_start: slot.slot_start,
                  ...(() => {
                    const converted = convertWallClock(dateStr, slot.slot_start, canonicalZone, clientTimezone);
                    return { client_slot_start: converted.time, client_date: converted.date };
                  })(),
                },
            );
          }
        }

        if (availableSlots.length > 0) {
          availableDates.push({
            date: dateStr,
            dayOfWeek: d.toLocaleDateString('en-US', { weekday: 'long' }),
            availableSlots: availableSlots.slice(0, 3) // Return first 3 slots
          });
        }
      }

      if (availableDates.length >= 5) break; // Return first 5 available dates
    }

    if (clientTimezone === undefined) return res.json(availableDates);
    return res.json({
      timezone: canonicalZone,
      client_timezone: clientTimezone,
      dates: availableDates,
    });
  } catch (err) {
    logger.error('Failed to get next available dates', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch available dates' });
  }
};

// ──────────────────────────────────────────────────────────────────────────
// Group 10 Slice C (items 518-520): reschedule proposals, cancellation,
// attendance. A scheduled row is the appointment; the consulting session
// row carries the canonical engagement status. Both rows move together
// on cancel; a reschedule moves the scheduled row only (the engagement
// itself is unchanged and already paid).
// ──────────────────────────────────────────────────────────────────────────

const SCHEDULED_ROW_SELECT = `SELECT css.*, cs.user_id AS client_id,
  cs.consultant_assigned_id, cs.status AS session_status
  FROM consulting_sessions_scheduled css
  JOIN consulting_sessions cs ON cs.id = css.session_id
  WHERE css.id = $1`;

async function loadScheduledSession(scheduledId) {
  const { rows } = await db.query(SCHEDULED_ROW_SELECT, [scheduledId]);
  return rows[0] || null;
}

// Which party the caller is for this appointment: 'client' (the session
// owner), 'consultant' (the assigned consultant), 'admin', or null when
// the caller is none of them.
function sessionParty(req, row) {
  if (!req?.user || !row) return null;
  if (req.user.role === 'admin' || req.user.role === 'super_admin') return 'admin';
  if (String(req.user.id) === String(row.client_id)) return 'client';
  if (row.consultant_assigned_id && String(req.user.id) === String(row.consultant_assigned_id)) return 'consultant';
  return null;
}

function isDateStr(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
}

function isTimeStr(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

function endTimeOf(startTime, durationMinutes) {
  const start = new Date(`2000-01-01T${startTime}`);
  return new Date(start.getTime() + durationMinutes * 60000).toTimeString().slice(0, 5);
}

// A notification is best-effort: a delivery failure is logged and never
// fails the scheduling write that already happened.
async function notifySessionParty({ userId, type, data, actionUrl, idempotencyKey }) {
  if (!userId) return;
  try {
    const result = await sendNotification({
      userId,
      type,
      data,
      action_url: actionUrl,
      idempotencyKey,
    });
    if (result && result.success !== true) {
      logger.warn('Failed to notify consulting session party', { type, userId, error: result.error || 'send_failed' });
    }
  } catch (err) {
    logger.warn('Failed to notify consulting session party', { type, userId, error: err.message });
  }
}

function clientActionUrl() {
  return '/consulting/portal';
}

function consultantActionUrl() {
  return '/consulting/contractor-dashboard';
}

// The counterparty of a proposal: who has to answer it. An admin proposal
// goes to both parties; otherwise it goes to the other side.
function proposalCounterparties(proposal, row) {
  if (proposal.proposed_by_role === 'client') return [{ userId: row.consultant_assigned_id, url: consultantActionUrl() }];
  if (proposal.proposed_by_role === 'consultant') return [{ userId: row.client_id, url: clientActionUrl() }];
  return [
    { userId: row.client_id, url: clientActionUrl() },
    { userId: row.consultant_assigned_id, url: consultantActionUrl() },
  ];
}

// The proposed slot must sit on the consultant's availability and must not
// overlap another confirmed/completed appointment. `query` is db or a
// transaction client; `excludeScheduledId` is the appointment being moved.
async function assertSlotFree(query, { consultantId, date, startTime, durationMinutes, excludeScheduledId }) {
  const { rows: available } = await query.query(
    `SELECT 1 FROM get_consultant_available_slots($1, $2, $3) WHERE slot_start = $4`,
    [consultantId, date, durationMinutes, startTime],
  );
  if (available.length === 0) {
    return { ok: false, status: 409, body: { error: 'Selected time slot is not available' } };
  }
  const endTime = endTimeOf(startTime, durationMinutes);
  const { rows: overlapping } = await query.query(
    `SELECT 1 FROM consulting_sessions_scheduled other
      WHERE other.consultant_assigned_id = $1
        AND other.scheduled_date = $2
        AND other.scheduled_time < $4::time
        AND other.scheduled_time + make_interval(mins => COALESCE(other.duration_minutes, 120)) > $3::time
        AND other.status IN ('confirmed', 'completed')
        AND other.id <> $5`,
    [consultantId, date, startTime, endTime, excludeScheduledId],
  );
  if (overlapping.length > 0) {
    return { ok: false, status: 409, body: { error: 'Time slot conflicts with another session' } };
  }
  return { ok: true };
}

// ── 518: reschedule proposals ──────────────────────────────────────────

// Propose a new time for a confirmed appointment. The proposer is the
// client, the assigned consultant, or an admin; the other side answers.
// The proposal is advisory until accepted: nothing moves on propose.
exports.proposeReschedule = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const scheduledId = Number(req.params.sessionId);
    if (!Number.isInteger(scheduledId) || scheduledId <= 0) {
      return res.status(400).json({ error: 'Invalid scheduled session id' });
    }
    const { date, startTime, reason } = req.body || {};
    const durationMinutes = req.body?.durationMinutes === undefined
      ? null
      : parseInt(req.body.durationMinutes, 10);

    if (!isDateStr(date) || !isTimeStr(startTime)) {
      return res.status(400).json({ error: 'date (YYYY-MM-DD) and startTime (HH:MM) required' });
    }
    if (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 480)) {
      return res.status(400).json({ error: 'Duration must be between 1 and 480 minutes' });
    }

    const row = await loadScheduledSession(scheduledId);
    if (!row) return res.status(404).json({ error: 'Session not found' });
    const party = sessionParty(req, row);
    if (!party) return res.status(403).json({ error: 'Not authorized for this session' });
    if (row.status !== 'confirmed') {
      return res.status(409).json({ error: 'Only a confirmed session can be rescheduled' });
    }

    const canonicalZone = await getConsultantTimezone(db, row.consultant_assigned_id);
    const proposedStart = sessionStartInstant(date, startTime, canonicalZone);
    if (proposedStart <= new Date()) {
      return res.status(400).json({ error: 'Proposed time must be in the future' });
    }

    const duration = durationMinutes ?? row.duration_minutes ?? 120;
    const slotCheck = await assertSlotFree(db, {
      consultantId: row.consultant_assigned_id, date, startTime, durationMinutes: duration, excludeScheduledId: scheduledId,
    });
    if (!slotCheck.ok) return res.status(slotCheck.status).json(slotCheck.body);

    let proposal;
    try {
      const { rows } = await db.query(
        `INSERT INTO consulting_session_reschedules
           (scheduled_session_id, proposed_by, proposed_by_role, proposed_date, proposed_time,
            proposed_duration_minutes, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [scheduledId, req.user.id, party, date, startTime, duration, reason?.trim() || null],
      );
      proposal = rows[0];
    } catch (err) {
      // Partial unique index: one open proposal per scheduled session.
      if (err.code === '23505') {
        return res.status(409).json({ error: 'reschedule_already_open', message: 'A reschedule proposal is already open for this session.' });
      }
      throw err;
    }

    for (const target of proposalCounterparties(proposal, row)) {
      await notifySessionParty({
        userId: target.userId,
        type: 'consulting_session_reschedule_proposed',
        data: { session_id: row.session_id, scheduled_session_id: scheduledId, reschedule_id: proposal.id },
        actionUrl: target.url,
        idempotencyKey: `consulting-reschedule-proposed:${proposal.id}`,
      });
    }

    return res.status(201).json(proposal);
  } catch (err) {
    logger.error('Failed to propose reschedule', { error: err.message });
    return res.status(500).json({ error: 'Failed to propose reschedule' });
  }
};

// List the reschedule proposals for one appointment, newest first.
exports.listReschedules = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const scheduledId = Number(req.params.sessionId);
    if (!Number.isInteger(scheduledId) || scheduledId <= 0) {
      return res.status(400).json({ error: 'Invalid scheduled session id' });
    }
    const row = await loadScheduledSession(scheduledId);
    if (!row) return res.status(404).json({ error: 'Session not found' });
    if (!sessionParty(req, row)) return res.status(403).json({ error: 'Not authorized for this session' });

    const { rows } = await db.query(
      `SELECT * FROM consulting_session_reschedules
        WHERE scheduled_session_id = $1 ORDER BY created_at DESC`,
      [scheduledId],
    );
    return res.json(rows);
  } catch (err) {
    logger.error('Failed to list reschedules', { error: err.message });
    return res.status(500).json({ error: 'Failed to list reschedules' });
  }
};

async function loadProposal(scheduledId, proposalId) {
  const { rows } = await db.query(
    `SELECT * FROM consulting_session_reschedules WHERE id = $1 AND scheduled_session_id = $2`,
    [proposalId, scheduledId],
  );
  return rows[0] || null;
}

// The counterparty answers a proposal. The proposer cannot answer their
// own proposal; an admin may answer any proposal that is not their own.
function canAnswerProposal(req, proposal, row) {
  if (!req?.user) return false;
  if (String(req.user.id) === String(proposal.proposed_by)) return false;
  const party = sessionParty(req, row);
  if (!party) return false;
  if (proposal.proposed_by_role === 'admin') return true;
  return party === 'admin' || party !== proposal.proposed_by_role;
}

// Accept a proposal: re-validate availability and overlap under the
// advisory lock, then move the confirmed row. The engagement itself is
// unchanged and already paid, so no payment check runs here.
exports.acceptReschedule = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const scheduledId = Number(req.params.sessionId);
    const proposalId = Number(req.params.proposalId);
    if (!Number.isInteger(scheduledId) || scheduledId <= 0 || !Number.isInteger(proposalId) || proposalId <= 0) {
      return res.status(400).json({ error: 'Invalid session or proposal id' });
    }
    const row = await loadScheduledSession(scheduledId);
    if (!row) return res.status(404).json({ error: 'Session not found' });
    const proposal = await loadProposal(scheduledId, proposalId);
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
    if (!canAnswerProposal(req, proposal, row)) {
      return res.status(403).json({ error: 'Not authorized to answer this proposal' });
    }
    if (proposal.status !== 'proposed') {
      return res.status(409).json({ error: 'Proposal is no longer open' });
    }
    if (row.status !== 'confirmed') {
      return res.status(409).json({ error: 'Only a confirmed session can be rescheduled' });
    }

    const enforce = consultantEnforcement() === 'enforce';
    const proposedDate = proposal.proposed_date instanceof Date
      ? proposal.proposed_date.toISOString().slice(0, 10)
      : proposal.proposed_date;
    const outcome = await withTransaction(db, async (client) => {
      if (enforce) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [
          `consulting-reschedule:${row.consultant_assigned_id}:${proposedDate}`,
        ]);
      }
      const canonicalZone = await getConsultantTimezone(client, row.consultant_assigned_id);
      const proposedStart = sessionStartInstant(proposedDate, proposal.proposed_time, canonicalZone);
      if (proposedStart <= new Date()) {
        return { status: 400, body: { error: 'Proposed time is no longer in the future' } };
      }
      const slotCheck = await assertSlotFree(client, {
        consultantId: row.consultant_assigned_id,
        date: proposedDate,
        startTime: proposal.proposed_time,
        durationMinutes: proposal.proposed_duration_minutes,
        excludeScheduledId: scheduledId,
      });
      if (!slotCheck.ok) return slotCheck;

      const { rows: updatedRows } = await client.query(
        `UPDATE consulting_sessions_scheduled
            SET scheduled_date = $1, scheduled_time = $2, duration_minutes = $3,
                status = 'confirmed', updated_at = NOW()
          WHERE id = $4 AND status = 'confirmed'
          RETURNING *`,
        [proposedDate, proposal.proposed_time, proposal.proposed_duration_minutes, scheduledId],
      );
      if (updatedRows.length === 0) {
        return { status: 409, body: { error: 'Session changed. Please retry.' } };
      }
      const { rows: decidedRows } = await client.query(
        `UPDATE consulting_session_reschedules
            SET status = 'accepted', decided_by = $1, decided_at = NOW(), updated_at = NOW()
          WHERE id = $2 AND status = 'proposed'
          RETURNING *`,
        [req.user.id, proposalId],
      );
      if (decidedRows.length === 0) {
        return { status: 409, body: { error: 'Proposal is no longer open' } };
      }
      return { status: 200, body: { scheduled: updatedRows[0], proposal: decidedRows[0] } };
    }, 'accept_consulting_reschedule');

    if (outcome.status !== 200) return res.status(outcome.status).json(outcome.body);

    const proposerUrl = proposal.proposed_by_role === 'consultant' ? consultantActionUrl() : clientActionUrl();
    await notifySessionParty({
      userId: proposal.proposed_by,
      type: 'consulting_session_reschedule_accepted',
      data: { session_id: row.session_id, scheduled_session_id: scheduledId, reschedule_id: proposalId },
      actionUrl: proposerUrl,
      idempotencyKey: `consulting-reschedule-accepted:${proposalId}`,
    });

    return res.json(outcome.body);
  } catch (err) {
    logger.error('Failed to accept reschedule', { error: err.message });
    return res.status(500).json({ error: 'Failed to accept reschedule' });
  }
};

// Decline a proposal: the appointment stays where it is.
exports.declineReschedule = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const scheduledId = Number(req.params.sessionId);
    const proposalId = Number(req.params.proposalId);
    if (!Number.isInteger(scheduledId) || scheduledId <= 0 || !Number.isInteger(proposalId) || proposalId <= 0) {
      return res.status(400).json({ error: 'Invalid session or proposal id' });
    }
    const row = await loadScheduledSession(scheduledId);
    if (!row) return res.status(404).json({ error: 'Session not found' });
    const proposal = await loadProposal(scheduledId, proposalId);
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
    if (!canAnswerProposal(req, proposal, row)) {
      return res.status(403).json({ error: 'Not authorized to answer this proposal' });
    }
    if (proposal.status !== 'proposed') {
      return res.status(409).json({ error: 'Proposal is no longer open' });
    }

    const { reason } = req.body || {};
    const { rows } = await db.query(
      `UPDATE consulting_session_reschedules
          SET status = 'declined', decided_by = $1, decided_at = NOW(),
              decision_reason = $2, updated_at = NOW()
        WHERE id = $3 AND status = 'proposed'
        RETURNING *`,
      [req.user.id, reason?.trim() || null, proposalId],
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Proposal is no longer open' });

    const proposerUrl = proposal.proposed_by_role === 'consultant' ? consultantActionUrl() : clientActionUrl();
    await notifySessionParty({
      userId: proposal.proposed_by,
      type: 'consulting_session_reschedule_declined',
      data: { session_id: row.session_id, scheduled_session_id: scheduledId, reschedule_id: proposalId },
      actionUrl: proposerUrl,
      idempotencyKey: `consulting-reschedule-declined:${proposalId}`,
    });

    return res.json(rows[0]);
  } catch (err) {
    logger.error('Failed to decline reschedule', { error: err.message });
    return res.status(500).json({ error: 'Failed to decline reschedule' });
  }
};

// Withdraw a proposal: only the proposer (or an admin acting for them)
// may pull it back while it is still open.
exports.withdrawReschedule = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const scheduledId = Number(req.params.sessionId);
    const proposalId = Number(req.params.proposalId);
    if (!Number.isInteger(scheduledId) || scheduledId <= 0 || !Number.isInteger(proposalId) || proposalId <= 0) {
      return res.status(400).json({ error: 'Invalid session or proposal id' });
    }
    const row = await loadScheduledSession(scheduledId);
    if (!row) return res.status(404).json({ error: 'Session not found' });
    const proposal = await loadProposal(scheduledId, proposalId);
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
    const party = sessionParty(req, row);
    if (!party) return res.status(403).json({ error: 'Not authorized for this session' });
    if (party !== 'admin' && String(req.user.id) !== String(proposal.proposed_by)) {
      return res.status(403).json({ error: 'Only the proposer can withdraw this proposal' });
    }
    if (proposal.status !== 'proposed') {
      return res.status(409).json({ error: 'Proposal is no longer open' });
    }

    const { rows } = await db.query(
      `UPDATE consulting_session_reschedules
          SET status = 'withdrawn', decided_by = $1, decided_at = NOW(), updated_at = NOW()
        WHERE id = $2 AND status = 'proposed'
        RETURNING *`,
      [req.user.id, proposalId],
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Proposal is no longer open' });

    return res.json(rows[0]);
  } catch (err) {
    logger.error('Failed to withdraw reschedule', { error: err.message });
    return res.status(500).json({ error: 'Failed to withdraw reschedule' });
  }
};

// ── 519: cancellation ──────────────────────────────────────────────────

// Cancel an appointment. The client, the assigned consultant, or an admin
// may cancel a pending_confirmation or confirmed appointment. Both rows
// move in one transaction, so an admin cancellation can no longer leave a
// phantom confirmed booking behind (audit G10-4). The reason and the
// refund request are recorded; a refund itself stays on the existing
// admin refund endpoint and is never automatic.
exports.cancelScheduledSession = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const scheduledId = Number(req.params.sessionId);
    if (!Number.isInteger(scheduledId) || scheduledId <= 0) {
      return res.status(400).json({ error: 'Invalid scheduled session id' });
    }
    const { reason, refund_requested } = req.body || {};

    const row = await loadScheduledSession(scheduledId);
    if (!row) return res.status(404).json({ error: 'Session not found' });
    const party = sessionParty(req, row);
    if (!party) return res.status(403).json({ error: 'Not authorized for this session' });
    if (!['pending_confirmation', 'confirmed'].includes(row.status)) {
      return res.status(409).json({ error: 'Session cannot be cancelled from its current status' });
    }

    const outcome = await withTransaction(db, async (client) => {
      const { rows: cancelledRows } = await client.query(
        `UPDATE consulting_sessions_scheduled
            SET status = 'cancelled', cancellation_reason = $1, refund_requested = $2,
                cancelled_by = $3, cancelled_at = NOW(), updated_at = NOW()
          WHERE id = $4 AND status IN ('pending_confirmation', 'confirmed')
          RETURNING *`,
        [reason?.trim() || null, refund_requested === true, req.user.id, scheduledId],
      );
      if (cancelledRows.length === 0) {
        return { status: 409, body: { error: 'Session cannot be cancelled from its current status' } };
      }
      // Canonical status lives on consulting_sessions; move it with the row.
      await client.query(
        `UPDATE consulting_sessions SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [row.session_id],
      );
      // Open reschedule proposals on a cancelled appointment are moot.
      await client.query(
        `UPDATE consulting_session_reschedules
            SET status = 'withdrawn', decided_by = $1, decided_at = NOW(),
                decision_reason = 'Session cancelled', updated_at = NOW()
          WHERE scheduled_session_id = $2 AND status = 'proposed'`,
        [req.user.id, scheduledId],
      );
      return { status: 200, body: cancelledRows[0] };
    }, 'cancel_consulting_session');

    if (outcome.status !== 200) return res.status(outcome.status).json(outcome.body);

    const data = { session_id: row.session_id, scheduled_session_id: scheduledId, refund_requested: refund_requested === true };
    await notifySessionParty({
      userId: row.client_id,
      type: 'consulting_session_cancelled',
      data,
      actionUrl: clientActionUrl(),
      idempotencyKey: `consulting-session-cancelled:${scheduledId}:client`,
    });
    await notifySessionParty({
      userId: row.consultant_assigned_id,
      type: 'consulting_session_cancelled',
      data,
      actionUrl: consultantActionUrl(),
      idempotencyKey: `consulting-session-cancelled:${scheduledId}:consultant`,
    });

    return res.json(outcome.body);
  } catch (err) {
    logger.error('Failed to cancel scheduled session', { error: err.message });
    return res.status(500).json({ error: 'Failed to cancel session' });
  }
};

// ── 520: attendance ───────────────────────────────────────────────────

// Confirm the caller's own attendance. Either party may confirm once the
// scheduled start has passed; an admin is not a party and cannot confirm
// for one. One confirmation per party per appointment.
exports.confirmAttendance = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const scheduledId = Number(req.params.sessionId);
    if (!Number.isInteger(scheduledId) || scheduledId <= 0) {
      return res.status(400).json({ error: 'Invalid scheduled session id' });
    }

    const row = await loadScheduledSession(scheduledId);
    if (!row) return res.status(404).json({ error: 'Session not found' });
    const party = sessionParty(req, row);
    if (party !== 'client' && party !== 'consultant') {
      return res.status(403).json({ error: 'Only the client or the consultant can confirm attendance' });
    }
    if (!['confirmed', 'completed'].includes(row.status)) {
      return res.status(409).json({ error: 'Attendance can only be confirmed for a confirmed or completed session' });
    }
    const start = sessionStartInstant(
      row.scheduled_date instanceof Date ? row.scheduled_date.toISOString().slice(0, 10) : row.scheduled_date,
      row.scheduled_time,
      row.timezone,
    );
    if (start > new Date()) {
      return res.status(409).json({ error: 'session_not_started', message: 'The session has not started yet.' });
    }

    const { rows } = await db.query(
      `INSERT INTO consulting_session_attendance (scheduled_session_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (scheduled_session_id, role) DO NOTHING
       RETURNING *`,
      [scheduledId, req.user.id, party],
    );
    if (rows.length === 0) {
      return res.status(409).json({ error: 'Attendance already confirmed' });
    }

    const otherParty = party === 'client'
      ? { userId: row.consultant_assigned_id, url: consultantActionUrl() }
      : { userId: row.client_id, url: clientActionUrl() };
    await notifySessionParty({
      userId: otherParty.userId,
      type: 'consulting_session_attendance_confirmed',
      data: { session_id: row.session_id, scheduled_session_id: scheduledId, role: party },
      actionUrl: otherParty.url,
      idempotencyKey: `consulting-attendance:${scheduledId}:${party}`,
    });

    return res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('Failed to confirm attendance', { error: err.message });
    return res.status(500).json({ error: 'Failed to confirm attendance' });
  }
};

// List the attendance confirmations for one appointment.
exports.listAttendance = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const scheduledId = Number(req.params.sessionId);
    if (!Number.isInteger(scheduledId) || scheduledId <= 0) {
      return res.status(400).json({ error: 'Invalid scheduled session id' });
    }
    const row = await loadScheduledSession(scheduledId);
    if (!row) return res.status(404).json({ error: 'Session not found' });
    if (!sessionParty(req, row)) return res.status(403).json({ error: 'Not authorized for this session' });

    const { rows } = await db.query(
      `SELECT * FROM consulting_session_attendance
        WHERE scheduled_session_id = $1 ORDER BY confirmed_at ASC`,
      [scheduledId],
    );
    return res.json(rows);
  } catch (err) {
    logger.error('Failed to list attendance', { error: err.message });
    return res.status(500).json({ error: 'Failed to list attendance' });
  }
};

// ── Session detail + contractor list ────────────────────────────────────

// One appointment with its open history: the scheduled row, its reschedule
// proposals, and its attendance confirmations. Used by the client portal,
// the contractor dashboard, and the admin detail page.
exports.getScheduledSessionDetail = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const scheduledId = Number(req.params.sessionId);
    if (!Number.isInteger(scheduledId) || scheduledId <= 0) {
      return res.status(400).json({ error: 'Invalid scheduled session id' });
    }
    const row = await loadScheduledSession(scheduledId);
    if (!row) return res.status(404).json({ error: 'Session not found' });
    if (!sessionParty(req, row)) return res.status(403).json({ error: 'Not authorized for this session' });

    const [{ rows: proposals }, { rows: attendance }] = await Promise.all([
      db.query(
        `SELECT * FROM consulting_session_reschedules
          WHERE scheduled_session_id = $1 ORDER BY created_at DESC`,
        [scheduledId],
      ),
      db.query(
        `SELECT * FROM consulting_session_attendance
          WHERE scheduled_session_id = $1 ORDER BY confirmed_at ASC`,
        [scheduledId],
      ),
    ]);
    return res.json({ scheduled: row, proposals, attendance });
  } catch (err) {
    logger.error('Failed to get scheduled session detail', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch scheduled session' });
  }
};

// Resolve the detail by consulting session id (the admin detail page only
// knows the engagement id, not the scheduled row id).
exports.getScheduledSessionDetailByConsulting = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const consultingSessionId = Number(req.params.consultingSessionId);
    if (!Number.isInteger(consultingSessionId) || consultingSessionId <= 0) {
      return res.status(400).json({ error: 'Invalid consulting session id' });
    }
    const { rows } = await db.query(
      `SELECT css.*, cs.user_id AS client_id,
              cs.consultant_assigned_id, cs.status AS session_status
         FROM consulting_sessions_scheduled css
         JOIN consulting_sessions cs ON cs.id = css.session_id
        WHERE cs.id = $1`,
      [consultingSessionId],
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Session not found' });
    if (!sessionParty(req, row)) return res.status(403).json({ error: 'Not authorized for this session' });

    const [{ rows: proposals }, { rows: attendance }] = await Promise.all([
      db.query(
        `SELECT * FROM consulting_session_reschedules
          WHERE scheduled_session_id = $1 ORDER BY created_at DESC`,
        [row.id],
      ),
      db.query(
        `SELECT * FROM consulting_session_attendance
          WHERE scheduled_session_id = $1 ORDER BY confirmed_at ASC`,
        [row.id],
      ),
    ]);
    return res.json({ scheduled: row, proposals, attendance });
  } catch (err) {
    logger.error('Failed to get scheduled session detail', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch scheduled session' });
  }
};

// The consultant's own appointments, with open-proposal counts and
// attendance, for the contractor dashboard sessions section (items 518/520).
exports.listMyConsultantSessions = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const consultantId = req.user.id;

    const { rows } = await db.query(
      `SELECT css.id AS scheduled_id, css.session_id, css.scheduled_date, css.scheduled_time,
              css.duration_minutes, css.meeting_link, css.meeting_type, css.timezone, css.status AS scheduled_status,
              cs.status AS session_status, cs.service_tier, cs.business_name,
              TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS client_name,
              u.email AS client_email,
              (SELECT COUNT(*) FROM consulting_session_reschedules r
                WHERE r.scheduled_session_id = css.id AND r.status = 'proposed') AS open_proposals
         FROM consulting_sessions_scheduled css
         JOIN consulting_sessions cs ON cs.id = css.session_id
         JOIN users u ON u.id = cs.user_id
        WHERE css.consultant_assigned_id = $1
        ORDER BY css.scheduled_date DESC, css.scheduled_time DESC
        LIMIT 50`,
      [consultantId],
    );

    const ids = rows.map((r) => r.scheduled_id);
    const proposalsBySession = {};
    const attendanceBySession = {};
    if (ids.length > 0) {
      const { rows: proposals } = await db.query(
        `SELECT * FROM consulting_session_reschedules
          WHERE scheduled_session_id = ANY($1::bigint[]) ORDER BY created_at DESC`,
        [ids],
      );
      const { rows: attendance } = await db.query(
        `SELECT * FROM consulting_session_attendance
          WHERE scheduled_session_id = ANY($1::bigint[]) ORDER BY confirmed_at ASC`,
        [ids],
      );
      for (const proposal of proposals) {
        (proposalsBySession[proposal.scheduled_session_id] ||= []).push(proposal);
      }
      for (const confirmation of attendance) {
        (attendanceBySession[confirmation.scheduled_session_id] ||= []).push(confirmation);
      }
    }

    return res.json(rows.map((row) => ({
      ...row,
      open_proposals: Number(row.open_proposals),
      proposals: proposalsBySession[row.scheduled_id] || [],
      attendance: attendanceBySession[row.scheduled_id] || [],
    })));
  } catch (err) {
    logger.error('Failed to list consultant sessions', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch sessions' });
  }
};
