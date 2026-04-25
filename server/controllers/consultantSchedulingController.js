const db = require('../db');
const { sendEmail } = require('../utils/email');
const logger = require('../utils/logger');

// Get consultant's recurring availability (day of week schedule)
exports.getConsultantAvailability = async (req, res) => {
  try {
    const { consultantId } = req.params;

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
    // users.id is a UUID — compare as strings, not via parseInt.
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
    // users.id is a UUID — compare as strings, not via parseInt.
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
    // users.id is a UUID — compare as strings, not via parseInt.
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

// Get available time slots for a consultant on a specific date
exports.getAvailableSlots = async (req, res) => {
  try {
    const { consultantId } = req.params;
    const { date, durationMinutes = 60 } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Date parameter required (YYYY-MM-DD)' });
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
           AND scheduled_time = $3
           AND status IN ('confirmed', 'completed')`,
        [consultantId, date, slot.slot_start]
      );

      if (isBooked.rows.length === 0) {
        availableSlots.push(slot);
      }
    }

    res.json(availableSlots);
  } catch (err) {
    logger.error('Failed to get available slots', { error: err.message, consultantId: req.params.consultantId });
    res.status(500).json({ error: 'Failed to fetch available slots' });
  }
};

// Book a time slot for a consulting session
exports.bookTimeSlot = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { consultantId, date, startTime, meetingLink, timezone } = req.body;
    const durationMinutes = parseInt(req.body.durationMinutes, 10) || 120;

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

    // Resolve session + owner via JOIN — consulting_sessions_scheduled does not have customer_id
    const { rows: sessions } = await db.query(
      `SELECT css.id, css.session_id, cs.user_id, cs.email, cs.first_name
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

    // Atomic conflict-check + update via conditional WHERE to avoid double booking.
    // Note: status valid values per migration 103 CHECK: pending_confirmation, confirmed, completed, no_show, cancelled.
    const { rows: updated } = await db.query(
      `UPDATE consulting_sessions_scheduled css_target
       SET scheduled_date = $1,
           scheduled_time = $2,
           duration_minutes = $3,
           meeting_link = $4,
           timezone = $5,
           consultant_assigned_id = $6,
           status = 'confirmed',
           updated_at = NOW()
       WHERE css_target.id = $7
         AND NOT EXISTS (
           SELECT 1 FROM consulting_sessions_scheduled other
           WHERE other.consultant_assigned_id = $6
             AND other.scheduled_date = $1
             AND other.scheduled_time < $9
             AND (other.scheduled_time + (other.duration_minutes || ' minutes')::INTERVAL)::TIME > $8
             AND other.status IN ('confirmed', 'completed')
             AND other.id <> $7
         )
       RETURNING *`,
      [date, startTime, durationMinutes, meetingLink || null,
       timezone || 'America/New_York', consultantId, sessionId,
       startTime, endTime]
    );

    if (updated.length === 0) {
      return res.status(409).json({ error: 'Time slot conflicts with another session' });
    }

    // Respond first, then send email asynchronously (do not block the response).
    res.json(updated[0]);

    setImmediate(async () => {
      try {
        const consultant = await db.query(
          `SELECT first_name, last_name FROM users WHERE id = $1`,
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

        await sendEmail({
          to: session.email,
          subject: 'Your Consulting Session is Confirmed',
          html: `
            <p>Hi ${session.first_name},</p>
            <p>Your consulting session has been scheduled!</p>
            <p><strong>Session Details:</strong></p>
            <ul>
              <li>Consultant: ${consultantName}</li>
              <li>Date &amp; Time: ${formattedDate}</li>
              <li>Duration: ${durationMinutes} minutes</li>
              ${meetingLink ? `<li><a href="${meetingLink}">Join Meeting</a></li>` : ''}
            </ul>
            <p>We look forward to helping you grow your business!</p>
            <p>Best regards,<br>The OxSteed Team</p>
          `,
        });
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
exports.getNextAvailableDates = async (req, res) => {
  try {
    const { consultantId } = req.params;
    const { fromDate, daysAhead = 30, durationMinutes = 60 } = req.query;

    const startDate = fromDate ? new Date(fromDate) : new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + parseInt(daysAhead));

    const availableDates = [];

    // Check next N days for availability
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];

      const { rows: slots } = await db.query(
        `SELECT slot_start FROM get_consultant_available_slots($1, $2, $3)`,
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
               AND scheduled_time = $3
               AND status IN ('confirmed', 'completed')`,
            [consultantId, dateStr, slot.slot_start]
          );

          if (booked.length === 0) {
            availableSlots.push(slot.slot_start);
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

    res.json(availableDates);
  } catch (err) {
    logger.error('Failed to get next available dates', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch available dates' });
  }
};
