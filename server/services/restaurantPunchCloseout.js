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
//     handled by PostgreSQL's AT TIME ZONE). A clock-in just outside
//     the shift window (early, or after midnight for an overnight
//     shift that started yesterday) has no containing shift, but a
//     shift still exists that day: the close time is then that
//     shift's end (the nearest shift end after clock-in), not the
//     12-hour cap. Otherwise clock-in + AUTO_CLOSE_CAP_HOURS.
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
//   - A published shift from the preceding business day (per store
//     timezone) with no time entry is flagged as a missing punch and
//     the manager is notified once per missing shift per manager (the
//     notification carries an idempotency key, background-jobs audit
//     #42). The yesterday-only window plus the key give the once-only
//     property even though the job runs hourly. Older dates are never
//     notified, and a shift with an entry is never flagged.
//   - Runs hourly (server/jobs/restaurantPunchCloseoutJob.js) and on
//     demand from the manager close-stale endpoint. Re-running is a
//     no-op: closed entries are no longer open, so they are never
//     picked up twice. Each entry is closed in its own transaction:
//     one bad row never blocks the rest of the sweep.

const pool = require('../db');
const logger = require('../utils/logger');
const { LeaseLostError } = require('../jobs/jobLockingService');
const { computedHours } = require('./restaurantPunchHours');
const { sendNotification } = require('./notificationService');

const AUTO_CLOSE_CAP_HOURS = 12;
const STALE_GRACE_MINUTES = 30;
// Background-jobs audit #48: one run closes at most this many stale
// entries and flags at most this many missing shifts. A multi-day
// backlog of forgotten punches must not materialize every open entry
// into memory and process them one at a time under a single lease;
// the next hourly run picks up the rest. Both selects are oldest-first
// with a deterministic id tiebreak, so repeated runs work through a
// backlog instead of re-processing the same rows forever. That
// forward progress holds for the stale select because a closed entry
// leaves the open set (clock_out_at IS NULL). It does NOT hold for the
// missing-punch select: notifying leaves no trace on the shift row
// (the dedupe lives on the notification delivery_key), so on a day
// with more than 500 missing shifts the same oldest 500 recur and
// shifts beyond the cap are never flagged that day (see the note on
// the missing-punch query).
const CLOSEOUT_BATCH_LIMIT = 500;

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
    // Money flows W4: a lost lease aborts the sweep; it is not a
    // failed notification. (findManagers runs on the fence's handle
    // in the job path, so this is how a lease lost at the notify
    // step surfaces.)
    if (err instanceof LeaseLostError) throw err;
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

async function notifyMissingPunch(db, businessId, missing) {
  let notified = 0;
  let notifyErrors = 0;
  let managers = [];
  try {
    managers = await findManagers(db, businessId);
  } catch (err) {
    // Money flows W4: see notifyManagers above.
    if (err instanceof LeaseLostError) throw err;
    logger.warn('Punch closeout: manager lookup failed', { businessId, error: err.message });
    return { notified, notifyErrors: notifyErrors + 1 };
  }
  for (const managerId of managers) {
    try {
      await sendNotification({
        userId: managerId,
        type: 'staff_time_entry_missing_punch',
        title: 'A published shift was never punched',
        body: `${missing.employeeName || 'A team member'} was scheduled ${missing.shiftDate} ${missing.startTime} to ${missing.endTime} and has no time entry. Check whether the shift was worked and record the punch before payroll.`,
        data: {
          business_id: businessId,
          shift_id: missing.shiftId,
          user_id: missing.userId,
          params: {
            employeeName: missing.employeeName || 'A team member',
            shiftDate: missing.shiftDate,
            startTime: missing.startTime,
            endTime: missing.endTime,
            businessName: missing.businessName || '',
          },
        },
        // Background-jobs audit #42: the missing-punch window is the
        // same "yesterday" date for a full day and the job runs
        // hourly, so without this key one forgotten punch re-notified
        // every manager ~24 times a day (plus duplicates from the
        // on-demand endpoint). The key is per manager because the
        // notification table dedupes globally on delivery_key: a
        // shared per-shift key would notify only the first manager
        // and silently drop the rest.
        idempotencyKey: `missing-punch:${missing.shiftId}:${missing.shiftDate}:${managerId}`,
      });
      notified += 1;
    } catch (err) {
      notifyErrors += 1;
      logger.warn('Punch closeout: missing-punch notification failed', {
        businessId, shiftId: missing.shiftId, error: err.message,
      });
    }
  }
  return { notified, notifyErrors };
}

