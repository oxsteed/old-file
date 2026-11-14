const { assertScopedLocation } = require('../services/restaurantStoreBoundary');
const crypto = require('crypto');
const workforce = require('../services/restaurantWorkforceScope');
const { payrollLocation } = require('../services/restaurantPayrollLocation');
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');
const laborJurisdiction = require('../services/laborJurisdictionRules');
// Phase 4 Track A: shared conflict validation (overlap, approved
// time-off, availability warnings, minor limits) for create/update/
// swap approval. Blocking vs warning is decided in that module.
const { validateShift } = require('../services/shiftConflictValidation');
// Phase 4 Track B: PTO balances + accrual, copy-week/templates, and
// the scheduled-cost forecast. The forecast is a projection only; it
// never writes pay lines.
const pto = require('../services/ptoBalances');
const { copyCandidates } = require('../services/scheduleCopy');
const { computeScheduleForecast } = require('../services/scheduleForecast');
const { getLaborPolicy } = require('../services/restaurantPayrollService');
// Phase 2 punch integrity (goal goal_a0fc7c0f0394): hours are computed
// from epoch instants (DST-correct) in one shared module, and the
// close-of-day sweep lives in restaurantPunchCloseout.js.
const { breakSeconds, computedHours, haversineMeters, finiteCoordinate } = require('../services/restaurantPunchHours');
const { closeStalePunches } = require('../services/restaurantPunchCloseout');
const { validateStaffPinForRestaurant } = require('../services/restaurantStaffIdentityService');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
// Phase 7 (gap 17): break attestation at clock-out. The attestation is
// evidence only — the premium still prices from the punch record in
// restaurantPayrollService.tierRows; this module only records the
// employee's statement and reports what the record already owes.
const breakAttestationService = require('../services/restaurantBreakAttestation');

// Shifts
//
// Review P1-5-F02: the StaffScheduler write path must produce rows the
// booking slot engine reads. business_staff_shifts stores
// (shift_date DATE, start_time TIME, end_time TIME, role_label) — see
// migration 238 — so this controller converts the form's
// shift_start/shift_end wall-clock datetimes into that shape on write, and
// derives shift_start/shift_end back on read so the existing client keeps
// working. Shifts are keyed on user_id: the slot engine only treats a
// staff member as shift-bound when shifts carry their user id, so user_id
// is required (never null).
const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

// Parse two wall-clock datetimes into the (shift_date, start_time, end_time)
// shape the table and the slot engine use. The components are taken
// verbatim (no timezone conversion): what the manager types is the
// business-local wall clock the engine interprets.
function toShiftParts(shiftStart, shiftEnd) {
  const s = String(shiftStart || '').match(WALL_CLOCK_RE);
  const e = String(shiftEnd || '').match(WALL_CLOCK_RE);
  if (!s || !e) return { error: 'shift_start and shift_end must be valid datetimes (YYYY-MM-DDTHH:MM)' };
  const startMs = Date.UTC(+s[1], +s[2] - 1, +s[3], +s[4], +s[5], +(s[6] || 0));
  const endMs = Date.UTC(+e[1], +e[2] - 1, +e[3], +e[4], +e[5], +(e[6] || 0));
  if (endMs <= startMs) return { error: 'shift_end must be after shift_start' };
  if (endMs - startMs > 24 * 3600 * 1000) {
    return { error: 'Shifts cannot span more than 24 hours' };
  }
  const pad = (n) => String(n).padStart(2, '0');
  return {
    shiftDate: `${s[1]}-${s[2]}-${s[3]}`,
    startTime: `${s[4]}:${s[5]}:${s[6] || '00'}`,
    endTime: `${e[4]}:${e[5]}:${e[6] || '00'}`,
  };
}

async function assertShiftMember(businessId, userId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM business_members WHERE business_id = $1 AND member_id = $2 AND status = 'active'
      UNION SELECT 1 FROM businesses WHERE id = $1 AND user_id = $2`,
    [businessId, userId]
  );
  return rows.length > 0;
}

// node-pg returns DATE as a Date object and TIME as 'HH:MM:SS' text;
// normalize both to wall-clock components for the datetime-local form.
function wallDatePart(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
function wallTimePart(v) {
  if (v instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  }
  return String(v).slice(0, 8);
}

exports.listShifts = async (req, res, next) => {
  const { businessId } = req.params;
  const { user_id, from, to } = req.query;
  try {
    const storeContext = await workforce.context(req);
    let where = 'WHERE s.business_id = $1';
    const params = [businessId];
    let p = 2;
    if (user_id) { where += ` AND s.user_id = $${p++}`; params.push(user_id); }
    if (from) { where += ` AND s.shift_date >= $${p++}::date`; params.push(from); }
    if (to)   { where += ` AND s.shift_date <= $${p++}::date`; params.push(to); }
    // S-04: drafts stay manager-only until published. Managers see every
    // row with its published flag; everyone else sees published shifts.
    const manager = await isBusinessManager(req, businessId, req.user.id);
    if (!manager) where += ' AND s.published_at IS NOT NULL';
    // Item 61: cancelled (soft-deleted) shifts never list as active.
    where += ' AND s.cancelled_at IS NULL';
    where += workforce.clause(storeContext,'s',params);
    const rows = await pool.query(
      `SELECT s.*,
              u.email AS user_email,
              COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS user_name,
              -- Derived wall-clock datetimes for the existing client, which
              -- renders new Date(shift_start)/new Date(shift_end).
              (s.shift_date::text || 'T' || s.start_time::text) AS shift_start,
              (s.shift_date::text || 'T' || s.end_time::text) AS shift_end,
              s.role_label AS role,
              (s.published_at IS NOT NULL) AS published
         FROM business_staff_shifts s
         -- LEFT JOIN: S-11 keeps shift rows after an account hard-delete
         -- (user_id SET NULL); the row must stay visible as history.
         LEFT JOIN users u ON s.user_id = u.id
         ${where} ORDER BY s.shift_date, s.start_time`,
      params
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
};

exports.createShift = async (req, res, next) => {
  const { businessId } = req.params;
  const { user_id, shift_start, shift_end, role, notes } = req.body;
  if (!user_id || !shift_start || !shift_end) {
    return res.status(400).json({ error: 'user_id, shift_start, and shift_end are required' });
  }
  const parts = toShiftParts(shift_start, shift_end);
  if (parts.error) {
    return res.status(400).json({ error: parts.error });
  }
  try {
    const storeContext = await workforce.context(req);
    const locationId = await payrollLocation(businessId, req.user?.id, req.body.locationId ?? req.body.location_id ?? null);
    await workforce.assertStaff(storeContext,user_id,pool,locationId);
    if (!await assertShiftMember(businessId, user_id)) {
      return res.status(400).json({ error: 'User is not a member of this business' });
    }
    // Phase 4 Track A: blocking conflicts 409 with structured violations;
    // availability warnings ride along with the created shift instead.
    const validation = await validateShift(pool, {
      businessId, userId: user_id,
      shiftDate: parts.shiftDate, startTime: parts.startTime, endTime: parts.endTime,
      locationId,
    });
    if (validation.violations.length) {
      return res.status(409).json({
        error: 'shift_conflicts', code: 'shift_conflicts',
        violations: validation.violations, warnings: validation.warnings,
      });
    }
    const row = await pool.query(
      `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, role_label, notes, location_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [businessId, user_id, parts.shiftDate, parts.startTime, parts.endTime, role || null, notes || null, locationId]
    );
    res.status(201).json(validation.warnings.length
      ? { ...row.rows[0], warnings: validation.warnings }
      : row.rows[0]);
  } catch (err) { next(err); }
};

exports.updateShift = async (req, res, next) => {
  const { businessId, shiftId } = req.params;
  const { shift_start, shift_end, role, notes } = req.body;
  try {
    const storeContext = await workforce.context(req);
    await workforce.assertRecord(storeContext,'business_staff_shifts',shiftId);
    // S-20: the prior row is kept for the Fair Workweek change record.
    const current = await pool.query(
      'SELECT * FROM business_staff_shifts WHERE id = $1 AND business_id = $2 AND cancelled_at IS NULL',
      [shiftId, businessId]
    );
    if (!current.rows.length) return res.status(404).json({ error: 'Not found' });
    const beforeRow = current.rows[0];
    let shiftDate, startTime, endTime;
    if (shift_start || shift_end) {
      const cur = beforeRow;
      const curStart = `${wallDatePart(cur.shift_date)}T${wallTimePart(cur.start_time)}`;
      const curEnd = `${wallDatePart(cur.shift_date)}T${wallTimePart(cur.end_time)}`;
      const parts = toShiftParts(shift_start || curStart, shift_end || curEnd);
      if (parts.error) return res.status(400).json({ error: parts.error });
      ({ shiftDate, startTime, endTime } = parts);
    }
    // Phase 4 Track A: validate only when the time actually moves, so a
    // role/notes-only edit is never blocked by a pre-existing conflict,
    // and the shift being edited never conflicts with itself.
    let validation = null;
    if (shiftDate !== undefined
      && (shiftDate !== wallDatePart(beforeRow.shift_date)
        || startTime !== wallTimePart(beforeRow.start_time)
        || endTime !== wallTimePart(beforeRow.end_time))) {
      validation = await validateShift(pool, {
        businessId, userId: beforeRow.user_id,
        shiftDate, startTime, endTime,
        excludeShiftId: shiftId,
        locationId: beforeRow.location_id ?? null,
        restaurantId: beforeRow.restaurant_id ?? null,
      });
      if (validation.violations.length) {
        return res.status(409).json({
          error: 'shift_conflicts', code: 'shift_conflicts',
          violations: validation.violations, warnings: validation.warnings,
        });
      }
    }
    const row = await pool.query(
      `UPDATE business_staff_shifts
          SET shift_date = COALESCE($1, shift_date),
              start_time = COALESCE($2, start_time),
              end_time   = COALESCE($3, end_time),
              role_label = COALESCE($4, role_label),
              notes      = COALESCE($5, notes)
        WHERE id = $6 AND business_id = $7 AND cancelled_at IS NULL RETURNING *`,
      [shiftDate || null, startTime || null, endTime || null, role || null, notes || null, shiftId, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    // S-20: a change to a published shift is Fair Workweek evidence.
    const scheduleChange = await recordScheduleChange(req, { businessId, before: beforeRow, after: row.rows[0], changeType: 'edited' });
    const updated = scheduleChange ? { ...row.rows[0], schedule_change: scheduleChange } : row.rows[0];
    res.json(validation?.warnings?.length ? { ...updated, warnings: validation.warnings } : updated);
  } catch (err) { next(err); }
};

exports.deleteShift = async (req, res, next) => {
  const { businessId, shiftId } = req.params;
  try {
    const storeContext = await workforce.context(req);
    await workforce.assertRecord(storeContext,'business_staff_shifts',shiftId);
    // Item 61: soft-delete. The row survives with cancelled_at set so
    // the shift itself (not just the Fair Workweek before_state in the
    // schedule-change row) stays auditable. An already-cancelled shift
    // matches no row and takes the same path as a missing one: success
    // with no schedule_change.
    const { rows: [deleted] } = await pool.query(
      `UPDATE business_staff_shifts SET cancelled_at = NOW()
        WHERE id=$1 AND business_id=$2 AND cancelled_at IS NULL RETURNING *`,
      [shiftId, businessId]
    );
    const scheduleChange = deleted ? await recordScheduleChange(req, { businessId, before: deleted, after: null, changeType: 'deleted' }) : null;
    res.json({ success: true, ...(scheduleChange ? { schedule_change: scheduleChange } : {}) });
  } catch (err) { next(err); }
};

// Time entries — one punch model (S-05).
//
// The pre-S-05 handlers read and wrote clock_in / clock_out / notes /
// updated_at, none of which exist on business_time_entries (migration
// 238, punch columns added by 948), so every call threw a 500 against a
// real database; the unit test mocked the pool and could not see it.
// Punches now live in clock_in_at / clock_out_at / breaks, hours_worked
// is computed at clock-out (net of breaks), edits are append-only rows in
// business_time_entry_edits with a reason and a manager approver, and
// entries are voided, never hard-deleted. Manual-hours entries created
// through createManualTimeEntry below carry entry_date + hours_worked
// and no punch timestamps.

const PUNCH_SOURCES = new Set(['web', 'pos', 'kiosk', 'mobile', 'manual']);

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function parseAvailabilityWindow(window) {
  const day = Number(window?.day_of_week ?? window?.dayOfWeek);
  const start = String(window?.start_time ?? window?.startTime ?? '');
  const end = String(window?.end_time ?? window?.endTime ?? '');
  if (!Number.isInteger(day) || day < 0 || day > 6 || !TIME_RE.test(start) || !TIME_RE.test(end)) {
    return { error: 'day_of_week must be 0-6 and start_time/end_time must be valid times' };
  }
  const startValue = start.length === 5 ? `${start}:00` : start;
  const endValue = end.length === 5 ? `${end}:00` : end;
  if (startValue >= endValue) return { error: 'end_time must be after start_time' };
  return {
    day,
    start: startValue,
    end: endValue,
    notes: window?.notes ? String(window.notes).slice(0, 500) : null,
  };
}

async function assertBusinessMember(businessId, userId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM business_members WHERE business_id=$1 AND member_id=$2 AND status='active'
     UNION SELECT 1 FROM businesses WHERE id=$1 AND user_id=$2`,
    [businessId, userId]
  );
  return rows.length > 0;
}

exports.listAvailability = async (req, res, next) => {
  const { businessId } = req.params;
  const requestedUserId = req.query.user_id || req.user.id;
  try {
    const storeContext = await workforce.context(req);
    if(String(requestedUserId)!==String(req.user.id))await workforce.assertStaff(storeContext,requestedUserId);
    if (String(requestedUserId) !== String(req.user.id)
      && !await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can view another staff member availability' });
    }
    const { rows } = await pool.query(
      `SELECT id, business_id, user_id, day_of_week, start_time, end_time, notes
         FROM business_staff_availability
        WHERE business_id=$1 AND user_id=$2
        ORDER BY day_of_week, start_time, id`,
      [businessId, requestedUserId]
    );
    return res.json({ user_id: requestedUserId, windows: rows });
  } catch (err) { return next(err); }
};

exports.replaceAvailability = async (req, res, next) => {
  const { businessId } = req.params;
  const windows = Array.isArray(req.body?.windows) ? req.body.windows : null;
  if (!windows) return res.status(400).json({ error: 'windows must be an array' });
  if (windows.length > 42) return res.status(400).json({ error: 'A maximum of 42 availability windows is allowed' });
  const parsed = windows.map(parseAvailabilityWindow);
  const invalid = parsed.find((item) => item.error);
  if (invalid) return res.status(400).json({ error: invalid.error });
  const dedupe = new Set();
  for (const item of parsed) {
    const key = `${item.day}:${item.start}:${item.end}`;
    if (dedupe.has(key)) return res.status(400).json({ error: 'Duplicate availability windows are not allowed' });
    dedupe.add(key);
  }
  try {
    if (!await assertBusinessMember(businessId, req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this business' });
    }
    const rows = await withTransaction(pool, async (client) => {
      await client.query(
        'DELETE FROM business_staff_availability WHERE business_id=$1 AND user_id=$2',
        [businessId, req.user.id]
      );
      for (const item of parsed) {
        await client.query(
          `INSERT INTO business_staff_availability
             (business_id, user_id, day_of_week, start_time, end_time, notes)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [businessId, req.user.id, item.day, item.start, item.end, item.notes]
        );
      }
      const result = await client.query(
        `SELECT id, business_id, user_id, day_of_week, start_time, end_time, notes
           FROM business_staff_availability
          WHERE business_id=$1 AND user_id=$2
          ORDER BY day_of_week, start_time, id`,
        [businessId, req.user.id]
      );
      return result.rows;
    });
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.staff.availability.replaced',
      target_type: 'staff_availability',
      target_id: req.user.id,
      after_state: { windows: rows },
    });
    return res.json({ user_id: req.user.id, windows: rows });
  } catch (err) { return next(err); }
};

exports.listShiftSwapRequests = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    const storeContext = await workforce.context(req);
    const manager = await isBusinessManager(req, businessId, req.user.id);
    const params = [businessId];
    let filter = '';
    if (!manager) {
      params.push(req.user.id);
      filter = ' AND (r.requester_user_id=$2 OR r.target_user_id=$2)';
    }
    filter += workforce.clause(storeContext,'s',params);
    const { rows } = await pool.query(
      `SELECT r.*, s.shift_date, s.start_time, s.end_time, s.role_label, s.user_id AS assigned_user_id
         FROM business_shift_swap_requests r
         JOIN business_staff_shifts s ON s.id=r.shift_id AND s.business_id=r.business_id AND s.cancelled_at IS NULL
        WHERE r.business_id=$1${filter}
        ORDER BY r.created_at DESC, r.id DESC`,
      params
    );
    return res.json({ requests: rows });
  } catch (err) { return next(err); }
};

