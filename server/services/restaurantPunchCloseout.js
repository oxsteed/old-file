'use strict';

// Phase 2 punch integrity (goal goal_a0fc7c0f0394): the close-of-day
// safety net for forgotten punches.
//
// Before this, an open entry's displayed hours were computed live
// against `now`, so a forgotten clock-out silently inflated displayed
// (and eventually paid) hours until a manager noticed. Detection
// existed only as a count in the exceptions report.
//
// Policy (documented; there is exactly one rule, applied everywhere):
//   - Every open punch has a close time. It is the end of the
//     published shift for that employee on the punch's work date when
//     one exists (the shift end is a business-local wall clock,
//     converted to an instant in the store's timezone, so DST is
//     handled by PostgreSQL's AT TIME ZONE), otherwise clock-in +
//     AUTO_CLOSE_CAP_HOURS.
//   - AUTO_CLOSE_CAP_HOURS is 12: no single shift is credited beyond
//     12 hours without a manager looking at it. A 12-hour cap is
//     above any lawful single shift in the jurisdictions in the rule
//     table and below the "forgotten overnight" range, so it separates
//     long shifts from forgotten punches without ever cutting a real
//     shift short at close time (the entry only becomes a candidate
//     after the grace below, and a manager can still correct it).
//   - An entry becomes a candidate 30 minutes past its close time
//     (STALE_GRACE_MINUTES): the grace absorbs a late clock-out and a
//     shift that ran long, so the sweep never closes a punch the
//     employee is about to close themselves.
//   - The sweep closes the entry AT its close time (not at sweep
//     time), stamps hours_worked net of breaks, and marks it
//     system_closed_at / system_closed_reason. The hours are real
//     stamped hours, but they are flagged everywhere they are shown
//     (presentTimeEntry, computeLabor) and are never silently treated
//     as a normal clock-out. The entry stays correctable afterwards
//     through the manager edit or the employee correction flow.
//   - The manager is notified per closed entry. Notification failure
//     never rolls back a close: the close is the record, the
//     notification is best-effort.
//   - Runs nightly (server/jobs/restaurantPunchCloseoutJob.js) and on
//     demand from the manager close-stale endpoint. Re-running is a
//     no-op: closed entries are no longer open, so they are never
//     picked up twice. Each entry is closed in its own transaction:
//     one bad row never blocks the rest of the sweep.

const pool = require('../db');
const logger = require('../utils/logger');
const { computedHours } = require('./restaurantPunchHours');
const { sendNotification } = require('./notificationService');

const AUTO_CLOSE_CAP_HOURS = 12;
const STALE_GRACE_MINUTES = 30;

async function findManagers(db, businessId) {
  const { rows } = await db.query(
    `SELECT user_id FROM businesses WHERE id = $1
      UNION
     SELECT member_id FROM business_members
      WHERE business_id = $1 AND status = 'active' AND role = 'manager'`,
    [businessId]
  );
  return rows.map((r) => r.user_id).filter(Boolean);
}

async function notifyManagers(db, businessId, closed) {
  let notified = 0;
  let notifyErrors = 0;
  let managers = [];
  try {
    managers = await findManagers(db, businessId);
  } catch (err) {
    logger.warn('Punch closeout: manager lookup failed', { businessId, error: err.message });
    return { notified, notifyErrors: notifyErrors + 1 };
  }
  for (const managerId of managers) {
    try {
      await sendNotification({
        userId: managerId,
        type: 'staff_time_entry_system_closed',
        title: 'A forgotten punch was closed automatically',
        body: `${closed.employeeName || 'A team member'}'s punch from ${closed.entryDate} was closed at ${closed.closedAtLabel} and flagged as system-closed. Review it before payroll.`,
        data: {
          business_id: businessId,
          entry_id: closed.entryId,
          user_id: closed.userId,
          params: {
            employeeName: closed.employeeName || 'A team member',
            entryDate: closed.entryDate,
            closedAt: closed.closedAtLabel,
            businessName: closed.businessName || '',
          },
        },
      });
      notified += 1;
    } catch (err) {
      notifyErrors += 1;
      logger.warn('Punch closeout: manager notification failed', {
        businessId, entryId: closed.entryId, error: err.message,
      });
    }
  }
  return { notified, notifyErrors };
}