// Best-effort alert for a failed sweep (called by the job after its
// retry is exhausted): tell the managers of every business with
// punches that are definitely past their close time, so the open
// punches are reviewed before payroll instead of silently ageing.
// "Definitely past" means clock-in + the 12h cap + the 30min grace:
// the cap is the latest any close time can be, so no shift-end
// computation (the part that just failed) is needed to know these
// are stale. A lookup failure here returns zero alerts rather than
// throwing: the alert is best-effort and the sweep error itself is
// the record.
async function notifyCloseoutFailure(db, { now = new Date() } = {}) {
  let rows = [];
  try {
    ({ rows } = await db.query(
      `SELECT business_id, COUNT(*)::int AS stale_count
         FROM business_time_entries
        WHERE clock_in_at IS NOT NULL
          AND clock_out_at IS NULL
          AND voided_at IS NULL
          AND clock_in_at <= $1::timestamptz
            - ($2::int * INTERVAL '1 hour') - ($3::int * INTERVAL '1 minute')
        GROUP BY business_id
        ORDER BY business_id`,
      [new Date(now).toISOString(), AUTO_CLOSE_CAP_HOURS, STALE_GRACE_MINUTES]
    ));
  } catch (err) {
    logger.warn('Punch closeout: stale-punch lookup for failure alert failed', { error: err.message });
    return { alerted: 0, alertErrors: 1, businesses: [] };
  }
  let alerted = 0;
  let alertErrors = 0;
  const businesses = [];
  for (const row of rows) {
    const businessId = Number(row.business_id);
    businesses.push(businessId);
    let managers = [];
    try {
      managers = await findManagers(db, businessId);
    } catch (err) {
      alertErrors += 1;
      logger.warn('Punch closeout: manager lookup for failure alert failed', { businessId, error: err.message });
      continue;
    }
    for (const managerId of managers) {
      try {
        await sendNotification({
          userId: managerId,
          type: 'staff_time_entry_closeout_failed',
          title: 'Automatic punch closeout failed',
          body: `The automatic closeout of forgotten punches could not run. ${Number(row.stale_count)} open punch(es) at your business are past their close time. Review them before payroll.`,
          data: {
            business_id: businessId,
            params: {
              staleCount: Number(row.stale_count),
              businessName: '',
            },
          },
        });
        alerted += 1;
      } catch (err) {
        alertErrors += 1;
        logger.warn('Punch closeout: failure alert notification failed', { businessId, error: err.message });
      }
    }
  }
  return { alerted, alertErrors, businesses };
}