exports.createShiftSwapRequest = async (req, res, next) => {
  const { businessId, shiftId } = req.params;
  const targetUserId = req.body?.target_user_id || req.body?.targetUserId || null;
  const note = req.body?.note ? String(req.body.note).slice(0, 1000) : null;
  try {
    const storeContext = await workforce.context(req);
    const scopedShift=await workforce.assertRecord(storeContext,'business_staff_shifts',shiftId);
    const { rows: shifts } = await pool.query(
      `SELECT id, user_id, shift_date, start_time, end_time
         FROM business_staff_shifts WHERE id=$1 AND business_id=$2 AND cancelled_at IS NULL`,
      [shiftId, businessId]
    );
    const shift = shifts[0];
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    await workforce.assertStaff(storeContext,targetUserId,pool,scopedShift?.location_id);
    const manager = await isBusinessManager(req, businessId, req.user.id);
    if (!manager && String(shift.user_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'You can only request a swap for your own shift' });
    }
    if (!targetUserId || String(targetUserId) === String(shift.user_id)) {
      return res.status(400).json({ error: 'A different target staff member is required' });
    }
    if (!await assertBusinessMember(businessId, targetUserId)) {
      return res.status(400).json({ error: 'Target user is not a member of this business' });
    }
    const { rows } = await pool.query(
      `INSERT INTO business_shift_swap_requests
         (business_id, shift_id, requester_user_id, target_user_id, note)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [businessId, shiftId, req.user.id, targetUserId, note]
    );
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.staff.shift_swap.requested',
      target_type: 'shift_swap_request',
      target_id: rows[0]?.id,
      after_state: rows[0],
    });
    return res.status(201).json({ request: rows[0] });
  } catch (err) { return next(err); }
};

async function decideShiftSwap(req, res, next, status) {
  const { businessId, requestId } = req.params;
  try {
    const storeContext = await workforce.context(req);
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can decide shift swaps' });
    }
    const result = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT r.*, s.user_id AS assigned_user_id,
                s.shift_date::text AS shift_date,
                s.start_time::text AS start_time, s.end_time::text AS end_time,
                s.location_id, s.restaurant_id
           FROM business_shift_swap_requests r
           JOIN business_staff_shifts s ON s.id=r.shift_id AND s.business_id=r.business_id AND s.cancelled_at IS NULL
          WHERE r.id=$1 AND r.business_id=$2 FOR UPDATE`,
        [requestId, businessId]
      );
      const swap = rows[0];
      if (!swap) return { missing: true };
      const scopedShift=await workforce.assertRecord(storeContext,'business_staff_shifts',swap.shift_id,client);
      // Phase 3 Track C: approval requires target acceptance first.
      // 'requested' means the target has not answered yet; 'target_accepted'
      // means the target agreed and the request waits on a manager. A
      // manager may reject at either pending stage, but may only approve
      // after the target accepted.
      if (status === 'approved') {
        if (swap.status === 'requested') return { targetPending: true };
        if (swap.status !== 'target_accepted') return { conflict: true };
      } else if (swap.status !== 'requested' && swap.status !== 'target_accepted') {
        return { conflict: true };
      }
      if(status==='approved')await workforce.assertStaff(storeContext,swap.target_user_id,client,scopedShift?.location_id);
      if (status === 'approved') {
        if (!swap.target_user_id) return { noTarget: true };
        // Phase 4 Track A: the reassignment is a shift write for the
        // target, so it gets the same conflict validation as create/
        // update. A blocking violation 409s and the swap stays pending.
        const validation = await validateShift(client, {
          businessId, userId: swap.target_user_id,
          shiftDate: swap.shift_date, startTime: swap.start_time, endTime: swap.end_time,
          excludeShiftId: swap.shift_id,
          locationId: swap.location_id ?? null,
          restaurantId: swap.restaurant_id ?? null,
        });
        if (validation.violations.length) return { validation };
        await client.query(
          `UPDATE business_staff_shifts SET user_id=$1
            WHERE id=$2 AND business_id=$3 AND user_id=$4 AND cancelled_at IS NULL`,
          [swap.target_user_id, swap.shift_id, businessId, swap.assigned_user_id]
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE business_shift_swap_requests
            SET status=$1, decided_by=$2, decided_at=NOW(), updated_at=NOW()
          WHERE id=$3 AND business_id=$4 RETURNING *`,
        [status, req.user.id, requestId, businessId]
      );
      return { request: updated[0], beforeStatus: swap.status };
    });
    if (result.missing) return res.status(404).json({ error: 'Shift swap request not found' });
    if (result.targetPending) return res.status(409).json({ error: 'The target staff member has not accepted this swap yet' });
    if (result.conflict) return res.status(409).json({ error: 'Shift swap request is no longer pending' });
    if (result.noTarget) return res.status(409).json({ error: 'A target staff member is required before approval' });
    if (result.validation) {
      return res.status(409).json({
        error: 'shift_conflicts', code: 'shift_conflicts',
        violations: result.validation.violations, warnings: result.validation.warnings,
      });
    }
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: `business.staff.shift_swap.${status}`,
      target_type: 'shift_swap_request',
      target_id: result.request?.id,
      before_state: { status: result.beforeStatus || 'requested' },
      after_state: result.request,
    });
    return res.json({ request: result.request });
  } catch (err) { return next(err); }
}

// Phase 3 Track C: the named target accepts or declines a swap request.
// Only the target may call this; the requester (and any other staff
// member) gets a 403, and a request that already left 'requested' gets
// a 409. Accept moves the request to 'target_accepted' (pending manager
// decision); decline closes it as 'declined'.
exports.respondShiftSwapRequest = async (req, res, next) => {
  const { businessId, requestId } = req.params;
  const action = req.body?.action || req.body?.response || null;
  if (action !== 'accept' && action !== 'decline') {
    return res.status(400).json({ error: 'action must be accept or decline' });
  }
  try {
    const result = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM business_shift_swap_requests
          WHERE id=$1 AND business_id=$2 FOR UPDATE`,
        [requestId, businessId]
      );
      const swap = rows[0];
      if (!swap) return { missing: true };
      if (String(swap.target_user_id) !== String(req.user.id)) {
        return { forbidden: true };
      }
      if (swap.status !== 'requested') return { conflict: true };
      const nextStatus = action === 'accept' ? 'target_accepted' : 'declined';
      const { rows: updated } = await client.query(
        `UPDATE business_shift_swap_requests
            SET status=$1, target_responded_at=NOW(), updated_at=NOW()
          WHERE id=$2 AND business_id=$3 RETURNING *`,
        [nextStatus, requestId, businessId]
      );
      return { request: updated[0] };
    });
    if (result.missing) return res.status(404).json({ error: 'Shift swap request not found' });
    if (result.forbidden) return res.status(403).json({ error: 'Only the named target can respond to this swap request' });
    if (result.conflict) return res.status(409).json({ error: 'Shift swap request is no longer waiting for the target' });
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: `business.staff.shift_swap.target_${action === 'accept' ? 'accepted' : 'declined'}`,
      target_type: 'shift_swap_request',
      target_id: result.request?.id,
      before_state: { status: 'requested' },
      after_state: result.request,
    });
    return res.json({ request: result.request });
  } catch (err) { return next(err); }
};

exports.approveShiftSwapRequest = (req, res, next) => decideShiftSwap(req, res, next, 'approved');
exports.rejectShiftSwapRequest = (req, res, next) => decideShiftSwap(req, res, next, 'rejected');

exports.computedHours = computedHours;

function presentTimeEntry(entry) {
  if (!entry) return entry;
  return {
    ...entry,
    hours: computedHours(entry),
    break_minutes: Math.round(breakSeconds(entry.breaks, Date.now()) / 60),
    // Phase 2: a system-closed punch was closed by the close-of-day
    // sweep at a documented policy time, not by the employee or a
    // manager. The flag travels with the hours everywhere they are
    // shown so it is never silently treated as a normal clock-out.
    system_closed: entry.system_closed_at != null,
    system_closed_reason: entry.system_closed_reason || null,
    // Legacy client field aliases (StaffScheduler renders clock_in/out).
    clock_in: entry.clock_in_at || null,
    clock_out: entry.clock_out_at || null,
  };
}

async function isBusinessManager(req, businessId, userId) {
  if (req.businessRole) return req.businessRole === 'owner' || req.businessRole === 'manager';
  const { rows } = await pool.query(
    `SELECT 1 FROM business_members WHERE business_id=$1 AND member_id=$2 AND status='active' AND role='manager'
     UNION SELECT 1 FROM businesses WHERE id=$1 AND user_id=$2`,
    [businessId, userId]
  );
  return rows.length > 0;
}

async function loadTimeEntry(businessId, entryId, req) {
  await workforce.assertRecord(await workforce.context(req),'business_time_entries',entryId);
  const { rows } = await pool.query(
    'SELECT * FROM business_time_entries WHERE id=$1 AND business_id=$2',
    [entryId, businessId]
  );
  return rows[0] || null;
}

exports.listTimeEntries = async (req, res, next) => {
  const { businessId } = req.params;
  const { user_id, from, to } = req.query;
  try {
    const storeContext = await workforce.context(req);
    let where = 'WHERE te.business_id = $1 AND te.voided_at IS NULL';
    const params = [businessId];
    let p = 2;
    if (user_id) { where += ` AND te.user_id = $${p++}`; params.push(user_id); }
    // F-22: filter on the stored business-local work date.
    if (from) { where += ` AND COALESCE(te.entry_date, te.clock_in_at::date) >= $${p++}::date`; params.push(from); }
    if (to)   { where += ` AND COALESCE(te.entry_date, te.clock_in_at::date) <= $${p++}::date`; params.push(to); }
    where += workforce.clause(storeContext,'te',params);
    const rows = await pool.query(
      `SELECT te.*,
              COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS user_name
       FROM business_time_entries te
       JOIN users u ON te.user_id = u.id
       ${where} ORDER BY COALESCE(te.clock_in_at, te.entry_date::timestamptz) DESC, te.id DESC`,
      params
    );
    res.json(rows.rows.map(presentTimeEntry));
  } catch (err) { next(err); }
};

// S-04 / N-02: an employee's own punches (the restaurant "My time" card).
// Any active member may read only their own entries; managers keep the
// store-scoped listTimeEntries above. Default window: the last 14 local days.
exports.listMyTimeEntries = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    if (!await assertShiftMember(businessId, req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this business' });
    }
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const from = dateRe.test(String(req.query.from || '')) ? req.query.from : null;
    const to = dateRe.test(String(req.query.to || '')) ? req.query.to : null;
    const { rows } = await pool.query(
      `SELECT te.*
         FROM business_time_entries te
        WHERE te.business_id = $1 AND te.user_id = $2 AND te.voided_at IS NULL
          AND (te.clock_out_at IS NULL AND te.clock_in_at IS NOT NULL
               OR te.entry_date >= COALESCE($3::date, CURRENT_DATE - 14))
          AND ($4::date IS NULL OR te.entry_date <= $4::date)
        ORDER BY te.entry_date DESC, te.id DESC
        LIMIT 100`,
      [businessId, req.user.id, from, to]
    );
    const entries = rows.map(presentTimeEntry);
    const open = entries.find((e) => e.clock_in_at && !e.clock_out_at) || null;
    res.json({ entries, open_entry: open });
  } catch (err) { next(err); }
};

// Manual-hours entries (Phase 4 Track C): the live replacement for
// the retired legacy scheduler's logHours. Mirrors that handler, not
// a redesign: same fields (user_id, entry_date, hours_worked,
// description, location_id), same validation (hours must be > 0 and
// <= 24), same row shape (source='manual', approved_by = the calling
// manager), same S-16 audit row (business.time_entry.logged). The
// created entry flows into computeLabor exactly like a legacy manual
// row: same table, same columns, same voided_at NULL. No
// business_time_entry_edits row on create: the legacy handler wrote
// none either.
exports.createManualTimeEntry = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const storeContext = await workforce.context(req);
    const userId = req.user.id;
    const { user_id, entry_date, hours_worked, description } = req.body;

    if (!await isBusinessManager(req, businessId, userId)) return res.status(403).json({ error: 'Access denied' });
    if (!user_id || !hours_worked) return res.status(400).json({ error: 'user_id and hours_worked required' });

    const memberCheck = await pool.query(
      `SELECT 1 FROM business_members WHERE business_id=$1 AND member_id=$2 AND status='active'
       UNION SELECT 1 FROM businesses WHERE id=$1 AND user_id=$2`,
      [businessId, user_id]
    );
    if (!memberCheck.rows.length) {
      return res.status(400).json({ error: 'User is not a member of this business' });
    }

    const hours = parseFloat(hours_worked);
    if (isNaN(hours) || hours <= 0 || hours > 24) {
      return res.status(400).json({ error: 'hours_worked must be between 0 and 24' });
    }

    const locationId = await payrollLocation(businessId, req.user?.id, req.body.locationId ?? req.body.location_id ?? null);
    await workforce.assertStaff(storeContext, user_id, pool, locationId);
    const { rows } = await pool.query(
      `INSERT INTO business_time_entries (business_id, user_id, entry_date, hours_worked, description, approved_by, source, location_id)
       VALUES ($1,$2,$3,$4,$5,$6,'manual',$7) RETURNING *`,
      [businessId, user_id, entry_date || new Date().toISOString().split('T')[0], hours, description || null, userId, locationId]
    );
    // S-16: time entries feed payroll; creating one is an auditable
    // staff action.
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.time_entry.logged',
      target_type: 'time_entry',
      target_id: rows[0].id,
      after_state: {
        user_id, entry_date: rows[0].entry_date, hours_worked: rows[0].hours_worked,
      },
    });
    res.status(201).json({ entry: rows[0] });
  } catch (err) {
    next(err);
  }
};

// Phase 2 punch integrity: the per-location punch context.
//
// Timezone is a per-location property, never assumed: the store's own
// timezone wins, then the business timezone, then UTC. An unknown or
// invalid name falls back instead of failing the punch (same
// fail-open as the pre-Phase-2 business-timezone fallback).
// Coordinates are the store's own restaurant_locations row: a store
// with coordinates configured opts into geofence enforcement, a store
// without them does not. The restaurant id is needed for the staff
// PIN lookup (PINs are keyed by restaurant).
async function resolvePunchContext(businessId, locationId) {
  if (locationId == null) {
    const { rows: [biz] } = await pool.query(
      'SELECT timezone FROM businesses WHERE id = $1', [businessId]
    );
    return { locationId: null, restaurantId: null, timezone: biz?.timezone || 'UTC', latitude: null, longitude: null };
  }
  const { rows: [row] } = await pool.query(
    `SELECT l.timezone AS loc_tz, l.latitude, l.longitude, l.restaurant_id,
            b.timezone AS biz_tz
       FROM restaurant_locations l
       JOIN food_restaurants r ON r.id = l.restaurant_id
       JOIN businesses b ON b.id = r.business_id
      WHERE l.id = $1 AND b.id = $2`,
    [locationId, businessId]
  );
  if (!row) {
    const { rows: [biz] } = await pool.query(
      'SELECT timezone FROM businesses WHERE id = $1', [businessId]
    );
    return { locationId, restaurantId: null, timezone: biz?.timezone || 'UTC', latitude: null, longitude: null };
  }
  return {
    locationId,
    restaurantId: row.restaurant_id == null ? null : Number(row.restaurant_id),
    timezone: row.loc_tz || row.biz_tz || 'UTC',
    latitude: finiteCoordinate(row.latitude, -90, 90),
    longitude: finiteCoordinate(row.longitude, -180, 180),
  };
}

async function validTimezone(name) {
  if (!name || typeof name !== 'string') return false;
  const { rows } = await pool.query(
    'SELECT 1 FROM pg_timezone_names WHERE name = $1', [name]
  );
  return rows.length > 0;
}

// Phase 2 geofence radius: 200 m around the store. GPS on a phone
// inside a restaurant drifts tens of metres; 200 m absorbs that
// drift (and a punch from the car park) while still catching a punch
// from home. The radius is a documented constant, not per-store
// configuration: no store has asked to tune it, and a tunable radius
// is a way to quietly disable the check.
const PUNCH_GEOFENCE_RADIUS_METERS = 200;

