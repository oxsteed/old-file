'use strict';

// Phase 4 Track A (goal goal_a0fc7c0f0394): shared shift-conflict
// validation used by createShift, updateShift, and swap approval in
// businessStaffScheduleController. One function, three call sites, so a
// conflict can never be written through one path and missed by another.
//
// ── Blocking vs warning (the recorded product decision) ──────────────
// BLOCKING (409, the write does not happen):
//   - shift_overlap: the person already has a shift covering this time.
//   - borrow_overlap: the person already has an APPROVED labor borrow
//     covering this time at another store. Only approved borrows count:
//     a requested borrow is not a commitment yet, and a declined /
//     completed / cancelled one never blocks.
//   - time_off_overlap: the shift falls inside an APPROVED time-off range.
//   - minor_*: the shift would break a minor limit from the person's labor
//     profile and the location's jurisdiction rules (daily / weekly hours,
//     latest end time, and the federal under-16 school-day rules the
//     jurisdiction engine already knows). The under-16 school-day /
//     school-week hour caps are advisory, not blocking (finding 31):
//     whether a weekday is a school day is a guess until a school
//     calendar input exists, so those two caps warn; the non-school
//     caps and the under-16 work window still block.
// WARNING ONLY (returned alongside success, never blocks the save):
//   - availability_*: the shift falls outside the person's stored
//     availability windows. Many staff have never set availability, and
//     an empty availability record must not strand the schedule, so a
//     mismatch is surfaced to the manager, not enforced. A person with
//     no availability rows at all produces no warning either.
// This is the documented default from the Phase 4 plan; no product call
// was invented here. If Emile later wants availability to block, flip
// the severity in one place: the `warnings` array below.
//
// Shifts are wall-clock per location: shift_date is the business-local
// day and start/end are wall-clock times, compared without any timezone
// conversion. An end time at or before the start time is an overnight
// shift ending the next morning. Minor limits and permitted hours always
// come from the location's jurisdiction rules (via
// laborJurisdictionRules) and the stored labor profile, never from a
// hardcoded country rule.
//
// Overlap counts every stored shift for the person, draft or published:
// a draft is still planned work, so a draft overlapping a published
// shift is a real conflict. A cancelled (soft-deleted) shift is not
// planned work anymore and never conflicts. The shift being updated
// is excluded by id.
//
// Violations are structured so the UI can show them inline: each has a
// machine-readable code, a severity, the form field it concerns, the
// person, and a message_key + params. The server never sends hardcoded
// English in the response body; the client localizes via the key.

const laborJurisdiction = require('./laborJurisdictionRules');