// One entry's close, in its own transaction. With a fence the lease is
// re-verified inside the transaction (fence.fencedTransaction), so a
// stale worker's close is refused instead of committed after lease
// loss; without one the raw-pool transaction runs as before. A work
// function returning null means "nothing to close" (closed or voided
// concurrently); the empty transaction still commits harmlessly.
async function runEntryTransaction({ db, fence }, work) {
  if (fence) return fence.fencedTransaction(work);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function closeStalePunches({ businessId = null, db = pool, fence = null, now = new Date(), notify = true } = {}) {
  const nowMs = new Date(now).getTime();
  const graceCutoff = new Date(nowMs - STALE_GRACE_MINUTES * 60 * 1000);
  // Background-jobs audit #43: when the fenced job hands us its fence,
  // every write in this sweep goes through fence.db, so a worker that
  // lost its lease cannot keep closing punches through the raw pool.
  // Without a fence (on-demand endpoint, tests) the supplied db is used.
  const handle = fence ? fence.db : db;
  // Open entries only; the close time is computed in SQL so the shift
  // end (a business-local wall clock) converts to an instant in the
  // store's timezone with DST handled by AT TIME ZONE. The shift used
  // is the one CONTAINING the clock-in (clock-in instant inside
  // [shift start, shift end)), not the latest-ending shift of the
  // day, so a split shift closes at the end of the shift actually
  // worked. An overnight shift (end_time <= start_time) contains
  // clock-ins at or after its start or before its end, and closes
  // the next morning: shift_date + end_time + 1 day. When no shift
  // contains the clock-in, the fallback close is the nearest shift
  // end after clock-in over shifts on the entry date and the day
  // before (background-jobs audit #44): an early clock-in, or an
  // after-midnight clock-in for an overnight shift that started
  // yesterday, closes at that shift's end instead of the 12-hour
  // cap. Only when no shift exists at all does the JS fallback below
  // apply the cap. Cancelled shifts never close a punch
  // (cancelled_at IS NULL on both subqueries). The select is capped
  // at CLOSEOUT_BATCH_LIMIT rows, oldest first with an id tiebreak
  // (#48): repeated runs close the next-oldest batch, because a
  // closed entry leaves the open set. No lower date bound: an old
  // forgotten punch is still a real punch that needs closing, and the
  // cap (not a date cutoff) is what bounds the run.
  const { rows: open } = await handle.query(
    `SELECT te.*,
            COALESCE(l.timezone, b.timezone, 'UTC') AS tz,
            b.business_name AS business_name,
            COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS employee_name,
            (SELECT ((sh.shift_date + sh.end_time
                       + CASE WHEN sh.end_time <= sh.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0 days' END)
                      AT TIME ZONE COALESCE(l.timezone, b.timezone, 'UTC'))
               FROM business_staff_shifts sh
              WHERE sh.business_id = te.business_id
                AND sh.user_id = te.user_id
                AND sh.shift_date = te.entry_date
                AND sh.published_at IS NOT NULL
                AND sh.cancelled_at IS NULL
                AND sh.location_id IS NOT DISTINCT FROM te.location_id
                AND te.clock_in_at >= ((sh.shift_date + sh.start_time) AT TIME ZONE COALESCE(l.timezone, b.timezone, 'UTC'))
                AND te.clock_in_at < ((sh.shift_date + sh.end_time
                       + CASE WHEN sh.end_time <= sh.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0 days' END)
                      AT TIME ZONE COALESCE(l.timezone, b.timezone, 'UTC'))
              ORDER BY sh.start_time DESC LIMIT 1) AS containing_close_at,
            (SELECT ((sh.shift_date + sh.end_time
                       + CASE WHEN sh.end_time <= sh.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0 days' END)
                      AT TIME ZONE COALESCE(l.timezone, b.timezone, 'UTC'))
               FROM business_staff_shifts sh
              WHERE sh.business_id = te.business_id
                AND sh.user_id = te.user_id
                AND sh.shift_date IN (te.entry_date, te.entry_date - 1)
                AND sh.published_at IS NOT NULL
                AND sh.cancelled_at IS NULL
                AND sh.location_id IS NOT DISTINCT FROM te.location_id
                AND ((sh.shift_date + sh.end_time
                       + CASE WHEN sh.end_time <= sh.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0 days' END)
                      AT TIME ZONE COALESCE(l.timezone, b.timezone, 'UTC')) > te.clock_in_at
              ORDER BY ((sh.shift_date + sh.end_time
                       + CASE WHEN sh.end_time <= sh.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0 days' END)
                      AT TIME ZONE COALESCE(l.timezone, b.timezone, 'UTC')) ASC LIMIT 1) AS fallback_close_at
       FROM business_time_entries te
       JOIN businesses b ON b.id = te.business_id
       LEFT JOIN restaurant_locations l ON l.id = te.location_id
       LEFT JOIN users u ON u.id = te.user_id
      WHERE te.clock_in_at IS NOT NULL
        AND te.clock_out_at IS NULL
        AND te.voided_at IS NULL
        AND ($1::int IS NULL OR te.business_id = $1)
        AND te.clock_in_at <= $2::timestamptz
      ORDER BY te.clock_in_at ASC, te.id ASC
      LIMIT $3`,
    [businessId, graceCutoff.toISOString(), CLOSEOUT_BATCH_LIMIT]
  );

  const closed = [];
  let notified = 0;
  let notifyErrors = 0;
  const errors = [];

  for (const entry of open) {
    const clockInMs = new Date(entry.clock_in_at).getTime();
    // The close time is the containing shift's end when one exists,
    // else the fallback shift end (#44), else the 12-hour cap. A
    // close time at or before clock-in is not a real close time: the
    // cap applies instead of closing the punch in the past.
    const containingAt = entry.containing_close_at ? new Date(entry.containing_close_at) : null;
    const fallbackAt = entry.fallback_close_at ? new Date(entry.fallback_close_at) : null;
    let closeAt = containingAt && !Number.isNaN(containingAt.getTime())
      ? containingAt
      : fallbackAt && !Number.isNaN(fallbackAt.getTime()) ? fallbackAt : null;
    let reason = closeAt ? 'auto_close_shift_end' : 'auto_close_12h_cap';
    if (!closeAt || closeAt.getTime() <= clockInMs) {
      closeAt = new Date(clockInMs + AUTO_CLOSE_CAP_HOURS * 3600 * 1000);
      reason = 'auto_close_12h_cap';
    }
    // Still inside the grace window for this close time: leave it open.
    if (closeAt.getTime() > graceCutoff.getTime()) continue;

    // Each entry closes in its own transaction. With a fence the lease
    // is re-verified inside the transaction (fence.fencedTransaction),
    // so a stale worker cannot commit a close after lease loss; without
    // one the raw-pool transaction runs as before. The close commits
    // before the manager is notified: notification failure never rolls
    // a close back.
    let closedEntry = null;
    try {
      closedEntry = await runEntryTransaction({ db, fence }, async (client) => {
        const { rows: locked } = await client.query(
          `SELECT * FROM business_time_entries
            WHERE id = $1 AND business_id = $2 AND clock_out_at IS NULL AND voided_at IS NULL
            FOR UPDATE`,
          [entry.id, entry.business_id]
        );
        if (!locked.length) return null; // closed or voided concurrently; nothing to do.
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
        if (!updated) return null;
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
        return {
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
      });
    } catch (err) {
      // Money flows W4: a lost lease is not one failed entry. The
      // per-entry fenced transaction refuses the close after lease
      // loss; rethrow so the job aborts with { fenced: true }
      // instead of walking the rest of the batch recording one
      // spurious error per entry and returning normally.
      if (err instanceof LeaseLostError) throw err;
      errors.push({ entryId: Number(entry.id), error: err.message });
      logger.warn('Punch closeout: failed to close entry', { entryId: entry.id, error: err.message });
      continue;
    }
    if (!closedEntry) continue;
    closed.push(closedEntry);
    if (notify) {
      try {
        const result = await notifyManagers(handle, entry.business_id, closedEntry);
        notified += result.notified;
        notifyErrors += result.notifyErrors;
      } catch (err) {
        // Money flows W4: see the per-entry catch above — a lease
        // lost at the notify step aborts the sweep, it is not a
        // failed notification.
        if (err instanceof LeaseLostError) throw err;
        notifyErrors += 1;
        logger.warn('Punch closeout: manager notification failed', { businessId: entry.business_id, entryId: entry.id, error: err.message });
      }
    }
  }

  // Missing punches (item 52): published shifts from the preceding
  // business day, computed per store timezone, that have no time
  // entry at all. The yesterday-only window gives the once-only
  // property naturally: older dates are never notified, and a shift
  // with an entry (voided entries do not count) is never flagged.
  // Cancelled shifts are never flagged. This is best-effort like the
  // close notifications: a failure here is recorded, never allowed
  // to fail the closeout above.
  // Background-jobs audit #48: the select is capped at
  // CLOSEOUT_BATCH_LIMIT rows, deterministically ordered, like the
  // stale-entries select. Unlike that select, notifying a shift does
  // NOT remove it from this result set (the shift row is unchanged;
  // only the notification delivery_key dedupes the send), so on a day
  // with more than 500 missing shifts the same oldest 500 recur every
  // run and shifts beyond the cap are never flagged that day. The cap
  // still bounds the run; making the select skip already-notified
  // shifts (e.g. a NOT EXISTS on the notifications delivery_key) is
  // a follow-up, not part of this fix.
  const missing = [];
  let missingNotified = 0;
  let missingNotifyErrors = 0;
  try {
    const { rows: unpunched } = await handle.query(
      `SELECT sh.*,
              COALESCE(l.timezone, b.timezone, 'UTC') AS tz,
              b.business_name AS business_name,
              COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS employee_name
         FROM business_staff_shifts sh
         JOIN businesses b ON b.id = sh.business_id
         LEFT JOIN restaurant_locations l ON l.id = sh.location_id
         LEFT JOIN users u ON u.id = sh.user_id
        WHERE sh.published_at IS NOT NULL
          AND sh.cancelled_at IS NULL
          AND ($1::int IS NULL OR sh.business_id = $1)
          AND sh.shift_date = ((($2::timestamptz AT TIME ZONE COALESCE(l.timezone, b.timezone, 'UTC'))::date - 1))
          AND NOT EXISTS (
            SELECT 1 FROM business_time_entries te
             WHERE te.business_id = sh.business_id
               AND te.user_id = sh.user_id
               AND te.entry_date = sh.shift_date
               AND te.location_id IS NOT DISTINCT FROM sh.location_id
               AND te.voided_at IS NULL
          )
        ORDER BY sh.business_id, sh.shift_date, sh.start_time, sh.id ASC
        LIMIT $3`,
      [businessId, new Date(now).toISOString(), CLOSEOUT_BATCH_LIMIT]
    );
    for (const shift of unpunched) {
      const missingPunch = {
        shiftId: Number(shift.id),
        businessId: Number(shift.business_id),
        userId: shift.user_id,
        employeeName: shift.employee_name || null,
        businessName: shift.business_name || null,
        shiftDate: shift.shift_date instanceof Date
          ? shift.shift_date.toISOString().slice(0, 10)
          : String(shift.shift_date || '').slice(0, 10),
        startTime: String(shift.start_time || '').slice(0, 5),
        endTime: String(shift.end_time || '').slice(0, 5),
      };
      missing.push(missingPunch);
      if (notify) {
        const result = await notifyMissingPunch(handle, shift.business_id, missingPunch);
        missingNotified += result.notified;
        missingNotifyErrors += result.notifyErrors;
      }
    }
  } catch (err) {
    // Money flows W4: a lost lease aborts the sweep; it is not a
    // failed missing-punch check.
    if (err instanceof LeaseLostError) throw err;
    errors.push({ missingPunchCheck: true, error: err.message });
    logger.warn('Punch closeout: missing-punch check failed', { error: err.message });
  }

  return { closed, notified, notifyErrors, missing, missingNotified, missingNotifyErrors, errors };
}

module.exports = { closeStalePunches, notifyCloseoutFailure, AUTO_CLOSE_CAP_HOURS, STALE_GRACE_MINUTES, CLOSEOUT_BATCH_LIMIT };