// Phase 7 (gap 17): punch-time minor check. Loads the minor band, the
// day's published shift, hours already worked today / this week, and
// the store's jurisdiction rules, then evaluates them with the pure
// laborJurisdictionRules.evaluateMinorPunch. Returns
// { applies, violations, warnings, blocked }. A missing profile, an
// expired band, or a lookup failure means "no check": the punch
// proceeds (fail-open on the check itself, never on the law — a
// violation that IS found still blocks).
async function checkMinorPunch({ businessId, userId, locationId, restaurantId, timezone }) {
  const none = { applies: false, violations: [], warnings: [], blocked: false };
  try {
    const { rows: [profile] } = await pool.query(
      `SELECT minor_band, minor_until::text AS minor_until
         FROM business_staff_labor_profiles
        WHERE business_id = $1 AND user_id = $2`,
      [businessId, userId]
    );
    if (!profile?.minor_band) return none;
    const { rows: [local] } = await pool.query(
      `SELECT (NOW() AT TIME ZONE $1)::date AS work_date,
              TO_CHAR(NOW() AT TIME ZONE $1, 'HH24:MI') AS clock_in_time`,
      [timezone]
    );
    // node-pg returns a DATE column as a Date object, not a string:
    // String() on it gives 'Sat Nov 07 2026 00:00:00 GMT+0000 ...',
    // which compares greater than any 'YYYY-MM-DD' minor_until and
    // silently skipped the check for every minor with an expiry set
    // (the same Date-object class as the PTO requestDays fix). The
    // work date is the ISO calendar day from here on.
    const workDate = local.work_date instanceof Date
      ? local.work_date.toISOString().slice(0, 10)
      : String(local.work_date).slice(0, 10);
    if (profile.minor_until && workDate > String(profile.minor_until)) return none;
    const { rows: [shift] } = await pool.query(
      `SELECT id, shift_date, start_time, end_time
         FROM business_staff_shifts
        WHERE business_id = $1 AND user_id = $2 AND shift_date = $3::date
          AND published_at IS NOT NULL AND cancelled_at IS NULL
        ORDER BY start_time LIMIT 1`,
      [businessId, userId, workDate]
    );
    // The week's hours are measured inside the jurisdiction's
    // workweek (Sunday by default), not a Monday week.
    const rules = await laborJurisdiction.getJurisdiction(pool, restaurantId, locationId);
    const weekStart = laborJurisdiction.weekStartOf(
      workDate, laborJurisdiction.workweekStartDay(rules)
    );
    const { rows: [hours] } = await pool.query(
      `SELECT
         COALESCE(SUM(hours_worked) FILTER (WHERE entry_date = $3::date), 0)::float8 AS today,
         COALESCE(SUM(hours_worked) FILTER (WHERE entry_date >= $4::date), 0)::float8 AS week
         FROM business_time_entries
        WHERE business_id = $1 AND user_id = $2 AND voided_at IS NULL
          AND hours_worked IS NOT NULL`,
      [businessId, userId, workDate, weekStart]
    );
    return laborJurisdiction.evaluateMinorPunch({
      band: profile.minor_band,
      minorUntil: profile.minor_until,
      rules,
      workDate,
      clockInTime: local.clock_in_time,
      shift: shift ? {
        shift_date: workDate,
        start_time: String(shift.start_time).slice(0, 5),
        end_time: String(shift.end_time).slice(0, 5),
      } : null,
      hoursWorkedToday: Number(hours?.today || 0),
      hoursWorkedThisWeek: Number(hours?.week || 0),
    });
  } catch (err) {
    logger.warn('Minor punch check failed, allowing punch', { businessId, userId, error: err.message });
    return none;
  }
}

exports.clockIn = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    if (!await assertShiftMember(businessId, req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this business' });
    }
    // The store is resolved first: the punch's timezone, geofence
    // centre, and PIN scope all come from it.
    const locationId = await payrollLocation(businessId, req.user?.id, req.body?.locationId ?? req.body?.location_id ?? null);
    const punchCtx = await resolvePunchContext(businessId, locationId);
    const timezone = await validTimezone(punchCtx.timezone) ? punchCtx.timezone : 'UTC';
    const source = PUNCH_SOURCES.has(req.body?.source) ? req.body.source : 'web';
    const latitude = finiteCoordinate(req.body?.latitude, -90, 90);
    const longitude = finiteCoordinate(req.body?.longitude, -180, 180);
    const punchMeta = {
      ip: req.ip || null,
      deviceLabel: typeof req.body?.device_label === 'string' ? req.body.device_label.slice(0, 120) : null,
      latitude,
      longitude,
    };
    // Geofence (opt-in per location: no coordinates on the store row
    // means no enforcement, and a punch that supplies no coordinates
    // is never blocked for the absence alone — a device without
    // location permission cannot prove where it is, and blocking it
    // would strand the shift. The outcome is recorded on the punch
    // either way so a manager can see an unchecked punch).
    if (punchCtx.latitude != null && punchCtx.longitude != null) {
      if (latitude == null || longitude == null) {
        punchMeta.geofence = { checked: false, reason: 'no_coordinates' };
      } else {
        const distance = Math.round(haversineMeters(
          { lat: punchCtx.latitude, lng: punchCtx.longitude },
          { lat: latitude, lng: longitude }
        ));
        const within = distance <= PUNCH_GEOFENCE_RADIUS_METERS;
        punchMeta.geofence = { checked: true, within, distance_meters: distance, radius_meters: PUNCH_GEOFENCE_RADIUS_METERS };
        if (!within) {
          return res.status(403).json({ error: 'Clock-in is outside this store. Clock in at the store to start your shift.' });
        }
      }
    } else {
      punchMeta.geofence = { checked: false, reason: 'not_configured' };
    }
    // Staff PIN (opt-in per employee per store: enforcement only
    // applies where the employee holds an active PIN of their own at
    // this store, or a restaurant-wide one. No PIN configured means
    // current behaviour, no new block. Where one is configured the
    // PIN must be the clocking-in employee's own: a borrowed PIN from
    // a coworker is buddy punching, not proof of presence).
    if (punchCtx.restaurantId != null && locationId != null) {
      const { rows: [pinRow] } = await pool.query(
        `SELECT id FROM restaurant_staff_pins
          WHERE restaurant_id = $1 AND staff_user_id = $2 AND is_active = TRUE
            AND (location_id IS NOT DISTINCT FROM $3::bigint OR location_id IS NULL)
          LIMIT 1`,
        [punchCtx.restaurantId, req.user.id, locationId]
      );
      if (pinRow) {
        const pin = typeof req.body?.staff_pin === 'string' ? req.body.staff_pin : '';
        if (!pin) {
          return res.status(401).json({ error: 'A staff PIN is required to clock in at this store', code: 'staff_pin_required' });
        }
        const verified = await validateStaffPinForRestaurant({
          restaurantId: punchCtx.restaurantId, pin, locationId,
        });
        if (String(verified?.staff?.userId || '') !== String(req.user.id)) {
          return res.status(403).json({ error: 'That staff PIN does not belong to you', code: 'staff_pin_mismatch' });
        }
        punchMeta.staff_pin_verified = true;
        punchMeta.staff_pin_id = verified.pinRow?.id || pinRow.id;
      }
    }
    // Phase 7 (gap 17): punch-time minor check. Schedule warnings do
    // not stop a minor punching in for a non-compliant shift, so the
    // check runs here, against the day's published shift and the
    // jurisdiction rules for this store. A hard violation (outside the
    // legal window, over the daily/weekly hour limit) blocks the punch
    // with the rule named. A missing published shift only flags the
    // punch for a manager: legitimate cover shifts are unscheduled,
    // and stranding a minor over a missing schedule row is not
    // enforcement. An expired minor_until means the band no longer
    // applies and the check is skipped.
    const minorCheck = await checkMinorPunch({
      businessId, userId: req.user.id, locationId,
      restaurantId: punchCtx.restaurantId, timezone,
    });
    if (minorCheck.blocked) {
      return res.status(409).json({
        error: 'This shift is not compliant with the minor labor rules for this store',
        code: 'minor_shift_violation',
        violations: minorCheck.violations,
      });
    }
    if (minorCheck.warnings?.length) {
      // Finding 49: the cap travels on the punch itself (inside
      // punch_meta.minor_flag, which presentTimeEntry returns) so a
      // manager reviewing the entry sees the limit, not just the
      // warning. A cap of 0 still surfaces: the punch was allowed,
      // but the minor has no hours left today.
      punchMeta.minor_flag = {
        warnings: minorCheck.warnings,
        shift_cap_hours: minorCheck.shift_cap_hours ?? null,
      };
    }
    // Atomic clock-in: the partial unique index on open entries is
    // the guard, not a preceding SELECT. ON CONFLICT ... DO NOTHING
    // with the index predicate means two simultaneous clock-ins
    // (web + POS/kiosk on a Friday night) admit exactly one open
    // entry: the loser inserts nothing and gets a clean 409. A
    // voided entry never blocks a new clock-in (the predicate
    // requires voided_at IS NULL).
    const row = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO business_time_entries (business_id, user_id, entry_date, clock_in_at, source, punch_meta, location_id)
         VALUES ($1,$2,
                 -- F-22 / Phase 2: the work date is the business-local
                 -- calendar day of the punch's own store, not the
                 -- database server's date and not another store's.
                 (NOW() AT TIME ZONE $3)::date,
                 NOW(), $4, $5::jsonb, $6)
         ON CONFLICT (business_id, user_id)
           WHERE clock_in_at IS NOT NULL AND clock_out_at IS NULL AND voided_at IS NULL
           DO NOTHING
         RETURNING *`,
        [businessId, req.user.id, timezone, source, JSON.stringify(punchMeta), locationId]
      );
      return rows[0] || null;
    }, 'clock_in');
    if (!row) return res.status(409).json({ error: 'Already clocked in' });
    if (minorCheck.warnings?.length) {
      // The flag is already on the punch (punch_meta.minor_flag); the
      // audit row is the manager-visible copy. It must never fail a
      // clock-in that already succeeded.
      try {
        await logBusinessAction(req, {
          business_id: Number(businessId),
          action: 'business.time_entry.minor_flagged',
          target_type: 'time_entry',
          target_id: row.id,
          after_state: { warnings: minorCheck.warnings },
        });
      } catch (err) {
        logger.warn('Minor punch flag audit failed', { entryId: row.id, error: err.message });
      }
    }
    // Finding 49: the unscheduled minor's shift cap, top-level for
    // the punching client. Only present when the minor check applied;
    // null when the jurisdiction carries no minor max daily hours.
    const body = presentTimeEntry(row);
    if (minorCheck.applies) body.minor_shift_cap = minorCheck.shift_cap_hours ?? null;
    res.status(201).json(body);
  } catch (err) { next(err); }
};

exports.clockOut = async (req, res, next) => {
  const { businessId, entryId } = req.params;
  const { notes } = req.body || {};
  try {
    const entry = await loadTimeEntry(businessId, entryId, req);
    if (!entry || entry.voided_at || !entry.clock_in_at || entry.clock_out_at) {
      return res.status(404).json({ error: 'Active entry not found' });
    }
    // S-05: clockOut previously never checked ownership — anyone could
    // clock out anyone. Only the entry owner, or a manager, may close it.
    const isOwner = String(entry.user_id) === String(req.user.id);
    if (!isOwner && !await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'You can only clock out your own time entry' });
    }
    const now = new Date();
    // A punch closed within the same instant rounds to 0.00, which the
    // hours_worked > 0 check rejects; a closed punch counts at minimum
    // one centihour.
    const hours = Math.max(0.01, computedHours({ ...entry, clock_out_at: now }, now.getTime()));
    // Phase 7 (gap 17) + item 63: the meal-break premium is priced
    // from the punch record here (hours + recorded breaks + jurisdiction
    // rules), never from the attestation. The attestation is evidence
    // only. A jurisdiction lookup failure cannot strand the worker:
    // the shift is treated as not qualifying and the error is reported,
    // and the premium itself is priced again from the punch record at
    // pay time.
    let restaurantId = null;
    let rules = null;
    let rulesError = null;
    try {
      if (entry.location_id != null) {
        const { rows: [loc] } = await pool.query(
          'SELECT restaurant_id FROM restaurant_locations WHERE id = $1',
          [entry.location_id]
        );
        restaurantId = loc?.restaurant_id == null ? null : Number(loc.restaurant_id);
      }
      rules = await laborJurisdiction.getJurisdiction(pool, restaurantId, entry.location_id);
    } catch (err) {
      rulesError = err.message || 'Jurisdiction rules could not be loaded';
    }
    const closedEntry = { ...entry, clock_out_at: now, hours_worked: hours };
    const missedByPunch = rules ? breakAttestationService.punchShowsMissedMeal(closedEntry, rules) : false;
    const premiumHours = missedByPunch
      ? (laborJurisdiction.mealBreakPremiumHours(rules) || 0) : 0;
    const qualifies = rules != null && rules.meal_break_after_minutes != null
      && hours * 60 >= Number(rules.meal_break_after_minutes);
    const body = req.body?.breakAttestation || req.body?.break_attestation || null;
    // Item 63: the owner of a qualifying shift must attest or waive
    // (with a reason) before clock-out completes. A waiver satisfies
    // the requirement, so a worker is never stranded by the prompt. A
    // manager closing someone else's punch cannot attest for them, so
    // they are not blocked; the missing attestation is flagged and can
    // be filed late through the standalone endpoint.
    let existing = null;
    if (isOwner && qualifies) {
      existing = await breakAttestationService.latestAttestation(pool, { businessId, timeEntryId: entry.id });
      if (!existing && !body) {
        return res.status(409).json({
          error: 'break_attestation_required',
          code: 'break_attestation_required',
          message: 'A meal-break statement is required before clock-out. Attest whether you took your break, or waive it with a reason.',
          break_attestation_required: true,
          meal_break_premium_hours: premiumHours,
        });
      }
    }
    // The punch close and the attestation record in one transaction:
    // an invalid attestation (for example a waiver without a reason)
    // fails the clock-out instead of closing the punch and losing the
    // statement, so the worker retries with a complete statement.
    const result = await withTransaction(pool, async (client) => {
      const row = await client.query(
        `UPDATE business_time_entries
            SET clock_out_at=NOW(), hours_worked=$1,
                description = COALESCE($2, description)
          WHERE id=$3 AND business_id=$4 AND clock_out_at IS NULL AND voided_at IS NULL
          RETURNING *`,
        [hours, notes || null, entryId, businessId]
      );
      if (!row.rows.length) return { missing: true };
      const closed = row.rows[0];
      let attestation = existing;
      let disputed = false;
      let attestationError = rulesError;
      if (body && !isOwner) {
        attestationError = 'Only the entry owner can attest to their break';
      } else if (body && isOwner) {
        const recorded = await breakAttestationService.recordBreakAttestation(client, {
          businessId,
          userId: req.user.id,
          timeEntryId: entry.id,
          mealBreakTaken: body.mealBreakTaken ?? body.meal_break_taken,
          restBreakTaken: body.restBreakTaken ?? body.rest_break_taken ?? false,
          waived: body.waived ?? false,
          waiverReason: body.waiverReason ?? body.waiver_reason ?? null,
          attestedBy: req.user.id,
        });
        attestation = recorded.attestation;
        disputed = recorded.disputed;
      }
      return { closed, attestation, disputed, attestationError };
    });
    if (result.missing) return res.status(404).json({ error: 'Active entry not found' });
    res.json({
      ...presentTimeEntry(result.closed),
      break_attestation: result.attestation || null,
      break_attestation_required: qualifies,
      break_attestation_missing: qualifies && !result.attestation,
      meal_break_premium_hours: premiumHours,
      break_attestation_disputed: result.disputed,
      break_attestation_error: result.attestationError || null,
    });
  } catch (err) { next(err); }
};

// Phase 7 (gap 17): file (or correct) a break attestation after
// clock-out, e.g. when the clock-out was closed by a manager and the
// worker attests late. Attestations are append-only (item 43):
// re-posting inserts a new version and readers see only the latest;
// it never rewrites the punch itself.
exports.recordBreakAttestation = async (req, res, next) => {
  try {
    const { businessId, entryId } = req.params;
    const entry = await loadTimeEntry(businessId, entryId, req);
    if (!entry || entry.voided_at || !entry.clock_in_at || !entry.clock_out_at) {
      return res.status(404).json({ error: 'Closed entry not found' });
    }
    if (String(entry.user_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Only the entry owner can attest to their break' });
    }
    const body = req.body || {};
    const recorded = await breakAttestationService.recordBreakAttestation(pool, {
      businessId,
      userId: req.user.id,
      timeEntryId: entry.id,
      mealBreakTaken: body.mealBreakTaken ?? body.meal_break_taken,
      restBreakTaken: body.restBreakTaken ?? body.rest_break_taken ?? false,
      waived: body.waived ?? false,
      waiverReason: body.waiverReason ?? body.waiver_reason ?? null,
      attestedBy: req.user.id,
    });
    res.json({
      attestation: recorded.attestation,
      missed_meal_break: recorded.missedMealBreak,
      meal_break_premium_hours: recorded.mealBreakPremiumHours,
      disputed: recorded.disputed,
    });
  } catch (err) { next(err); }
};

// Break start/end on an open punch. Breaks live in the entry's breaks
// JSONB array as { started_at, ended_at } pairs.
//
// Phase 2: the old code read the row, mutated the array in memory, and
// wrote it back with no lock, so two concurrent break updates (phone
// + kiosk, or a double-tap) could each read the same array and one
// break was silently lost. The read-modify-write now runs inside one
// transaction with SELECT ... FOR UPDATE: the second writer blocks
// until the first commits, then re-reads the updated array. The
// UPDATE also re-checks clock_out_at IS NULL / voided_at IS NULL so
// a punch closed concurrently cannot gain a break afterwards.
exports.punchBreak = async (req, res, next) => {
  const { businessId, entryId } = req.params;
  const action = req.body?.action === 'end' ? 'end' : 'start';
  try {
    const entry = await loadTimeEntry(businessId, entryId, req);
    if (!entry || entry.voided_at || !entry.clock_in_at || entry.clock_out_at) {
      return res.status(404).json({ error: 'Active entry not found' });
    }
    if (String(entry.user_id) !== String(req.user.id) && !await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'You can only manage breaks on your own time entry' });
    }
    const result = await withTransaction(pool, async (client) => {
      const { rows: [locked] } = await client.query(
        `SELECT * FROM business_time_entries
          WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [entryId, businessId]
      );
      if (!locked || locked.voided_at || !locked.clock_in_at || locked.clock_out_at) {
        return { missing: true };
      }
      const breaks = Array.isArray(locked.breaks) ? [...locked.breaks] : [];
      const openBreak = breaks.find((b) => b && !b.ended_at);
      if (action === 'start') {
        if (openBreak) return { conflict: 'A break is already in progress' };
        breaks.push({ started_at: new Date().toISOString(), ended_at: null });
      } else {
        if (!openBreak) return { conflict: 'No break is in progress' };
        openBreak.ended_at = new Date().toISOString();
      }
      const { rows: [updated] } = await client.query(
        `UPDATE business_time_entries SET breaks = $1::jsonb
          WHERE id = $2 AND business_id = $3 AND clock_out_at IS NULL AND voided_at IS NULL
          RETURNING *`,
        [JSON.stringify(breaks), entryId, businessId]
      );
      if (!updated) return { missing: true };
      return { entry: updated };
    }, 'punch_break');
    if (result.missing) return res.status(404).json({ error: 'Active entry not found' });
    if (result.conflict) return res.status(409).json({ error: result.conflict });
    res.json(presentTimeEntry(result.entry));
  } catch (err) { next(err); }
};