async function closeStalePunches({ businessId = null, db = pool, now = new Date(), notify = true } = {}) {
  const nowMs = new Date(now).getTime();
  const graceCutoff = new Date(nowMs - STALE_GRACE_MINUTES * 60 * 1000);
  // Open entries only; the close time is computed in SQL so the shift
  // end (a business-local wall clock) converts to an instant in the
  // store's timezone with DST handled by AT TIME ZONE. An overnight
  // shift whose stored end_time falls before its start on the same
  // date yields a close time at or before clock-in; the JS fallback
  // below then applies the 12-hour cap instead of closing the punch
  // in the past.
  const { rows: open } = await db.query(
    `SELECT te.*,
            COALESCE(l.timezone, b.timezone, 'UTC') AS tz,
            b.business_name AS business_name,
            COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS employee_name,
            COALESCE(
              (SELECT ((sh.shift_date + sh.end_time) AT TIME ZONE COALESCE(l.timezone, b.timezone, 'UTC'))
                 FROM business_staff_shifts sh
                WHERE sh.business_id = te.business_id
                  AND sh.user_id = te.user_id
                  AND sh.shift_date = te.entry_date
                  AND sh.published_at IS NOT NULL
                  AND sh.location_id IS NOT DISTINCT FROM te.location_id
                ORDER BY sh.end_time DESC LIMIT 1),
              te.clock_in_at + ($3::int * INTERVAL '1 hour')) AS close_at,
            EXISTS (
              SELECT 1 FROM business_staff_shifts sh
               WHERE sh.business_id = te.business_id
                 AND sh.user_id = te.user_id
                 AND sh.shift_date = te.entry_date
                 AND sh.published_at IS NOT NULL
                 AND sh.location_id IS NOT DISTINCT FROM te.location_id
            ) AS has_shift
       FROM business_time_entries te
       JOIN businesses b ON b.id = te.business_id
       LEFT JOIN restaurant_locations l ON l.id = te.location_id
       LEFT JOIN users u ON u.id = te.user_id
      WHERE te.clock_in_at IS NOT NULL
        AND te.clock_out_at IS NULL
        AND te.voided_at IS NULL
        AND ($1::int IS NULL OR te.business_id = $1)
        AND te.clock_in_at <= $2::timestamptz
      ORDER BY te.clock_in_at ASC`,
    [businessId, graceCutoff.toISOString(), AUTO_CLOSE_CAP_HOURS]
  );

  const closed = [];
  let notified = 0;
  let notifyErrors = 0;
  const errors = [];

  for (const entry of open) {
    const clockInMs = new Date(entry.clock_in_at).getTime();
    let closeAt = entry.close_at ? new Date(entry.close_at) : null;
    let reason = entry.has_shift ? 'auto_close_shift_end' : 'auto_close_12h_cap';
    // A close time at or before clock-in (overnight shift stored
    // end-before-start) is not a real close time: fall back to the cap.
    if (!closeAt || Number.isNaN(closeAt.getTime()) || closeAt.getTime() <= clockInMs) {
      closeAt = new Date(clockInMs + AUTO_CLOSE_CAP_HOURS * 3600 * 1000);
      reason = 'auto_close_12h_cap';
    }
    // Still inside the grace window for this close time: leave it open.
    if (closeAt.getTime() > graceCutoff.getTime()) continue;

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: locked } = await client.query(
        `SELECT * FROM business_time_entries
          WHERE id = $1 AND business_id = $2 AND clock_out_at IS NULL AND voided_at IS NULL
          FOR UPDATE`,
        [entry.id, entry.business_id]
      );
      if (!locked.length) {
        await client.query('ROLLBACK');
        continue; // closed or voided concurrently; nothing to do.
      }
      const current = locked[0];
      const hours = Math.max(
        0.01,
        computedHours({ ...current, clock_out_at: closeAt }, closeAt.getTime())
      );
      const { rows: [updated] } = await client.query(
        `UPDATE business_time_entries
            SET clock_out_at = $1, hours_worked = $2,
                system_closed_at = NOW(), system_closed_reason = $3
          WHERE id = $4 AND business_id = $5 AND clock_out_at IS NULL AND voided_at IS NULL
          RETURNING *`,
        [closeAt.toISOString(), hours, reason, entry.id, entry.business_id]
      );
      if (!updated) {
        await client.query('ROLLBACK');
        continue;
      }
      // Audit trail: the close is an edit like any other, with no human
      // editor or approver (both NULL): the system closed it.
      await client.query(
        `INSERT INTO business_time_entry_edits
           (entry_id, business_id, editor_user_id, approved_by, field, old_value, new_value, reason)
         VALUES ($1, $2, NULL, NULL, 'clock_out_at', NULL, $3, $4)`,
        [
          entry.id,
          entry.business_id,
          closeAt.toISOString(),
          reason === 'auto_close_shift_end'
            ? 'System auto-close at the end of the published shift (forgotten punch)'
            : 'System auto-close at clock-in + 12 hours: no published shift, forgotten punch',
        ]
      );
      await client.query('COMMIT');
      const closedEntry = {
        ...updated,
        system_closed: true,
        hours: Number(updated.hours_worked),
        entryId: Number(entry.id),
        userId: entry.user_id,
        employeeName: entry.employee_name || null,
        businessName: entry.business_name || null,
        entryDate: entry.entry_date instanceof Date
          ? entry.entry_date.toISOString().slice(0, 10)
          : String(entry.entry_date || '').slice(0, 10),
        closedAtLabel: closeAt.toISOString(),
        close_reason: reason,
      };
      closed.push(closedEntry);
      if (notify) {
        const result = await notifyManagers(db, entry.business_id, closedEntry);
        notified += result.notified;
        notifyErrors += result.notifyErrors;
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      errors.push({ entryId: Number(entry.id), error: err.message });
      logger.warn('Punch closeout: failed to close entry', { entryId: entry.id, error: err.message });
    } finally {
      client.release();
    }
  }

  return { closed, notified, notifyErrors, errors };
}

module.exports = { closeStalePunches, AUTO_CLOSE_CAP_HOURS, STALE_GRACE_MINUTES };