function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 0 = Sunday, matching business_staff_availability.day_of_week.
function dayOfWeek(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

// The workweek starts on the jurisdiction's workweek_start_day
// (Sunday by default); see laborJurisdictionRules.weekStartOf. The
// shift query below is widened to cover any start day, and the minor
// week-hours grouping inside validateShift uses the resolved rules'
// start, so this module carries no week definition of its own.
function weekStartOf(dateStr, startDay) {
  return laborJurisdiction.weekStartOf(dateStr, startDay);
}

function toMinutes(time) {
  const m = String(time || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesToTime(minutes) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

// A shift's interval in minutes relative to midnight of `baseDate`.
// Overnight shifts (end <= start) run past midnight into the next day.
function shiftInterval(shift, baseDate) {
  const start = toMinutes(shift.start_time);
  const end = toMinutes(shift.end_time);
  if (start == null || end == null) return null;
  const dayDiff = Math.round(
    (new Date(`${dateOnly(shift.shift_date)}T12:00:00Z`) - new Date(`${baseDate}T12:00:00Z`)) / 86400000
  );
  const intervalStart = dayDiff * 1440 + start;
  return { start: intervalStart, end: intervalStart + (end <= start ? end + 1440 - start : end - start) };
}

function shiftHours(shift) {
  const interval = shiftInterval(shift, dateOnly(shift.shift_date));
  if (!interval) return 0;
  return Math.round(((interval.end - interval.start) / 60) * 100) / 100;
}

/**
 * Validate one shift assignment for one person.
 *
 * @param {object} db - pool or transaction client with .query
 * @param {object} opts - businessId, userId, shiftDate (YYYY-MM-DD),
 *   startTime/endTime (HH:MM[:SS] wall clock), excludeShiftId (the shift
 *   being updated, or null), locationId, restaurantId (either may be null;
 *   the restaurant is derived from the location when needed).
 * @returns {{ violations: object[], warnings: object[] }}
 *   violations block the write; warnings ride along with success.
 */
async function validateShift(db, opts) {
  const {
    businessId, userId, shiftDate, startTime, endTime,
    excludeShiftId = null, locationId = null, restaurantId = null,
  } = opts || {};
  const violations = [];
  const warnings = [];
  const day = dateOnly(shiftDate);
  const candStart = toMinutes(startTime);
  const candEndRaw = toMinutes(endTime);
  if (candStart == null || candEndRaw == null) return { violations, warnings };
  const candEnd = candEndRaw <= candStart ? candEndRaw + 1440 : candEndRaw;
  const candHours = Math.round(((candEnd - candStart) / 60) * 100) / 100;
  const overnight = candEndRaw <= candStart;

  // One query covers every time-based check: the person's shifts from a
  // week before the candidate (an overnight shift starting yesterday
  // can spill into today, and the containing workweek starts up to six
  // days before it under any workweek start) through a week after.
  const rangeStart = addDays(day, -7);
  const rangeEnd = addDays(day, 7);
  const { rows: otherShifts } = await db.query(
    `SELECT id, shift_date::text AS shift_date,
            start_time::text AS start_time, end_time::text AS end_time
       FROM business_staff_shifts
      WHERE business_id = $1 AND user_id = $2
        AND shift_date >= $3::date AND shift_date <= $4::date
        AND cancelled_at IS NULL
      ORDER BY shift_date, start_time`,
    [businessId, userId, rangeStart, rangeEnd]
  );
  const others = (otherShifts || []).filter(
    (s) => String(s.id) !== String(excludeShiftId)
  );

  // (a) Overlap with the person's other shifts.
  for (const other of others) {
    const interval = shiftInterval(other, day);
    if (!interval) continue;
    if (interval.start < candEnd && candStart < interval.end) {
      violations.push({
        code: 'shift_overlap',
        severity: 'blocking',
        field: 'shift_start',
        user_id: userId,
        message_key: 'businessHub.staffScheduler.validation.shiftOverlap',
        params: {
          shiftDate: day,
          start: minutesToTime(candStart % 1440),
          end: minutesToTime(candEndRaw),
          conflictingDate: dateOnly(other.shift_date),
          conflictingStart: String(other.start_time).slice(0, 5),
          conflictingEnd: String(other.end_time).slice(0, 5),
        },
        conflicting_shift_id: Number(other.id),
      });
    }
  }

  // (b) Overlap with the person's APPROVED time-off ranges. Pending,
  // denied, cancelled, and withdrawn requests never block: only approved
  // leave is a commitment. Time-off is whole days, so an overnight shift
  // also checks the morning it ends on.
  const timeOffEnd = overnight ? addDays(day, 1) : day;
  const { rows: timeOff } = await db.query(
    `SELECT id, request_type, start_date::text AS start_date, end_date::text AS end_date
       FROM business_time_off_requests
      WHERE business_id = $1 AND user_id = $2 AND status = 'approved'
        AND start_date <= $3::date AND end_date >= $4::date
      ORDER BY start_date`,
    [businessId, userId, timeOffEnd, day]
  );
  for (const request of timeOff || []) {
    violations.push({
      code: 'time_off_overlap',
      severity: 'blocking',
      field: 'shift_start',
      user_id: userId,
      message_key: 'businessHub.staffScheduler.validation.timeOffOverlap',
      params: {
        shiftDate: day,
        type: request.request_type,
        startDate: dateOnly(request.start_date),
        endDate: dateOnly(request.end_date),
      },
      time_off_request_id: Number(request.id),
    });
  }

  // (b2) Overlap with the person's APPROVED labor borrows at other
  // stores (finding 37). An approved borrow is a commitment exactly
  // like a published shift: the approval-time re-check decays the
  // moment a home-store shift is published afterwards, so the shift
  // validator must see borrows too. Only 'approved' borrows count.
  // Borrows are restaurant-scoped, so without a restaurant (no
  // restaurantId and no location to derive one from) there is nothing
  // to check: a non-restaurant business has no borrows. A borrow
  // spans midnight like a shift (end <= start ends the next
  // morning), so the window covers the previous day too — an
  // overnight borrow starting yesterday can spill into this
  // morning — and the following day for an overnight candidate.
  // shiftInterval already turns both into absolute minutes, so the
  // overlap test below needs no special-casing.
  let borrowRestaurantId = restaurantId;
  if (!borrowRestaurantId && locationId != null) {
    try {
      const { rows: [loc] } = await db.query(
        'SELECT restaurant_id FROM restaurant_locations WHERE id = $1',
        [locationId]
      );
      borrowRestaurantId = loc?.restaurant_id || null;
    } catch (err) {
      borrowRestaurantId = null;
    }
  }
  if (borrowRestaurantId != null) {
    const borrowEnd = overnight ? addDays(day, 1) : day;
    const borrowStart = addDays(day, -1);
    const { rows: borrows } = await db.query(
      `SELECT id, shift_date::text AS shift_date,
              start_time::text AS start_time, end_time::text AS end_time,
              borrow_location_id
         FROM restaurant_labor_borrows
        WHERE restaurant_id = $1 AND staff_user_id = $2 AND status = 'approved'
          AND shift_date >= $3::date AND shift_date <= $4::date
        ORDER BY shift_date, start_time`,
      [borrowRestaurantId, userId, borrowStart, borrowEnd]
    );
    for (const borrow of borrows || []) {
      const interval = shiftInterval(borrow, day);
      if (!interval) continue;
      if (interval.start < candEnd && candStart < interval.end) {
        violations.push({
          code: 'borrow_overlap',
          severity: 'blocking',
          field: 'shift_start',
          user_id: userId,
          message_key: 'businessHub.staffScheduler.validation.borrowOverlap',
          params: {
            shiftDate: day,
            start: minutesToTime(candStart % 1440),
            end: minutesToTime(candEndRaw),
            borrowDate: dateOnly(borrow.shift_date),
            borrowStart: String(borrow.start_time).slice(0, 5),
            borrowEnd: String(borrow.end_time).slice(0, 5),
          },
          borrow_id: Number(borrow.id),
          borrow_location_id: borrow.borrow_location_id == null
            ? null : Number(borrow.borrow_location_id),
        });
      }
    }
  }

  // (c) Stored availability windows: warning only, never blocking (see
  // the decision at the top of this file). No rows at all means the
  // person never set availability, so there is nothing to warn about.
  const { rows: windows } = await db.query(
    `SELECT day_of_week, start_time::text AS start_time, end_time::text AS end_time
       FROM business_staff_availability
      WHERE business_id = $1 AND user_id = $2
      ORDER BY day_of_week, start_time`,
    [businessId, userId]
  );
  if ((windows || []).length) {
    const dow = dayOfWeek(day);
    const todays = (windows || []).filter((w) => Number(w.day_of_week) === dow);
    // Availability windows cannot span midnight (CHECK end > start), so
    // an overnight shift is covered when a window contains its start.
    const covered = todays.some((w) => {
      const wStart = toMinutes(w.start_time);
      const wEnd = toMinutes(w.end_time);
      if (wStart == null || wEnd == null) return false;
      return overnight ? wStart <= candStart && candStart < wEnd
        : wStart <= candStart && candEnd <= wEnd;
    });
    if (!todays.length) {
      warnings.push({
        code: 'availability_no_window',
        severity: 'warning',
        field: 'shift_start',
        user_id: userId,
        message_key: 'businessHub.staffScheduler.validation.availabilityNoWindow',
        params: { shiftDate: day },
      });
    } else if (!covered) {
      warnings.push({
        code: 'availability_outside_window',
        severity: 'warning',
        field: 'shift_start',
        user_id: userId,
        message_key: 'businessHub.staffScheduler.validation.availabilityOutsideWindow',
        params: {
          shiftDate: day,
          start: minutesToTime(candStart % 1440),
          end: minutesToTime(candEndRaw),
        },
      });
    }
  }

  // (d) Minor rules: the labor profile says whether the person is a
  // minor and until when; the jurisdiction rules say what the limits
  // are. No profile (or an expired band) means no minor checks.
  const { rows: [profile] } = await db.query(
    `SELECT minor_band, minor_until::text AS minor_until
       FROM business_staff_labor_profiles
      WHERE business_id = $1 AND user_id = $2`,
    [businessId, userId]
  );
  const isMinor = profile?.minor_band && profile.minor_until && day < profile.minor_until;
  if (isMinor) {
    let resolvedRestaurantId = restaurantId;
    if (!resolvedRestaurantId && locationId != null) {
      try {
        const { rows: [loc] } = await db.query(
          'SELECT restaurant_id FROM restaurant_locations WHERE id = $1',
          [locationId]
        );
        resolvedRestaurantId = loc?.restaurant_id || null;
      } catch (err) {
        resolvedRestaurantId = null;
      }
    }
    const rules = await laborJurisdiction.getJurisdiction(
      db, resolvedRestaurantId ? Number(resolvedRestaurantId) : null,
      locationId != null ? Number(locationId) : null
    );
    // The workweek is the jurisdiction's (Sunday by default): the
    // minor weekly caps are measured inside that week, not a Monday
    // week. A jurisdiction lookup failure propagates (finding 29)
    // instead of silently skipping the minor check.
    const startDay = laborJurisdiction.workweekStartDay(rules);
    const weekStart = weekStartOf(day, startDay);

    const dayHours = others
      .filter((s) => dateOnly(s.shift_date) === day)
      .reduce((sum, s) => sum + shiftHours(s), 0) + candHours;
    const weekHours = others
      .filter((s) => weekStartOf(dateOnly(s.shift_date), startDay) === weekStart)
      .reduce((sum, s) => sum + shiftHours(s), 0) + candHours;

    if (rules.minor_max_daily_hours != null && dayHours > Number(rules.minor_max_daily_hours)) {
      violations.push({
        code: 'minor_daily_hours',
        severity: 'blocking',
        field: 'shift_end',
        user_id: userId,
        message_key: 'businessHub.staffScheduler.validation.minorDailyHours',
        params: {
          shiftDate: day, hours: dayHours.toFixed(1),
          limit: Number(rules.minor_max_daily_hours),
        },
      });
    }
    if (rules.minor_max_weekly_hours != null && weekHours > Number(rules.minor_max_weekly_hours)) {
      violations.push({
        code: 'minor_weekly_hours',
        severity: 'blocking',
        field: 'shift_end',
        user_id: userId,
        message_key: 'businessHub.staffScheduler.validation.minorWeeklyHours',
        params: {
          weekStart, hours: weekHours.toFixed(1),
          limit: Number(rules.minor_max_weekly_hours),
        },
      });
    }
    if (rules.minor_latest_end_time) {
      const latest = String(rules.minor_latest_end_time).slice(0, 5);
      const endWall = minutesToTime(candEndRaw);
      if (overnight || endWall > latest) {
        violations.push({
          code: 'minor_latest_end',
          severity: 'blocking',
          field: 'shift_end',
          user_id: userId,
          message_key: 'businessHub.staffScheduler.validation.minorLatestEnd',
          params: { shiftDate: day, end: endWall, limit: latest },
        });
      }
    }

    // Federal under-16 rules (FLSA, 29 CFR 570.35) apply on top of the
    // jurisdiction limits wherever the engine knows them: school-day /
    // non-school-day hour caps and the permitted work window.
    if (profile.minor_band === 'under_16') {
      const L = laborJurisdiction.FLSA_UNDER_16;
      const schoolDay = laborJurisdiction.isSchoolDay(day);
      const dayLimit = schoolDay ? L.school_day_hours : L.non_school_day_hours;
      if (dayHours > dayLimit) {
        // Finding 31 (applied per review): the school-day limit is
        // advisory, never blocking. Whether a weekday is a school day
        // is a guess (Sep-May weekdays; isSchoolDay), and no school
        // calendar or holiday input exists to correct it, so a shift
        // that breaks only the guessed school-day cap warns instead
        // of 409ing. The non-school cap (weekends, summer) rests on
        // statutory dates, not the guess, and still blocks.
        const entry = {
          code: 'minor_under16_daily_hours',
          severity: schoolDay ? 'warning' : 'blocking',
          field: 'shift_end',
          user_id: userId,
          message_key: 'businessHub.staffScheduler.validation.minorUnder16DailyHours',
          params: {
            shiftDate: day, hours: dayHours.toFixed(1), limit: dayLimit,
            schoolDay: schoolDay ? 'school' : 'non-school',
          },
        };
        (schoolDay ? warnings : violations).push(entry);
      }
      const weekShifts = others.filter((s) => weekStartOf(dateOnly(s.shift_date), startDay) === weekStart);
      const schoolWeek = weekShifts.some((s) => laborJurisdiction.isSchoolDay(dateOnly(s.shift_date)))
        || laborJurisdiction.isSchoolDay(weekStart);
      const weekLimit = schoolWeek ? L.school_week_hours : L.non_school_week_hours;
      if (weekHours > weekLimit) {
        const entry = {
          code: 'minor_under16_weekly_hours',
          severity: schoolWeek ? 'warning' : 'blocking',
          field: 'shift_end',
          user_id: userId,
          message_key: 'businessHub.staffScheduler.validation.minorUnder16WeeklyHours',
          params: {
            weekStart, hours: weekHours.toFixed(1), limit: weekLimit,
            schoolDay: schoolWeek ? 'school' : 'non-school',
          },
        };
        (schoolWeek ? warnings : violations).push(entry);
      }
      const latest = laborJurisdiction.isSummer(day) ? L.summer_latest_end : L.latest_end;
      const startWall = minutesToTime(candStart);
      const endWall = minutesToTime(candEndRaw);
      if (startWall < L.earliest_start || overnight || endWall > latest) {
        violations.push({
          code: 'minor_under16_window',
          severity: 'blocking',
          field: 'shift_end',
          user_id: userId,
          message_key: 'businessHub.staffScheduler.validation.minorUnder16Window',
          params: {
            shiftDate: day, start: startWall, end: endWall,
            earliest: L.earliest_start, latest,
          },
        });
      }
    }
  }

  return { violations, warnings };
}

module.exports = { validateShift, shiftHours };