// Append-only punch edits: the entry row is updated, but every changed
// field leaves a business_time_entry_edits row with the old and new
// values, the editor, the approving manager (the editor must be one),
// and a mandatory reason. Nothing about the original record is lost.
//
// Finding 10: a manager editing their OWN punch never applies
// directly — that would stamp their own approval. Their edit becomes
// a pending correction request (same shape as an employee request) for
// a different manager to decide, and the entry stays untouched until
// then. Editing another employee's punch still applies directly.
exports.editTimeEntry = async (req, res, next) => {
  const { businessId, entryId } = req.params;
  const { clock_in_at, clock_out_at, description, reason } = req.body || {};
  try {
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can edit time entries' });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'A reason is required to edit a time entry' });
    }
    const entry = await loadTimeEntry(businessId, entryId, req);
    if (!entry || entry.voided_at) return res.status(404).json({ error: 'Entry not found' });
    const changes = [];
    const nextIn = clock_in_at ? new Date(clock_in_at) : null;
    const nextOut = clock_out_at ? new Date(clock_out_at) : null;
    if (clock_in_at !== undefined) {
      if (!nextIn || Number.isNaN(nextIn.getTime())) return res.status(400).json({ error: 'clock_in_at must be a valid datetime' });
      changes.push({ field: 'clock_in_at', oldValue: entry.clock_in_at, newValue: nextIn.toISOString() });
    }
    if (clock_out_at !== undefined) {
      if (clock_out_at !== null && (!nextOut || Number.isNaN(nextOut.getTime()))) {
        return res.status(400).json({ error: 'clock_out_at must be a valid datetime or null' });
      }
      changes.push({ field: 'clock_out_at', oldValue: entry.clock_out_at, newValue: clock_out_at === null ? null : nextOut.toISOString() });
    }
    if (description !== undefined) {
      changes.push({ field: 'description', oldValue: entry.description, newValue: description || null });
    }
    if (!changes.length) return res.status(400).json({ error: 'No changes supplied' });
    const merged = { ...entry };
    for (const change of changes) merged[change.field] = change.newValue;
    if (merged.clock_in_at && merged.clock_out_at
      && new Date(merged.clock_out_at) <= new Date(merged.clock_in_at)) {
      return res.status(400).json({ error: 'clock_out_at must be after clock_in_at' });
    }
    // Finding 10: the entry is the editor's own punch. Do not apply
    // the edit with the editor as approver; file it as a pending
    // correction request for a different manager to decide instead.
    if (String(entry.user_id) === String(req.user.id)) {
      try {
        const { rows } = await pool.query(
          `INSERT INTO business_time_entry_corrections
             (entry_id, business_id, requester_user_id,
              requested_clock_in_at, requested_clock_out_at, clears_clock_out,
              requested_description, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            entryId,
            businessId,
            req.user.id,
            nextIn ? nextIn.toISOString() : null,
            nextOut ? nextOut.toISOString() : null,
            clock_out_at === null,
            description !== undefined ? (description || null) : null,
            String(reason).slice(0, 1000),
          ]
        );
        return res.status(201).json(presentCorrection(rows[0]));
      } catch (err) {
        // 23505: the one-pending-correction-per-entry unique index.
        if (err.code === '23505') {
          return res.status(409).json({ error: 'A correction is already pending for this punch' });
        }
        throw err;
      }
    }
    const hours = merged.clock_in_at && merged.clock_out_at
      ? Math.max(0.01, computedHours(merged))
      : merged.clock_in_at
        ? null // punch reopened by clearing clock_out_at: hours unknown until it closes
        : entry.hours_worked;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await client.query(
        `UPDATE business_time_entries
            SET clock_in_at = COALESCE($1::timestamptz, clock_in_at),
                clock_out_at = CASE WHEN $2::boolean THEN $3::timestamptz ELSE clock_out_at END,
                description = CASE WHEN $9::boolean THEN $4 ELSE description END,
                hours_worked = $5,
                approved_by = $6
          WHERE id=$7 AND business_id=$8 AND voided_at IS NULL
          RETURNING *`,
        [
          merged.clock_in_at ? new Date(merged.clock_in_at).toISOString() : null,
          changes.some((c) => c.field === 'clock_out_at'),
          merged.clock_out_at ? new Date(merged.clock_out_at).toISOString() : null,
          description !== undefined ? (description || null) : null,
          hours,
          req.user.id,
          entryId,
          businessId,
          description !== undefined,
        ]
      );
      if (!row.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Entry not found' });
      }
      for (const change of changes) {
        await client.query(
          `INSERT INTO business_time_entry_edits (entry_id, business_id, editor_user_id, approved_by, field, old_value, new_value, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            entryId,
            businessId,
            req.user.id,
            req.user.id,
            change.field,
            change.oldValue == null ? null : String(change.oldValue instanceof Date ? change.oldValue.toISOString() : change.oldValue),
            change.newValue == null ? null : String(change.newValue),
            String(reason).slice(0, 1000),
          ]
        );
      }
      await client.query('COMMIT');
      return res.json(presentTimeEntry(row.rows[0]));
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
};

// Voiding replaces deletion: the row stays for payroll history, marked
// with who voided it and why, plus an audit row. Voided entries are
// excluded from lists and totals.
exports.voidTimeEntry = async (req, res, next) => {
  const { businessId, entryId } = req.params;
  const { reason } = req.body || {};
  try {
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can void time entries' });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'A reason is required to void a time entry' });
    }
    const entry = await loadTimeEntry(businessId, entryId, req);
    if (!entry || entry.voided_at) return res.status(404).json({ error: 'Entry not found' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await client.query(
        `UPDATE business_time_entries
            SET voided_at = NOW(), voided_by = $1, void_reason = $2
          WHERE id=$3 AND business_id=$4 AND voided_at IS NULL
          RETURNING *`,
        [req.user.id, String(reason).slice(0, 1000), entryId, businessId]
      );
      await client.query(
        `INSERT INTO business_time_entry_edits (entry_id, business_id, editor_user_id, approved_by, field, old_value, new_value, reason)
         VALUES ($1,$2,$3,$4,'voided_at',NULL,NOW()::text,$5)`,
        [entryId, businessId, req.user.id, req.user.id, String(reason).slice(0, 1000)]
      );
      // S-16: voiding a time entry affects payroll evidence; mirror the void
      // into the business audit log (with the entry's state) so it is visible
      // in the Team activity view, not only in the entry edit log. Same
      // payload shape the retired legacy deleteTimeEntry wrote.
      await logBusinessAction(req, {
        business_id: Number(businessId),
        action: 'business.time_entry.voided',
        target_type: 'time_entry',
        target_id: entryId,
        before_state: {
          user_id: entry.user_id,
          entry_date: entry.entry_date,
          hours_worked: entry.hours_worked,
          description: entry.description,
        },
        after_state: { voided: true, void_reason: String(reason).slice(0, 1000) },
      });
      await client.query('COMMIT');
      return res.json(presentTimeEntry(row.rows[0]));
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
};

// ── Phase 2: employee punch-correction requests ────────────────────
// Before this, only a manager could fix a punch (edit with a reason,
// or void). An employee who forgot to clock out, or whose punch has
// the wrong time, had no way to ask.
//
// A request writes a pending business_time_entry_corrections row and
// changes NOTHING on the entry: hours, pay, and every display stay
// exactly as punched until a manager approves. Approval applies the
// change through the same append-only business_time_entry_edits audit
// as a manager edit (editor = the requesting employee, approved_by =
// the deciding manager, reason = the employee's reason), so an
// approved correction is indistinguishable in the audit trail from a
// manager edit and a rejected one leaves no trace on the entry.
// One pending correction per entry: a second request while one is
// undecided is a 409 (partial unique index in the Phase 2 migration).

function presentCorrection(row) {
  if (!row) return row;
  return {
    id: row.id,
    entry_id: row.entry_id,
    business_id: row.business_id,
    requester_user_id: row.requester_user_id,
    requester_name: row.requester_name || null,
    user_name: row.user_name || null,
    entry_date: row.entry_date instanceof Date
      ? row.entry_date.toISOString().slice(0, 10)
      : (row.entry_date ? String(row.entry_date).slice(0, 10) : null),
    current_clock_in_at: row.current_clock_in_at || null,
    current_clock_out_at: row.current_clock_out_at || null,
    requested_clock_in_at: row.requested_clock_in_at || null,
    requested_clock_out_at: row.requested_clock_out_at || null,
    clears_clock_out: row.clears_clock_out === true,
    requested_description: row.requested_description ?? null,
    reason: row.reason,
    status: row.status,
    decided_by: row.decided_by || null,
    decided_at: row.decided_at || null,
    decision_reason: row.decision_reason || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const CORRECTION_SELECT = `
  SELECT c.*,
         COALESCE(ru.display_name_preference, ru.first_name || ' ' || ru.last_name) AS requester_name,
         COALESCE(eu.display_name_preference, eu.first_name || ' ' || eu.last_name) AS user_name,
         te.entry_date, te.clock_in_at AS current_clock_in_at, te.clock_out_at AS current_clock_out_at
    FROM business_time_entry_corrections c
    JOIN business_time_entries te ON te.id = c.entry_id
    LEFT JOIN users ru ON ru.id = c.requester_user_id
    LEFT JOIN users eu ON eu.id = te.user_id`;

exports.requestTimeEntryCorrection = async (req, res, next) => {
  const { businessId, entryId } = req.params;
  const { clock_in_at, clock_out_at, description, reason } = req.body || {};
  try {
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'A reason is required to request a punch correction' });
    }
    if (clock_in_at === undefined && clock_out_at === undefined && description === undefined) {
      return res.status(400).json({ error: 'No correction supplied' });
    }
    const entry = await loadTimeEntry(businessId, entryId, req);
    if (!entry || entry.voided_at) return res.status(404).json({ error: 'Entry not found' });
    // The employee the punch belongs to, or a manager acting for them.
    if (String(entry.user_id) !== String(req.user.id) && !await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'You can only request corrections for your own punches' });
    }
    const nextIn = clock_in_at !== undefined && clock_in_at !== null ? new Date(clock_in_at) : null;
    const nextOut = clock_out_at !== undefined && clock_out_at !== null ? new Date(clock_out_at) : null;
    if ((clock_in_at !== undefined && clock_in_at !== null && (!nextIn || Number.isNaN(nextIn.getTime())))
      || (clock_out_at !== undefined && clock_out_at !== null && (!nextOut || Number.isNaN(nextOut.getTime())))) {
      return res.status(400).json({ error: 'clock_in_at and clock_out_at must be valid datetimes' });
    }
    const mergedIn = nextIn || (entry.clock_in_at ? new Date(entry.clock_in_at) : null);
    const mergedOut = clock_out_at === null ? null : (nextOut || (entry.clock_out_at ? new Date(entry.clock_out_at) : null));
    if (mergedIn && mergedOut && mergedOut <= mergedIn) {
      return res.status(400).json({ error: 'clock_out_at must be after clock_in_at' });
    }
    const { rows } = await pool.query(
      `INSERT INTO business_time_entry_corrections
         (entry_id, business_id, requester_user_id,
          requested_clock_in_at, requested_clock_out_at, clears_clock_out,
          requested_description, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        entryId,
        businessId,
        req.user.id,
        nextIn ? nextIn.toISOString() : null,
        nextOut ? nextOut.toISOString() : null,
        clock_out_at === null,
        description !== undefined ? (description || null) : null,
        String(reason).slice(0, 1000),
      ]
    );
    return res.status(201).json(presentCorrection(rows[0]));
  } catch (err) {
    // 23505: the one-pending-correction-per-entry unique index.
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A correction is already pending for this punch' });
    }
    return next(err);
  }
};

exports.listTimeEntryCorrections = async (req, res, next) => {
  const { businessId } = req.params;
  const status = String(req.query.status || '').toLowerCase();
  try {
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can review punch corrections' });
    }
    const where = ['c.business_id = $1'];
    const params = [businessId];
    if (['pending', 'approved', 'rejected'].includes(status)) {
      where.push(`c.status = $${params.length + 1}`);
      params.push(status);
    }
    const { rows } = await pool.query(
      `${CORRECTION_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC, c.id DESC LIMIT 200`,
      params
    );
    res.json(rows.map(presentCorrection));
  } catch (err) { next(err); }
};

exports.listMyTimeEntryCorrections = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    if (!await assertShiftMember(businessId, req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this business' });
    }
    const { rows } = await pool.query(
      `${CORRECTION_SELECT} WHERE c.business_id = $1 AND c.requester_user_id = $2
        ORDER BY c.created_at DESC, c.id DESC LIMIT 100`,
      [businessId, req.user.id]
    );
    res.json(rows.map(presentCorrection));
  } catch (err) { next(err); }
};

exports.decideTimeEntryCorrection = async (req, res, next) => {
  const { businessId, correctionId } = req.params;
  const decision = req.body?.decision === 'rejected' ? 'rejected' : (req.body?.decision === 'approved' ? 'approved' : null);
  const decisionReason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 1000) : null;
  try {
    if (!decision) {
      return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
    }
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can decide punch corrections' });
    }
    const result = await withTransaction(pool, async (client) => {
      const { rows: [correction] } = await client.query(
        `SELECT * FROM business_time_entry_corrections
          WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [correctionId, businessId]
      );
      if (!correction) return { missing: true };
      if (correction.status !== 'pending') return { conflict: 'This correction has already been decided' };
      // Finding 10: a manager can never decide their own correction
      // request — approval or rejection both need a different manager.
      if (String(correction.requester_user_id) === String(req.user.id)) {
        return { conflict: 'You cannot decide your own punch correction request; a different manager must decide it' };
      }
      const { rows: [entry] } = await client.query(
        `SELECT * FROM business_time_entries WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [correction.entry_id, businessId]
      );
      if (!entry || entry.voided_at) return { conflict: 'The punch no longer exists or was voided' };
      if (decision === 'rejected') {
        const { rows: [updated] } = await client.query(
          `UPDATE business_time_entry_corrections
              SET status = 'rejected', decided_by = $1, decided_at = NOW(),
                  decision_reason = $2, updated_at = NOW()
            WHERE id = $3 AND business_id = $4 RETURNING *`,
          [req.user.id, decisionReason, correctionId, businessId]
        );
        return { correction: updated };
      }
      // Approved: apply exactly the requested changes, through the
      // append-only edit audit, as if the manager had made the edit
      // themselves with the employee as editor.
      const changes = [];
      if (correction.requested_clock_in_at != null) {
        changes.push({ field: 'clock_in_at', oldValue: entry.clock_in_at, newValue: new Date(correction.requested_clock_in_at).toISOString() });
      }
      // A requested clock-out is a new time; an explicit clear
      // (clears_clock_out) reopens the punch. An unrequested clock-out
      // leaves the stored value untouched.
      if (correction.requested_clock_out_at != null) {
        changes.push({ field: 'clock_out_at', oldValue: entry.clock_out_at, newValue: new Date(correction.requested_clock_out_at).toISOString() });
      } else if (correction.clears_clock_out) {
        changes.push({ field: 'clock_out_at', oldValue: entry.clock_out_at, newValue: null });
      }
      if (correction.requested_description !== null && correction.requested_description !== undefined) {
        changes.push({ field: 'description', oldValue: entry.description, newValue: correction.requested_description });
      }
      const merged = { ...entry };
      for (const change of changes) merged[change.field] = change.newValue;
      if (merged.clock_in_at && merged.clock_out_at
        && new Date(merged.clock_out_at) <= new Date(merged.clock_in_at)) {
        return { conflict: 'The requested clock_out_at is not after clock_in_at' };
      }
      const hours = merged.clock_in_at && merged.clock_out_at
        ? Math.max(0.01, computedHours(merged))
        : merged.clock_in_at ? null : entry.hours_worked;
      // The work date follows the (possibly corrected) clock-in, in
      // the punch's own store timezone, same rule as clockIn.
      let entryDate = entry.entry_date;
      if (correction.requested_clock_in_at != null) {
        const ctx = await resolvePunchContext(businessId, entry.location_id);
        const tz = await validTimezone(ctx.timezone) ? ctx.timezone : 'UTC';
        const { rows: [d] } = await client.query(
          'SELECT ($1::timestamptz AT TIME ZONE $2)::date AS d',
          [merged.clock_in_at, tz]
        );
        entryDate = d?.d || entryDate;
      }
      const { rows: [updatedEntry] } = await client.query(
        `UPDATE business_time_entries
            SET clock_in_at = $1::timestamptz,
                clock_out_at = $2::timestamptz,
                description = $3,
                hours_worked = $4,
                entry_date = $5::date,
                approved_by = $6
          WHERE id = $7 AND business_id = $8 AND voided_at IS NULL
          RETURNING *`,
        [
          merged.clock_in_at ? new Date(merged.clock_in_at).toISOString() : null,
          merged.clock_out_at ? new Date(merged.clock_out_at).toISOString() : null,
          merged.description ?? null,
          hours,
          entryDate instanceof Date ? entryDate.toISOString().slice(0, 10) : String(entryDate).slice(0, 10),
          req.user.id,
          entry.id,
          businessId,
        ]
      );
      if (!updatedEntry) return { conflict: 'The punch no longer exists or was voided' };
      for (const change of changes) {
        await client.query(
          `INSERT INTO business_time_entry_edits (entry_id, business_id, editor_user_id, approved_by, field, old_value, new_value, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            entry.id,
            businessId,
            correction.requester_user_id,
            req.user.id,
            change.field,
            change.oldValue == null ? null : String(change.oldValue instanceof Date ? change.oldValue.toISOString() : change.oldValue),
            change.newValue == null ? null : String(change.newValue),
            String(correction.reason).slice(0, 1000),
          ]
        );
      }
      const { rows: [updated] } = await client.query(
        `UPDATE business_time_entry_corrections
            SET status = 'approved', decided_by = $1, decided_at = NOW(),
                decision_reason = $2, updated_at = NOW()
          WHERE id = $3 AND business_id = $4 RETURNING *`,
        [req.user.id, decisionReason, correctionId, businessId]
      );
      return { correction: updated, entry: updatedEntry };
    }, 'decide_time_entry_correction');
    if (result.missing) return res.status(404).json({ error: 'Correction request not found' });
    if (result.conflict) return res.status(409).json({ error: result.conflict });
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: `business.staff.time_entry_correction.${decision}`,
      target_type: 'time_entry_correction',
      target_id: result.correction?.id,
      before_state: { status: 'pending' },
      after_state: result.correction,
    });
    return res.json({
      correction: presentCorrection(result.correction),
      ...(result.entry ? { entry: presentTimeEntry(result.entry) } : {}),
    });
  } catch (err) { next(err); }
};

// Phase 2: the manager-triggered close-of-day check. Same sweep the
// nightly job runs (server/jobs/restaurantPunchCloseoutJob.js): open
// punches past their close time are closed at that close time and
// flagged system-closed, and the manager is notified. Returns the
// entries it closed so the manager can review them before payroll.
exports.closeStaleTimeEntries = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can run the close-of-day punch check' });
    }
    const result = await closeStalePunches({ businessId: Number(businessId) });
    return res.json({
      closed: result.closed.map((e) => presentTimeEntry(e)),
      notified: result.notified,
      notify_errors: result.notifyErrors,
      errors: result.errors,
    });
  } catch (err) { next(err); }
};

// ── Schedule publishing (S-04) ──────────────────────────────────────────
// New shifts are drafts (published_at IS NULL) until a manager publishes
// them. Publishing flips the rows and notifies each assigned staff member
// once (S-17, type + params so the client localizes per S-19). Non-
// managers only ever see published shifts (listShifts filters below); the
// booking slot engine and the payroll scheduled-hours read likewise only
// count published shifts, so a draft never blocks customer bookings or
// inflates planned labor.

const { sendNotification } = require('../services/notificationService');

function shiftSummaryLabel(shifts) {
  if (shifts.length === 1) return shifts[0].role_label || 'Shift';
  return `${shifts.length} shifts`;
}

// node-pg returns DATE columns as Date objects and TIME as text;
// normalize both to an ISO instant for notification params.
function shiftStartIso(shift) {
  const d = shift.shift_date instanceof Date
    ? shift.shift_date.toISOString().slice(0, 10)
    : String(shift.shift_date).slice(0, 10);
  const t = shift.start_time instanceof Date
    ? shift.start_time.toISOString().slice(11, 19)
    : String(shift.start_time).slice(0, 8);
  return new Date(`${d}T${t}Z`).toISOString();
}

exports.publishShifts = async (req, res, next) => {
  const { businessId } = req.params;
  const { from, to, shift_ids, restaurant_id } = req.body || {};
  try {
    const storeContext = await workforce.context(req);
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can publish schedules' });
    }
    const { rows: [biz] } = await pool.query(
      'SELECT id, business_name FROM businesses WHERE id = $1',
      [businessId]
    );
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const params = [businessId];
    let where = 'business_id = $1 AND published_at IS NULL AND cancelled_at IS NULL';
    if (Array.isArray(shift_ids) && shift_ids.length) {
      const ids = shift_ids.map(Number).filter(Number.isFinite);
      if (!ids.length) return res.status(400).json({ error: 'shift_ids must be a non-empty array of ids' });
      params.push(ids);
      where += ` AND id = ANY($${params.length}::bigint[])`;
    }
    if (from) { params.push(from); where += ` AND shift_date >= $${params.length}::date`; }
    if (to) { params.push(to); where += ` AND shift_date <= $${params.length}::date`; }
    if (restaurant_id) {
      const rid = Number(restaurant_id);
      if (!Number.isFinite(rid)) return res.status(400).json({ error: 'restaurant_id must be a number' });
      params.push(rid);
      where += ` AND (restaurant_id = $${params.length} OR restaurant_id IS NULL)`;
    }

    where += workforce.clause(storeContext,'',params);
    // Careers §4.6 step 10: an employer-of-record hire's first shift stays a
    // draft until the EOR partner reports the worker ready to work.
    where += ` AND NOT EXISTS (
      SELECT 1 FROM career_onboarding_runs cr
        JOIN career_offers co ON co.id = cr.offer_id
       WHERE cr.id = business_staff_shifts.career_onboarding_run_id
         AND co.employer_model = 'oxsteed_eor'
         AND NOT EXISTS (SELECT 1 FROM career_eor_assignments ea
                          WHERE ea.application_id = cr.application_id AND ea.status IN ('ready','active')))`;
    // Findings 51 + 30: blocking validation runs BEFORE anything is
    // published, over the exact drafts this publish would flip. Each
    // draft is validated with its own location's rules (validateShift
    // resolves the jurisdiction per location), so a multi-location
    // batch is never judged under one store's rules. Any blocking
    // violation 409s the whole publish, naming the violation(s), and
    // nothing is published; advisory warnings never block. The publish
    // then flips exactly the validated ids, so a draft created
    // concurrently after validation is not swept in unvalidated.
    const { rows: drafts } = await pool.query(
      `SELECT id, user_id, shift_date, start_time, end_time, role_label, location_id, restaurant_id
         FROM business_staff_shifts
        WHERE ${where}
        ORDER BY shift_date, start_time`,
      params
    );
    const blockingViolations = [];
    const publishWarnings = [];
    for (const draft of drafts) {
      const dateStr = draft.shift_date instanceof Date
        ? draft.shift_date.toISOString().slice(0, 10)
        : String(draft.shift_date).slice(0, 10);
      const validation = await validateShift(pool, {
        businessId,
        userId: draft.user_id,
        shiftDate: dateStr,
        startTime: String(draft.start_time).slice(0, 5),
        endTime: String(draft.end_time).slice(0, 5),
        excludeShiftId: draft.id,
        locationId: draft.location_id ?? null,
        restaurantId: draft.restaurant_id ?? null,
      });
      blockingViolations.push(...validation.violations);
      publishWarnings.push(...validation.warnings);
    }
    if (blockingViolations.length) {
      return res.status(409).json({
        error: 'shift_conflicts',
        code: 'shift_conflicts',
        violations: blockingViolations,
        warnings: publishWarnings,
      });
    }
    const draftIds = drafts.map((d) => Number(d.id));
    const { rows: published } = await pool.query(
      `UPDATE business_staff_shifts
          SET published_at = NOW(), published_by = $2
        WHERE id = ANY($1::bigint[]) AND published_at IS NULL AND cancelled_at IS NULL
        RETURNING id, user_id, shift_date, start_time, end_time, role_label, location_id, restaurant_id`,
      [draftIds, req.user.id]
    );

    // One summary notification per assigned staff member (S-17). The
    // crew_shift_published locale strings render from type + params
    // (S-19); restaurantName carries the business name for business-hub
    // schedules.
    const byUser = new Map();
    for (const shift of published) {
      if (!shift.user_id || String(shift.user_id) === String(req.user.id)) continue;
      const list = byUser.get(shift.user_id) || [];
      list.push(shift);
      byUser.set(shift.user_id, list);
    }
    for (const [userId, list] of byUser) {
      list.sort((a, b) => String(a.shift_date).localeCompare(String(b.shift_date)));
      const earliest = list[0];
      // Domain 8 #26: the notice carries a per-business per-batch key
      // (published rows are never re-published, so a silent failed send
      // had no second chance) and a failure is logged with the ids
      // instead of being swallowed by an empty catch.
      const shiftIdsHash = crypto.createHash('sha256')
        .update(list.map((s) => String(s.id)).sort().join(','))
        .digest('hex').slice(0, 16);
      await sendNotification({
        userId,
        type: 'crew_shift_published',
        title: 'New shifts published',
        body: `${list.length} shift${list.length === 1 ? '' : 's'} at ${biz.business_name}`,
        action_url: '/business',
        data: {
          business_id: biz.id,
          shift_ids: list.map((s) => s.id),
          params: {
            count: list.length,
            businessName: biz.business_name,
            restaurantName: biz.business_name,
            shiftLabel: shiftSummaryLabel(list),
            startsAt: shiftStartIso(earliest),
          },
        },
        idempotencyKey: `shift-published:${biz.id}:${shiftIdsHash}`,
      }).catch((err) => {
        logger.warn('Shift publish: staff notification failed', {
          businessId: biz.id, userId, shiftIds: list.map((s) => s.id), error: err.message,
        });
      });
    }

    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.staff.shifts.published',
      target_type: 'staff_schedule',
      after_state: { published: published.length, shift_ids: published.map((s) => s.id) },
    });

    // S-20: native jurisdiction rules are evaluated on every publish and
    // the batch is kept as an immutable version row (evidence). Advisory
    // only: warnings never block the publish (the blocking check above
    // already ran). Finding 30: the batch is evaluated per location,
    // grouped by location_id, each group under its own store's rules.
    let ruleWarnings = [];
    try {
      const pubRestaurantId = Number(restaurant_id) || null;
      const pubLocationId = published.find((s) => s.location_id)?.location_id || null;
      const toDateStr = (d) => {
        if (!d) return null;
        if (d instanceof Date) return d.toISOString().slice(0, 10);
        return String(d).slice(0, 10);
      };
      const dates = published.map((s) => toDateStr(s.shift_date)).filter(Boolean).sort();
      let existingShifts = [];
      if (dates.length) {
        const { rows } = await pool.query(
          `SELECT id, user_id, shift_date::text AS shift_date,
                  start_time::text AS start_time, end_time::text AS end_time,
                  location_id, restaurant_id
             FROM business_staff_shifts
            WHERE business_id = $1 AND published_at IS NOT NULL AND cancelled_at IS NULL
              AND shift_date >= $2::date - INTERVAL '8 days'
              AND shift_date <= $3::date + INTERVAL '1 day'`,
          [businessId, dates[0], dates[dates.length - 1]]
        );
        existingShifts = rows;
      }
      // S-20: minor bands (never a birth date) feed the minor rules.
      const minors = await minorBands(businessId, published.map((s) => s.user_id));
      const evaluated = published.map((s) => {
        const date = toDateStr(s.shift_date);
        const m = minors.get(String(s.user_id));
        return {
          id: s.id, user_id: s.user_id, shift_date: date,
          start_time: s.start_time, end_time: s.end_time,
          location_id: s.location_id ?? null, restaurant_id: s.restaurant_id ?? null,
          ...(m && date < m.until ? { is_minor: true, minor_band: m.band } : {}),
        };
      });
      // Per-location rules, resolved in bulk per restaurant; a shift
      // with no location falls back to the US-FED preset, as before.
      // The same published-shifts context is passed to every group:
      // weekly totals are per person across locations, not per store.
      const locationIds = [...new Set(
        published.map((s) => s.location_id).filter((id) => id != null)
      )].map(Number);
      const rulesByLocation = new Map();
      if (locationIds.length) {
        const { rows: locRows } = await pool.query(
          'SELECT id, restaurant_id FROM restaurant_locations WHERE id = ANY($1::bigint[])',
          [locationIds]
        );
        const byRestaurant = new Map();
        for (const loc of locRows) {
          const list = byRestaurant.get(Number(loc.restaurant_id)) || [];
          list.push(Number(loc.id));
          byRestaurant.set(Number(loc.restaurant_id), list);
        }
        for (const [restId, ids] of byRestaurant) {
          const rulesMap = await laborJurisdiction.getJurisdictions(pool, restId, ids);
          for (const [locId, rules] of rulesMap) rulesByLocation.set(locId, rules);
        }
      }
      const groups = new Map();
      for (const shift of evaluated) {
        const locId = shift.location_id == null ? null : Number(shift.location_id);
        const key = locId == null ? 'none' : locId;
        let group = groups.get(key);
        if (!group) {
          group = {
            rules: locId == null
              ? laborJurisdiction.resolveRules(null)
              : (rulesByLocation.get(locId) || laborJurisdiction.resolveRules(null)),
            shifts: [],
          };
          groups.set(key, group);
        }
        group.shifts.push(shift);
      }
      for (const group of groups.values()) {
        ruleWarnings.push(...laborJurisdiction.evaluateSchedule(group.shifts, { rules: group.rules, existingShifts }));
      }
      await pool.query(
        `INSERT INTO restaurant_schedule_versions
           (business_id, restaurant_id, location_id, published_by,
            shift_ids, shift_count, week_start, week_end, rule_warnings)
         VALUES ($1, $2, $3, $4, $5::bigint[], $6, $7::date, $8::date, $9::jsonb)`,
        [
          businessId, pubRestaurantId, pubLocationId, req.user.id,
          published.map((s) => s.id), published.length,
          dates[0] || null, dates[dates.length - 1] || null,
          JSON.stringify(ruleWarnings),
        ]
      );
    } catch (jurisErr) {
      // Evidence and warnings are best-effort; the publish itself stands.
      ruleWarnings = [];
    }
    return res.json({ published: published.length, shift_ids: published.map((s) => s.id), rule_warnings: ruleWarnings });
  } catch (err) { return next(err); }
};

// ── Labor jurisdiction config (S-20) ────────────────────────────────────
// Native rule parameters per restaurant location. Vendor rule sets stay
// out of scope (Emile's call); this only stores and serves the native
// engine's inputs.

// Jurisdiction codes are the rule table's preset keys: adding a
// preset adds a settable code, with no second list to keep in sync.
const JURISDICTION_CODES = new Set(Object.keys(laborJurisdiction.PRESETS));

// ── S-20: minors and Fair Workweek schedule changes ─────────────────────
async function minorBands(businessId, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  const map = new Map();
  if (!ids.length) return map;
  const { rows } = await pool.query(
    `SELECT user_id, minor_band, minor_until::text AS minor_until FROM business_staff_labor_profiles
      WHERE business_id = $1 AND user_id = ANY($2::uuid[]) AND minor_band IS NOT NULL`,
    [businessId, ids]
  );
  for (const row of rows) map.set(String(row.user_id), { band: row.minor_band, until: row.minor_until });
  return map;
}

const shiftSnapshot = (row) => row && ({
  shift_date: String(row.shift_date instanceof Date ? row.shift_date.toISOString() : row.shift_date).slice(0, 10),
  start_time: String(row.start_time).slice(0, 5), end_time: String(row.end_time).slice(0, 5),
  role_label: row.role_label || null, user_id: row.user_id || null,
});

// A change to a published shift is recorded; inside the notice window an
// employer-initiated change is flagged for predictability pay, and the
// amount is computed at change time: dollar jurisdictions (US-NYC) store
// the statutory amount directly; hours-based jurisdictions price premium
// hours at the employee's wage of record. When the wage is unknown the
// hours are stored with a NULL amount so payroll prices them from the
// current wage at report time instead of silently paying zero.
async function recordScheduleChange(req, { businessId, before, after, changeType }) {
  if (!before?.published_at) return null;
  const rules = await laborJurisdiction.getJurisdiction(pool, Number(before.restaurant_id) || null, Number(before.location_id) || null);
  const employeeRequested = req.body?.employee_requested === true;
  const b = shiftSnapshot(before), a = after ? shiftSnapshot(after) : null;
  if (a && b.shift_date === a.shift_date && b.start_time === a.start_time && b.end_time === a.end_time && b.user_id === a.user_id) return null;
  const verdict = laborJurisdiction.evaluateChange({ before: b, after: a, rules, employeeRequested });
  // Dollar jurisdictions (US-NYC Fair Workweek) price the premium from
  // the tier table: premium_cents is the statutory amount, no wage
  // needed, so it is stored as-is and never repriced. Hours-based
  // jurisdictions price premium_hours at the wage of record here, or
  // leave the amount NULL for payroll to price at report time.
  let premiumHours = verdict.premium_hours;
  let premiumCents = verdict.premium_cents;
  let premiumCurrency = null;
  if (verdict.premium_due && before.user_id) {
    if (premiumCents == null && premiumHours != null) {
      const { rows: [wageRow] } = await pool.query(
        `SELECT COALESCE(
              CASE WHEN lm.pay_rate_period = 'hour' THEN lm.pay_rate_cents END,
              bm.hourly_wage_cents,
              CASE WHEN bm.pay_rate_period = 'hour' THEN bm.pay_rate_cents END
            ) AS hourly_wage_cents
         FROM business_members bm
         LEFT JOIN restaurant_location_memberships lm
           ON lm.membership_id = bm.id AND lm.restaurant_id = $2 AND lm.location_id = $3 AND lm.status = 'active'
        WHERE bm.business_id = $1 AND bm.member_id = $4 AND bm.status = 'active'`,
        [businessId, Number(before.restaurant_id) || null, Number(before.location_id) || null, before.user_id]
      );
      const wage = wageRow?.hourly_wage_cents == null ? null : Number(wageRow.hourly_wage_cents);
      if (wage != null) premiumCents = Math.round(Number(premiumHours) * wage);
    }
    // The currency is recorded for any premium that carries an amount
    // or unpriced hours, dollar or hours-based alike: the pay run
    // scopes stored amounts by this currency and excludes (never
    // silently converts) amounts recorded in another one.
    if (premiumCents != null || premiumHours != null) {
      const { rows: [currencyRow] } = await pool.query(
        `SELECT l.currency_code AS location_currency, r.currency_code AS restaurant_currency
           FROM food_restaurants r
           LEFT JOIN restaurant_locations l ON l.id = $2 AND l.restaurant_id = r.id
          WHERE r.id = $1`,
        [Number(before.restaurant_id) || null, Number(before.location_id) || null]
      );
      premiumCurrency = currencyRow?.location_currency || currencyRow?.restaurant_currency || null;
    }
  }
  const { rows: [row] } = await pool.query(
    `INSERT INTO business_staff_schedule_changes
       (business_id, shift_id, user_id, restaurant_id, location_id, change_type, before_state, after_state,
        hours_before_start, notice_hours, jurisdiction_code, employee_requested, premium_due,
        premium_hours, premium_cents, premium_currency_code, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [businessId, before.id, before.user_id || null, before.restaurant_id || null, before.location_id || null, changeType,
      JSON.stringify(b), a ? JSON.stringify(a) : null, verdict.hours_before_start, verdict.notice_hours, verdict.jurisdiction_code,
      employeeRequested, verdict.premium_due, premiumHours, premiumCents, premiumCurrency, req.user.id]
  );
  return {
    id: Number(row.id), premium_due: row.premium_due, premium_hours: row.premium_hours == null ? null : Number(row.premium_hours),
    premium_cents: row.premium_cents == null ? null : Number(row.premium_cents),
    premium_currency_code: row.premium_currency_code || null,
    notice_hours: row.notice_hours, hours_before_start: Number(row.hours_before_start), jurisdiction_code: row.jurisdiction_code,
  };
}

exports.getLaborProfile = async (req, res, next) => {
  try {
    const { businessId, userId } = req.params;
    if (!await isBusinessManager(req, businessId, req.user.id)) return res.status(403).json({ error: 'Only a manager can view labor profiles' });
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return res.status(400).json({ error: 'Invalid user' });
    const { rows: [row] } = await pool.query(
      'SELECT minor_band, minor_until::text AS minor_until, updated_at FROM business_staff_labor_profiles WHERE business_id=$1 AND user_id=$2',
      [businessId, userId]
    );
    res.json({ profile: row || { minor_band: null, minor_until: null } });
  } catch (err) { next(err); }
};

exports.setLaborProfile = async (req, res, next) => {
  try {
    const { businessId, userId } = req.params;
    if (!await isBusinessManager(req, businessId, req.user.id)) return res.status(403).json({ error: 'Only a manager can set labor profiles' });
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return res.status(400).json({ error: 'Invalid user' });
    if (!await assertBusinessMember(businessId, userId)) return res.status(404).json({ error: 'Staff member not found' });
    const band = req.body?.minor_band ?? null;
    const until = req.body?.minor_until ?? null;
    if (band !== null && !['under_16', 'age_16_17'].includes(band)) return res.status(400).json({ error: 'minor_band must be under_16, age_16_17 or null' });
    if ((band === null) !== (until === null || until === '')) return res.status(400).json({ error: 'minor_until is required with a minor band (and only then)' });
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return res.status(400).json({ error: 'minor_until must be YYYY-MM-DD' });
    const { rows: [before] } = await pool.query('SELECT minor_band, minor_until::text AS minor_until FROM business_staff_labor_profiles WHERE business_id=$1 AND user_id=$2', [businessId, userId]);
    await pool.query(
      `INSERT INTO business_staff_labor_profiles(business_id, user_id, minor_band, minor_until, updated_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (business_id, user_id) DO UPDATE SET minor_band=$3, minor_until=$4, updated_by=$5, updated_at=NOW()`,
      [businessId, userId, band, until || null, req.user.id]
    );
    await logBusinessAction(req, {
      business_id: Number(businessId), action: 'business.staff.labor_profile_updated', target_type: 'user', target_id: userId,
      before_state: before || null, after_state: { minor_band: band, minor_until: until || null },
    });
    res.json({ profile: { minor_band: band, minor_until: until || null } });
  } catch (err) { next(err); }
};

exports.listScheduleChanges = async (req, res, next) => {
  try {
    const storeContext = await workforce.context(req);
    const { businessId } = req.params;
    if (!await isBusinessManager(req, businessId, req.user.id)) return res.status(403).json({ error: 'Only a manager can view schedule changes' });
    const params = [businessId];
    let where = 'business_id = $1';
    const scope = storeContext?.scope;
    if (scope?.mode === 'assigned') { params.push(scope.location_ids); where += ` AND location_id = ANY($${params.length}::bigint[])`; }
    if (req.query.premium === 'true') where += ' AND premium_due';
    const { rows } = await pool.query(
      `SELECT id, shift_id, user_id, location_id, change_type, before_state, after_state, hours_before_start, notice_hours,
              jurisdiction_code, employee_requested, premium_due, premium_hours, premium_cents, premium_currency_code,
              changed_by, created_at
         FROM business_staff_schedule_changes WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    res.json({ changes: rows });
  } catch (err) { next(err); }
};

exports.getLaborJurisdiction = async (req, res, next) => {
  try {
    const storeContext = await workforce.context(req);
    const { businessId } = req.params;
    const restaurantId = Number(req.query.restaurant_id);
    const locationId = Number(req.query.location_id);
    if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0 || !Number.isSafeInteger(locationId) || locationId <= 0) {
      return res.status(400).json({ error: 'restaurant_id and location_id are required' });
    }
    assertScopedLocation(storeContext?.scope,locationId);
    // Scope to the business: the restaurant must belong to it.
    const { rows: [scoped] } = await pool.query(
      `SELECT 1 FROM food_restaurants WHERE id = $1 AND business_id = $2`,
      [restaurantId, businessId]
    );
    if (!scoped) return res.status(404).json({ error: 'Restaurant not found' });
    const rules = await laborJurisdiction.getJurisdiction(pool, restaurantId, locationId);
    const { rows: [stored] } = await pool.query(
      `SELECT * FROM restaurant_labor_jurisdictions
        WHERE restaurant_id = $1 AND location_id = $2 AND is_active LIMIT 1`,
      [restaurantId, locationId]
    );
    res.json({ jurisdiction: rules, configured: !!stored, stored: stored || null, presets: Object.keys(laborJurisdiction.PRESETS).filter((k) => k !== 'CUSTOM') });
  } catch (err) { return next(err); }
};

exports.setLaborJurisdiction = async (req, res, next) => {
  try {
    const storeContext = await workforce.context(req);
    const { businessId } = req.params;
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can set labor jurisdiction rules' });
    }
    const restaurantId = Number(req.body?.restaurant_id ?? req.body?.restaurantId);
    const locationId = Number(req.body?.location_id ?? req.body?.locationId);
    const code = String(req.body?.jurisdiction_code || req.body?.jurisdictionCode || 'US-FED').toUpperCase();
    if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0 || !Number.isSafeInteger(locationId) || locationId <= 0) {
      return res.status(400).json({ error: 'restaurant_id and location_id are required' });
    }
    if (!JURISDICTION_CODES.has(code)) {
      return res.status(400).json({ error: `jurisdiction_code must be one of: ${[...JURISDICTION_CODES].join(', ')}` });
    }
    assertScopedLocation(storeContext?.scope,locationId);
    // Scope to the business: the restaurant must belong to it, and the
    // location must belong to the restaurant.
    const { rows: [scoped] } = await pool.query(
      `SELECT 1 FROM restaurant_locations l
         JOIN food_restaurants r ON r.id = l.restaurant_id
        WHERE l.restaurant_id = $1 AND l.id = $2 AND r.business_id = $3`,
      [restaurantId, locationId, businessId]
    );
    if (!scoped) return res.status(404).json({ error: 'Restaurant or location not found' });
    const cols = laborJurisdiction.RULE_COLUMNS;
    const values = cols.map((c) => {
      const v = req.body?.[c];
      if (v === undefined || v === null || v === '') return null;
      // The tier table is a JSON object; send it as JSON text so the
      // JSONB column stores the object, not a "[object Object]" string.
      return typeof v === 'object' ? JSON.stringify(v) : v;
    });
    // A CUSTOM row that leaves overtime parameters NULL is not
    // payable: NULL means "no rule" for CUSTOM, not "use the
    // default", and the pay path fails closed on it. Refuse the row
    // here, naming the missing parameters, instead of saving a
    // configuration that can only pay straight time.
    const candidate = { jurisdiction_code: code };
    cols.forEach((c, i) => { candidate[c] = values[i]; });
    const missingParams = laborJurisdiction.customRulesErrors(
      laborJurisdiction.resolveRules(candidate)
    );
    if (missingParams.length) {
      return res.status(400).json({ error: `CUSTOM jurisdiction leaves overtime parameters unset: ${missingParams.join(', ')}` });
    }
    // Deactivate the old row (history is kept), insert the new config.
    await pool.query(
      `UPDATE restaurant_labor_jurisdictions SET is_active = FALSE, updated_at = NOW()
        WHERE restaurant_id = $1 AND location_id = $2 AND is_active`,
      [restaurantId, locationId]
    );
    const placeholders = cols.map((_, i) => `$${i + 4}`).join(', ');
    const { rows: [row] } = await pool.query(
      `INSERT INTO restaurant_labor_jurisdictions
         (restaurant_id, location_id, jurisdiction_code, ${cols.join(', ')}, updated_by)
       VALUES ($1, $2, $3, ${placeholders}, $${cols.length + 4})
       RETURNING *`,
      [restaurantId, locationId, code, ...values, req.user.id]
    );
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.staff.labor_jurisdiction.set',
      target_type: 'labor_jurisdiction',
      after_state: { restaurant_id: restaurantId, location_id: locationId, jurisdiction_code: code },
    });
    res.status(201).json({ jurisdiction: laborJurisdiction.resolveRules(row) });
  } catch (err) { return next(err); }
};

// ── Time-off / PTO requests (S-04) ─────────────────────────────────────
// Members request time off for themselves; managers approve or deny.
// Approved ranges surface as conflicts on new requests so double-booking
// a shift against approved leave is visible before it happens.

const TIME_OFF_TYPES = new Set(['vacation', 'sick', 'personal', 'unpaid', 'other']);
const TIME_OFF_STATUSES = new Set(['pending', 'approved', 'denied', 'cancelled', 'withdrawn']);
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateTimeOffInput(body) {
  const requestType = String(body?.request_type || body?.requestType || 'vacation').toLowerCase();
  const startDate = String(body?.start_date || body?.startDate || '');
  const endDate = String(body?.end_date || body?.endDate || '');
  if (!TIME_OFF_TYPES.has(requestType)) return { error: `request_type must be one of: ${[...TIME_OFF_TYPES].join(', ')}` };
  if (!DATE_ONLY_RE.test(startDate) || !DATE_ONLY_RE.test(endDate)) {
    return { error: 'start_date and end_date are required as YYYY-MM-DD' };
  }
  if (endDate < startDate) return { error: 'end_date must be on or after start_date' };
  return { requestType, startDate, endDate };
}

async function findTimeOffConflicts(businessId, userId, startDate, endDate) {
  const { rows } = await pool.query(
    `SELECT id, shift_date, start_time, end_time, role_label
       FROM business_staff_shifts
      WHERE business_id = $1 AND user_id = $2 AND published_at IS NOT NULL AND cancelled_at IS NULL
        AND shift_date BETWEEN $3::date AND $4::date
      ORDER BY shift_date, start_time`,
    [businessId, userId, startDate, endDate]
  );
  return rows;
}

exports.createTimeOffRequest = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    if (!await assertBusinessMember(businessId, req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this business' });
    }
    const valid = validateTimeOffInput(req.body);
    if (valid.error) return res.status(400).json({ error: valid.error });
    let restaurantId = null;
    if (req.body?.restaurant_id || req.body?.restaurantId) {
      const rid = Number(req.body.restaurant_id || req.body.restaurantId);
      if (!Number.isFinite(rid)) return res.status(400).json({ error: 'restaurant_id must be a number' });
      const { rows: [rest] } = await pool.query(
        `SELECT r.id FROM food_restaurants r JOIN businesses b ON b.id = r.business_id
          WHERE r.id = $1 AND b.id = $2`,
        [rid, businessId]
      );
      if (!rest) return res.status(400).json({ error: 'Restaurant does not belong to this business' });
      restaurantId = rid;
    }
    // Phase 4 Track B: a request that would take the balance below
    // zero is rejected here, with the remaining balance, instead of
    // silently going negative. Unconfigured types ('unpaid', or no
    // policy for this employee) are not balance-checked.
    const balanceCheck = await pto.checkSufficient(
      pool, Number(businessId), req.user.id,
      valid.requestType, valid.startDate, valid.endDate
    );
    if (balanceCheck.enforced && !balanceCheck.ok) {
      return res.status(409).json({
        error: 'insufficient_pto_balance',
        code: 'insufficient_pto_balance',
        request_type: valid.requestType,
        balance: balanceCheck.balance,
        required: balanceCheck.required,
        unit: balanceCheck.unit,
        days: balanceCheck.days,
      });
    }
    const { rows: [request] } = await pool.query(
      `INSERT INTO business_time_off_requests
         (business_id, user_id, restaurant_id, request_type, start_date, end_date, reason)
       VALUES ($1,$2,$3,$4,$5::date,$6::date,$7)
       RETURNING *`,
      [businessId, req.user.id, restaurantId, valid.requestType, valid.startDate, valid.endDate,
        req.body?.reason ? String(req.body.reason).slice(0, 2000) : null]
    );
    const conflicts = await findTimeOffConflicts(businessId, req.user.id, valid.startDate, valid.endDate);
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.staff.time_off.requested',
      target_type: 'time_off_request',
      target_id: request.id,
      after_state: request,
    });
    return res.status(201).json({
      request,
      conflicts,
      ...(balanceCheck.enforced ? {
        pto_balance: {
          balance: balanceCheck.balance,
          required: balanceCheck.required,
          unit: balanceCheck.unit,
        },
      } : {}),
    });
  } catch (err) { return next(err); }
};

exports.listTimeOffRequests = async (req, res, next) => {
  const { businessId } = req.params;
  const { status, user_id } = req.query;
  try {
    const storeContext = await workforce.context(req);
    const manager = await isBusinessManager(req, businessId, req.user.id);
    const params = [businessId];
    let where = 'r.business_id = $1';
    if (!manager) {
      params.push(req.user.id);
      where += ` AND r.user_id = $${params.length}`;
    } else if (user_id) {
      params.push(user_id);
      where += ` AND r.user_id = $${params.length}`;
    }
    if (status) {
      if (!TIME_OFF_STATUSES.has(String(status))) return res.status(400).json({ error: 'Invalid status filter' });
      params.push(String(status));
      where += ` AND r.status = $${params.length}`;
    }
    where += workforce.staffClause(storeContext,'r.user_id',params);
    const { rows } = await pool.query(
      `SELECT r.*,
              COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS user_name
         FROM business_time_off_requests r
         JOIN users u ON u.id = r.user_id
        WHERE ${where}
        ORDER BY r.start_date DESC, r.created_at DESC`,
      params
    );
    return res.json({ requests: rows });
  } catch (err) { return next(err); }
};

exports.decideTimeOffRequest = async (req, res, next) => {
  const { businessId, requestId } = req.params;
  const decision = String(req.body?.decision || '').toLowerCase();
  try {
    const storeContext = await workforce.context(req);
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can decide time-off requests' });
    }
    if (!['approved', 'denied'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be approved or denied' });
    }
    if(storeContext?.scope.mode==='assigned'){const {rows:[target]}=await pool.query('SELECT user_id FROM business_time_off_requests WHERE id=$1 AND business_id=$2',[requestId,businessId]);if(!target)return res.status(404).json({error:'Not found'});await workforce.assertStaff(storeContext,target.user_id);}
    // Phase 4 Track B: approval and its balance decrement happen in
    // one transaction, so the status can never flip without the
    // balance moving (and vice versa). The decrement is guarded by
    // `balance >= required`: if the balance moved since the request
    // was made, approval 409s and the request stays pending. Denial
    // never touches the balance.
    const result = await withTransaction(pool, async (client) => {
      const { rows: [pending] } = await client.query(
        `SELECT * FROM business_time_off_requests
          WHERE id = $1 AND business_id = $2 AND status = 'pending' FOR UPDATE`,
        [requestId, businessId]
      );
      if (!pending) return { missing: true };
      let decrement = null;
      if (decision === 'approved') {
        decrement = await pto.decrementForApproval(
          client, Number(businessId), pending.user_id, pending.request_type,
          pending.start_date, pending.end_date, pending.id, req.user.id
        );
        if (decrement.enforced && decrement.ok === false) return { insufficient: decrement };
      }
      const { rows: [updated] } = await client.query(
        `UPDATE business_time_off_requests
            SET status = $1, decided_by = $2, decided_at = NOW(), updated_at = NOW()
          WHERE id = $3 AND business_id = $4 AND status = 'pending'
          RETURNING *`,
        [decision, req.user.id, requestId, businessId]
      );
      return { request: updated, decrement };
    }, 'decide_time_off_request');
    if (result.missing) return res.status(404).json({ error: 'Pending time-off request not found' });
    if (result.insufficient) {
      return res.status(409).json({
        error: 'insufficient_pto_balance',
        code: 'insufficient_pto_balance',
        balance: result.insufficient.balance,
        required: result.insufficient.required,
        unit: result.insufficient.unit,
        days: result.insufficient.days,
      });
    }
    const request = result.request;
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: `business.staff.time_off.${decision}`,
      target_type: 'time_off_request',
      target_id: request.id,
      before_state: { status: 'pending' },
      after_state: request,
    });
    // Fire-and-forget: the requester hears the decision. Domain 8 #26:
    // the notice carries a per-request per-decision key (a decided
    // request is never re-decided, so a silent failed send had no
    // second chance) and a failure is logged with the ids instead of
    // being swallowed by an empty catch.
    sendNotification({
      userId: request.user_id,
      type: 'time_off_decided',
      title: `Time-off ${decision}`,
      body: `Your ${request.request_type} request for ${String(request.start_date).slice(0, 10)} to ${String(request.end_date).slice(0, 10)} was ${decision}.`,
      data: {
        business_id: Number(businessId), request_id: request.id, decision,
        // S-19: rendered per recipient language by sendNotification.
        params: {
          decision,
          startDate: String(request.start_date instanceof Date ? request.start_date.toISOString() : request.start_date).slice(0, 10),
          endDate: String(request.end_date instanceof Date ? request.end_date.toISOString() : request.end_date).slice(0, 10),
        },
      },
      idempotencyKey: `time-off:${request.id}:${decision}`,
    }).catch((err) => {
      logger.warn('Time-off decision: requester notification failed', {
        businessId: Number(businessId), requestId: request.id, decision, error: err.message,
      });
    });
    return res.json({
      request,
      ...(result.decrement?.decremented ? {
        pto_balance: {
          balance: result.decrement.balanceAfter,
          required: result.decrement.required,
          unit: result.decrement.unit,
        },
      } : {}),
    });
  } catch (err) { return next(err); }
};

exports.cancelTimeOffRequest = async (req, res, next) => {
  const { businessId, requestId } = req.params;
  try {
    // Finding 25: an APPROVED request can be cancelled too, and the
    // balance approval consumed is refunded. The request row is
    // locked and the status flip and the refund happen in one
    // transaction, so cancelling twice restores once: the second
    // cancel finds the request already cancelled. The requester or a
    // manager may cancel; anyone else gets a 403. Denied and already
    // cancelled requests cannot be cancelled again.
    const result = await withTransaction(pool, async (client) => {
      const { rows: [request] } = await client.query(
        `SELECT * FROM business_time_off_requests
          WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [requestId, businessId]
      );
      if (!request) return { missing: true };
      const manager = await isBusinessManager(req, businessId, req.user.id);
      if (String(request.user_id) !== String(req.user.id) && !manager) {
        return { forbidden: true };
      }
      if (request.status !== 'pending' && request.status !== 'approved') {
        return { notCancellable: true };
      }
      let refund = null;
      if (request.status === 'approved') {
        refund = await pto.refundForCancellation(
          client, Number(businessId), request.user_id, request.request_type,
          request.id, req.user.id
        );
      }
      const { rows: [cancelled] } = await client.query(
        `UPDATE business_time_off_requests
            SET status = 'cancelled', updated_at = NOW()
          WHERE id = $1 AND business_id = $2 AND status IN ('pending', 'approved')
          RETURNING *`,
        [requestId, businessId]
      );
      if (!cancelled) return { notCancellable: true };
      return { request: cancelled, beforeStatus: request.status, refund };
    }, 'cancel_time_off_request');
    if (result.missing || result.notCancellable) {
      return res.status(404).json({ error: 'Time-off request not found or cannot be cancelled' });
    }
    if (result.forbidden) {
      return res.status(403).json({ error: 'Only the requester or a manager can cancel a time-off request' });
    }
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.staff.time_off.cancelled',
      target_type: 'time_off_request',
      target_id: result.request.id,
      before_state: { status: result.beforeStatus },
      after_state: result.request,
    });
    return res.json({
      request: result.request,
      ...(result.refund?.refunded ? {
        pto_balance: {
          restored: result.refund.amount,
          unit: result.refund.unit,
          balance: result.refund.balanceAfter,
        },
      } : {}),
    });
  } catch (err) { return next(err); }
};

// ── Phase 4 Track B: PTO balances, copy-week, templates, forecast ────
// PTO balances are hours/days owed, not money. The forecast is a
// projection for the scheduler UI, never a pay write.

function addDays(dateStr, days) {
  // wallDatePart handles the Date objects node-pg returns for DATE
  // columns: String(date) gives 'Mon Nov 09 2026 ...', whose first
  // ten characters are not a date. copyWeek feeds source rows
  // straight from the database, so a plain String() slice threw
  // RangeError on every real copy (mocked tests only ever passed
  // strings, so they never saw it).
  const d = new Date(`${wallDatePart(dateStr)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Workweek start (finding 32) ───────────────────────────────────────
// One definition, from the jurisdiction rules: the week's first day is
// the location's workweek_start_day (Sunday by default), never a
// hardcoded Monday. resolveWorkweekStartDay reads it for a location
// when one is in scope, else the restaurant's first active
// jurisdiction row, else Sunday (no row configured). A lookup failure
// propagates (finding 29) instead of silently falling back to a
// Monday week.
async function resolveWorkweekStartDay({ restaurantId, locationId }) {
  if (restaurantId == null) return 0;
  if (locationId != null) {
    const rules = await laborJurisdiction.getJurisdiction(pool, restaurantId, locationId);
    return laborJurisdiction.workweekStartDay(rules);
  }
  const { rows: [row] } = await pool.query(
    `SELECT * FROM restaurant_labor_jurisdictions
      WHERE restaurant_id = $1 AND is_active ORDER BY location_id LIMIT 1`,
    [restaurantId]
  );
  return laborJurisdiction.workweekStartDay(laborJurisdiction.resolveRules(row || null));
}

function isWeekStart(dateStr, startDay) {
  return laborJurisdiction.weekStartOf(dateStr, startDay) === String(dateStr).slice(0, 10);
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Balances + the policy behind them, per employee per type. Managers
// see everyone (or one user with ?user_id=); anyone else sees only
// their own balance.
exports.listTimeOffBalances = async (req, res, next) => {
  const { businessId } = req.params;
  const { user_id } = req.query;
  try {
    const manager = await isBusinessManager(req, businessId, req.user.id);
    const params = [businessId];
    let scope = 'p.business_id = $1';
    if (!manager) {
      params.push(req.user.id);
      scope += ` AND p.user_id = $${params.length}`;
    } else if (user_id) {
      params.push(user_id);
      scope += ` AND p.user_id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT p.user_id, p.request_type,
              COALESCE(b.balance, 0) AS balance,
              COALESCE(b.unit, p.accrual_unit) AS unit,
              p.accrual_amount, p.accrual_unit, p.accrual_period, p.carryover_cap,
              COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS user_name
         FROM business_time_off_policies p
         LEFT JOIN business_time_off_balances b
           ON b.business_id = p.business_id AND b.user_id = p.user_id AND b.request_type = p.request_type
         LEFT JOIN users u ON u.id = p.user_id
        WHERE ${scope}
        UNION ALL
       SELECT b.user_id, b.request_type, b.balance, b.unit,
              NULL AS accrual_amount, NULL AS accrual_unit, NULL AS accrual_period, NULL AS carryover_cap,
              COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS user_name
         FROM business_time_off_balances b
         LEFT JOIN business_time_off_policies p
           ON p.business_id = b.business_id AND p.user_id = b.user_id AND p.request_type = b.request_type
         LEFT JOIN users u ON u.id = b.user_id
        WHERE b.business_id = $1 AND p.id IS NULL
          ${!manager ? `AND b.user_id = $2` : (user_id ? `AND b.user_id = $2` : '')}
        ORDER BY user_id, request_type`,
      params
    );
    return res.json({ balances: rows });
  } catch (err) { return next(err); }
};

// Manager-only: set (or replace) one employee's accrual rule for one
// time-off type. Creates the balance row with initial_balance when
// there is none yet; an existing balance is never reset by this call.
// Changing the unit while a nonzero balance sits in the old unit is
// refused: the manager grants or the balance drains first, so a unit
// change can never silently revalue owed time.
exports.setTimeOffPolicy = async (req, res, next) => {
  const { businessId, userId } = req.params;
  const body = req.body || {};
  try {
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can set time-off policies' });
    }
    const requestType = String(body.request_type || body.requestType || '').toLowerCase();
    if (!TIME_OFF_TYPES.has(requestType)) {
      return res.status(400).json({ error: `request_type must be one of: ${[...TIME_OFF_TYPES].join(', ')}` });
    }
    const accrualAmount = Number(body.accrual_amount ?? body.accrualAmount);
    if (!Number.isFinite(accrualAmount) || accrualAmount < 0) {
      return res.status(400).json({ error: 'accrual_amount must be a number >= 0' });
    }
    const accrualUnit = String(body.accrual_unit || body.accrualUnit || 'days').toLowerCase();
    if (!['hours', 'days'].includes(accrualUnit)) {
      return res.status(400).json({ error: "accrual_unit must be 'hours' or 'days'" });
    }
    const accrualPeriod = String(body.accrual_period || body.accrualPeriod || 'monthly').toLowerCase();
    if (!['weekly', 'monthly', 'yearly', 'once'].includes(accrualPeriod)) {
      return res.status(400).json({ error: "accrual_period must be 'weekly', 'monthly', 'yearly' or 'once'" });
    }
    const carryoverCap = body.carryover_cap ?? body.carryoverCap ?? null;
    const cap = carryoverCap === null || carryoverCap === '' ? null : Number(carryoverCap);
    if (cap !== null && (!Number.isFinite(cap) || cap < 0)) {
      return res.status(400).json({ error: 'carryover_cap must be a number >= 0 or null' });
    }
    const initialBalance = body.initial_balance ?? body.initialBalance ?? null;
    const initial = initialBalance === null || initialBalance === '' ? null : Number(initialBalance);
    if (initial !== null && (!Number.isFinite(initial) || initial < 0)) {
      return res.status(400).json({ error: 'initial_balance must be a number >= 0 or null' });
    }
    if (!await assertBusinessMember(businessId, userId)) {
      return res.status(400).json({ error: 'User is not a member of this business' });
    }
    const result = await withTransaction(pool, async (client) => {
      const existing = await pto.getBalance(client, Number(businessId), userId, requestType);
      if (existing && existing.unit !== accrualUnit && Number(existing.balance) !== 0) {
        return { unitConflict: true, balance: Number(existing.balance), unit: existing.unit };
      }
      const { rows: [policy] } = await client.query(
        `INSERT INTO business_time_off_policies
           (business_id, user_id, request_type, accrual_amount, accrual_unit, accrual_period, carryover_cap, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (business_id, user_id, request_type) DO UPDATE SET
           accrual_amount = EXCLUDED.accrual_amount,
           accrual_unit = EXCLUDED.accrual_unit,
           accrual_period = EXCLUDED.accrual_period,
           carryover_cap = EXCLUDED.carryover_cap,
           updated_at = NOW()
         RETURNING *`,
        [businessId, userId, requestType, accrualAmount, accrualUnit, accrualPeriod, cap, req.user.id]
      );
      const { rows: [balanceRow] } = await client.query(
        `INSERT INTO business_time_off_balances (business_id, user_id, request_type, balance, unit)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (business_id, user_id, request_type) DO UPDATE SET unit = EXCLUDED.unit
         RETURNING *`,
        [businessId, userId, requestType, initial ?? 0, accrualUnit]
      );
      if (initial !== null && initial > 0 && !existing) {
        await client.query(
          `INSERT INTO business_time_off_accrual_events
             (business_id, user_id, request_type, amount, unit, event_type, balance_after, created_by)
           VALUES ($1,$2,$3,$4,$5,'initial',$4,$6)`,
          [businessId, userId, requestType, initial, accrualUnit, req.user.id]
        );
      }
      return { policy, balance: balanceRow };
    }, 'set_time_off_policy');
    if (result.unitConflict) {
      return res.status(400).json({
        error: `Cannot change the accrual unit while a balance of ${result.balance} ${result.unit} remains; grant or drain it first`,
        code: 'pto_unit_conflict',
        balance: result.balance,
        unit: result.unit,
      });
    }
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.staff.time_off.policy_set',
      target_type: 'time_off_policy',
      target_id: result.policy.id,
      after_state: result.policy,
    });
    return res.json({ policy: result.policy, balance: result.balance });
  } catch (err) { return next(err); }
};

// Manager-only: grant one accrual period's worth to every matching
// policy (or one employee / one type with user_id / request_type).
// The carryover cap is enforced per policy inside grantAccrual;
// accrual beyond the cap is not banked and is reported as capped.
// One grant per policy period at most (finding 26): a second grant
// for the same period 409s, naming the period and the existing grant.
// This is the manager-triggered grant (Track B choice): one explicit
// call, one auditable event per policy, no background job.
exports.grantTimeOffAccrual = async (req, res, next) => {
  const { businessId } = req.params;
  const { user_id, request_type } = req.body || {};
  try {
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can grant time-off accrual' });
    }
    const params = [businessId];
    let where = 'business_id = $1';
    if (user_id) { params.push(user_id); where += ` AND user_id = $${params.length}`; }
    if (request_type) {
      if (!TIME_OFF_TYPES.has(String(request_type).toLowerCase())) {
        return res.status(400).json({ error: `request_type must be one of: ${[...TIME_OFF_TYPES].join(', ')}` });
      }
      params.push(String(request_type).toLowerCase());
      where += ` AND request_type = $${params.length}`;
    }
    const { rows: policies } = await pool.query(
      `SELECT * FROM business_time_off_policies WHERE ${where} ORDER BY user_id, request_type`,
      params
    );
    // Finding 26: one grant per policy period. The check runs inside
    // the same transaction as the grants (and locks each policy row),
    // so a multi-policy call never partially grants: any refusal
    // 409s the whole call before anything is granted.
    const result = await withTransaction(pool, async (client) => {
      const refusals = [];
      for (const policy of policies) {
        const check = await pto.checkAccrualPeriod(client, policy);
        if (check.refused) {
          refusals.push({
            user_id: policy.user_id,
            request_type: policy.request_type,
            accrual_period: check.accrualPeriod,
            period: check.period,
            existing_grant: check.existingGrant,
          });
        }
      }
      if (refusals.length) return { refusals };
      const out = [];
      for (const policy of policies) out.push(await pto.grantAccrual(client, policy, req.user.id));
      return { grants: out };
    }, 'grant_time_off_accrual');
    if (result.refusals) {
      return res.status(409).json({
        error: 'pto_accrual_already_granted',
        code: 'pto_accrual_already_granted',
        refusals: result.refusals,
      });
    }
    const grants = result.grants;
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.staff.time_off.accrual_granted',
      target_type: 'time_off_policy',
      after_state: { grants },
    });
    return res.json({ grants });
  } catch (err) { return next(err); }
};

// Manager-only: duplicate a published week of shifts as DRAFTS in a
// target week (same weekday/time/role/person). Conflicting candidates
// are skipped with their reasons; one bad shift never fails the copy.
exports.copyWeek = async (req, res, next) => {
  const { businessId } = req.params;
  const { source_week_start, target_week_start, restaurant_id, location_id } = req.body || {};
  try {
    const storeContext = await workforce.context(req);
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can copy a schedule week' });
    }
    if (!DATE_ONLY_RE.test(String(source_week_start || '')) || !DATE_ONLY_RE.test(String(target_week_start || ''))) {
      return res.status(400).json({ error: 'source_week_start and target_week_start are required as YYYY-MM-DD' });
    }
    // The copied week starts on the jurisdiction's workweek start
    // (Sunday by default; a scoped request uses that location's).
    const startDay = await resolveWorkweekStartDay({
      restaurantId: restaurant_id != null ? Number(restaurant_id) : null,
      locationId: location_id != null ? Number(location_id) : null,
    });
    if (!isWeekStart(source_week_start, startDay) || !isWeekStart(target_week_start, startDay)) {
      return res.status(400).json({ error: `source_week_start and target_week_start must both be ${WEEKDAY_NAMES[startDay]}s` });
    }
    const sourceEnd = addDays(source_week_start, 6);
    const offsetDays = Math.round(
      (new Date(`${target_week_start}T12:00:00Z`) - new Date(`${source_week_start}T12:00:00Z`)) / 86400000
    );
    const { rows: source } = await pool.query(
      `SELECT * FROM business_staff_shifts
        WHERE business_id = $1 AND published_at IS NOT NULL AND cancelled_at IS NULL
          AND shift_date >= $2::date AND shift_date <= $3::date
        ORDER BY shift_date, start_time`,
      [businessId, source_week_start, sourceEnd]
    );
    const candidates = (source || []).map((shift) => ({
      ...shift,
      source_shift_id: shift.id,
      shift_date: addDays(shift.shift_date, offsetDays),
    }));
    const result = await copyCandidates(pool, {
      businessId,
      candidates,
      assertScope: async (userId, locationId) => {
        await workforce.assertStaff(storeContext, userId, pool, locationId);
      },
    });
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.staff.shifts.week_copied',
      target_type: 'shift_week',
      after_state: {
        source_week_start, target_week_start,
        created: result.created.length, skipped: result.skipped.length,
      },
    });
    return res.json({
      source_week_start, target_week_start,
      created: result.created, skipped: result.skipped,
    });
  } catch (err) { return next(err); }
};

// Manager-only: list saved shift templates with their shift counts.
exports.listShiftTemplates = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can view shift templates' });
    }
    const { rows } = await pool.query(
      `SELECT t.*, COUNT(s.id)::int AS shift_count
         FROM business_shift_templates t
         LEFT JOIN business_shift_template_shifts s ON s.template_id = t.id
        WHERE t.business_id = $1
        GROUP BY t.id
        ORDER BY t.name`,
      [businessId]
    );
    return res.json({ templates: rows });
  } catch (err) { return next(err); }
};

// Manager-only: save a published week's shifts as a named template.
// The template stores day_of_week + times, not dates, and applies
// through the same copy path as copy-week.
exports.saveShiftTemplate = async (req, res, next) => {
  const { businessId } = req.params;
  const { name, week_start, restaurant_id, location_id } = req.body || {};
  try {
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can save shift templates' });
    }
    const templateName = String(name || '').trim().slice(0, 120);
    if (!templateName) return res.status(400).json({ error: 'name is required' });
    if (!DATE_ONLY_RE.test(String(week_start || ''))) {
      return res.status(400).json({ error: 'week_start is required as YYYY-MM-DD' });
    }
    const startDay = await resolveWorkweekStartDay({
      restaurantId: restaurant_id != null ? Number(restaurant_id) : null,
      locationId: location_id != null ? Number(location_id) : null,
    });
    if (!isWeekStart(week_start, startDay)) {
      return res.status(400).json({ error: `week_start is required as a ${WEEKDAY_NAMES[startDay]} (YYYY-MM-DD)` });
    }
    const weekEnd = addDays(week_start, 6);
    const { rows: source } = await pool.query(
      `SELECT * FROM business_staff_shifts
        WHERE business_id = $1 AND published_at IS NOT NULL AND cancelled_at IS NULL
          AND shift_date >= $2::date AND shift_date <= $3::date
        ORDER BY shift_date, start_time`,
      [businessId, week_start, weekEnd]
    );
    if (!source.length) {
      return res.status(400).json({ error: 'No published shifts in that week to save as a template' });
    }
    const result = await withTransaction(pool, async (client) => {
      const { rows: [template] } = await client.query(
        `INSERT INTO business_shift_templates (business_id, name, created_by)
         VALUES ($1,$2,$3) RETURNING *`,
        [businessId, templateName, req.user.id]
      );
      for (const shift of source) {
        // Same Date-object class as addDays above: node-pg returns
        // DATE columns as Date objects, and String() on one is not a
        // date. wallDatePart normalizes both shapes.
        const dow = new Date(`${wallDatePart(shift.shift_date)}T12:00:00Z`).getUTCDay();
        await client.query(
          `INSERT INTO business_shift_template_shifts
             (template_id, user_id, day_of_week, start_time, end_time, role_label, notes, location_id, restaurant_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [template.id, shift.user_id, dow, shift.start_time, shift.end_time,
            shift.role_label ?? null, shift.notes ?? null,
            shift.location_id ?? null, shift.restaurant_id ?? null]
        );
      }
      return { template, shift_count: source.length };
    }, 'save_shift_template');
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.staff.shift_template.saved',
      target_type: 'shift_template',
      target_id: result.template.id,
      after_state: { name: templateName, week_start, shift_count: result.shift_count },
    });
    return res.status(201).json(result);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A template with this name already exists' });
    }
    return next(err);
  }
};

// Manager-only: apply a saved template as DRAFTS in a target week,
// through the same copy path (and the same skip-and-report rules) as
// copy-week. day_of_week 0 = Sunday, so Monday + ((dow + 6) % 7).
exports.applyShiftTemplate = async (req, res, next) => {
  const { businessId, templateId } = req.params;
  const { target_week_start, restaurant_id, location_id } = req.body || {};
  try {
    const storeContext = await workforce.context(req);
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can apply shift templates' });
    }
    if (!DATE_ONLY_RE.test(String(target_week_start || ''))) {
      return res.status(400).json({ error: 'target_week_start is required as YYYY-MM-DD' });
    }
    const startDay = await resolveWorkweekStartDay({
      restaurantId: restaurant_id != null ? Number(restaurant_id) : null,
      locationId: location_id != null ? Number(location_id) : null,
    });
    if (!isWeekStart(target_week_start, startDay)) {
      return res.status(400).json({ error: `target_week_start is required as a ${WEEKDAY_NAMES[startDay]} (YYYY-MM-DD)` });
    }
    const { rows: [template] } = await pool.query(
      'SELECT * FROM business_shift_templates WHERE id = $1 AND business_id = $2',
      [templateId, businessId]
    );
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const { rows: templateShifts } = await pool.query(
      `SELECT * FROM business_shift_template_shifts
        WHERE template_id = $1 ORDER BY day_of_week, start_time`,
      [templateId]
    );
    // day_of_week 0 = Sunday; the offset counts forward from the
    // workweek start, so a Monday-start week maps Monday to +0 and a
    // Sunday-start week maps Sunday to +0.
    const candidates = (templateShifts || []).map((shift) => ({
      ...shift,
      template_shift_id: shift.id,
      shift_date: addDays(target_week_start, (Number(shift.day_of_week) - startDay + 7) % 7),
    }));
    const result = await copyCandidates(pool, {
      businessId,
      candidates,
      assertScope: async (userId, locationId) => {
        await workforce.assertStaff(storeContext, userId, pool, locationId);
      },
    });
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.staff.shift_template.applied',
      target_type: 'shift_template',
      target_id: template.id,
      after_state: {
        target_week_start, created: result.created.length, skipped: result.skipped.length,
      },
    });
    return res.json({
      template_id: template.id, template_name: template.name,
      target_week_start,
      created: result.created, skipped: result.skipped,
    });
  } catch (err) { return next(err); }
};

// Manager-only: delete a saved shift template (its shifts cascade).
exports.deleteShiftTemplate = async (req, res, next) => {
  const { businessId, templateId } = req.params;
  try {
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can delete shift templates' });
    }
    const { rows: [deleted] } = await pool.query(
      'DELETE FROM business_shift_templates WHERE id = $1 AND business_id = $2 RETURNING *',
      [templateId, businessId]
    );
    if (!deleted) return res.status(404).json({ error: 'Template not found' });
    return res.json({ success: true });
  } catch (err) { return next(err); }
};

// Manager-only, read-only: project labor cost over the DRAFT shifts in
// a date range (default: the current workweek under the restaurant's
// jurisdiction rules). Scheduled hours x the wage of record, with
// projected weekly overtime flagged where a week's scheduled hours
// cross the labor-policy threshold.
// This is a projection for the scheduler UI: it writes nothing, and
// no pay line, pay run, or ledger row is created or changed here.
exports.getScheduleForecast = async (req, res, next) => {
  const { businessId } = req.params;
  const { from, to, restaurant_id, location_id } = req.query;
  try {
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can view the scheduled-cost forecast' });
    }
    let restaurantId = null;
    if (restaurant_id) {
      const rid = Number(restaurant_id);
      if (!Number.isFinite(rid)) return res.status(400).json({ error: 'restaurant_id must be a number' });
      const { rows: [rest] } = await pool.query(
        'SELECT id FROM food_restaurants WHERE id = $1 AND business_id = $2',
        [rid, businessId]
      );
      if (!rest) return res.status(400).json({ error: 'Restaurant does not belong to this business' });
      restaurantId = rid;
    } else {
      const { rows: [rest] } = await pool.query(
        'SELECT id FROM food_restaurants WHERE business_id = $1 ORDER BY id LIMIT 1',
        [businessId]
      );
      restaurantId = rest?.id ?? null;
    }
    // The default range is the current workweek under the
    // jurisdiction's workweek start (Sunday by default); an explicit
    // from/to still wins. Money-flows audit R13: location_id is
    // validated (and checked against the restaurant when both are
    // given) and forwarded, so a location-scoped request no longer
    // silently returns the business-wide forecast.
    const locationId = location_id ? Number(location_id) : null;
    if (location_id && !Number.isFinite(locationId)) {
      return res.status(400).json({ error: 'location_id must be a number' });
    }
    if (locationId != null && restaurantId != null) {
      const { rows: [loc] } = await pool.query(
        'SELECT id FROM restaurant_locations WHERE id = $1 AND restaurant_id = $2',
        [locationId, restaurantId]
      );
      if (!loc) return res.status(400).json({ error: 'Location does not belong to this restaurant' });
    }
    const startDay = await resolveWorkweekStartDay({ restaurantId, locationId });
    const weekStart = laborJurisdiction.weekStartOf(todayIso(), startDay);
    const fromDate = from ? String(from) : weekStart;
    const toDate = to ? String(to) : addDays(weekStart, 6);
    if (!DATE_ONLY_RE.test(fromDate) || !DATE_ONLY_RE.test(toDate) || toDate < fromDate) {
      return res.status(400).json({ error: 'from and to are required as YYYY-MM-DD with to on or after from' });
    }
    const rangeDays = Math.round(
      (new Date(`${toDate}T12:00:00Z`) - new Date(`${fromDate}T12:00:00Z`)) / 86400000
    ) + 1;
    if (rangeDays > 93) {
      return res.status(400).json({ error: 'Forecast range is capped at 93 days' });
    }
    const policy = await getLaborPolicy(restaurantId);
    const forecast = await computeScheduleForecast(pool, {
      businessId,
      from: fromDate,
      to: toDate,
      // The full normalized labor policy, so the forecast's tiering
      // (daily OT, double time, meal premiums) matches pay.
      policy,
      workweekStartDay: startDay,
      restaurantId,
      locationId,
    });
    let currencyCode = 'USD';
    if (restaurantId) {
      const { rows: [rest] } = await pool.query(
        'SELECT currency_code FROM food_restaurants WHERE id = $1',
        [restaurantId]
      );
      if (rest?.currency_code) currencyCode = rest.currency_code;
    }
    return res.json({ ...forecast, currency_code: currencyCode });
  } catch (err) { return next(err); }
};

// Exported for focused integrity tests; production routes call this through
// the shift create/update/delete handlers above.
exports._recordScheduleChange = recordScheduleChange;
