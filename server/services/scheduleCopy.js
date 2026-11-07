'use strict';

// Phase 4 Track B (goal goal_a0fc7c0f0394): copy-week and shift
// templates share this one copy path, so there is a single scheduling
// model, not two.
//
// copyCandidates(db, { businessId, candidates, assertScope }) takes a
// list of candidate shifts (same weekday/time/role/person as a source
// week or a saved template) and writes each one as a DRAFT
// (published_at NULL). Every candidate runs Track A's validateShift
// first: a conflicting candidate is SKIPPED and reported with its
// violations, never silently created as a conflicting draft, and one
// bad candidate never fails the whole copy. Availability warnings ride
// along on the created draft, exactly like createShift.
//
// The caller builds the candidates (copy-week shifts the source week's
// dates into the target week; templates shift day_of_week into the
// target week's dates). This module only validates, inserts, and
// reports.

const { validateShift } = require('./shiftConflictValidation');

function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function timeOnly(value) {
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
  }
  return String(value).slice(0, 8);
}

async function copyCandidates(db, { businessId, candidates, assertScope = null }) {
  const created = [];
  const skipped = [];
  for (const candidate of candidates || []) {
    const shiftDate = dateOnly(candidate.shift_date);
    const startTime = timeOnly(candidate.start_time);
    const endTime = timeOnly(candidate.end_time);
    const base = {
      source_shift_id: candidate.source_shift_id ?? null,
      template_shift_id: candidate.template_shift_id ?? null,
      user_id: candidate.user_id,
      shift_date: shiftDate,
      start_time: startTime.slice(0, 5),
      end_time: endTime.slice(0, 5),
      role_label: candidate.role_label ?? null,
    };
    try {
      if (assertScope) {
        await assertScope(candidate.user_id, candidate.location_id ?? null);
      }
      const validation = await validateShift(db, {
        businessId,
        userId: candidate.user_id,
        shiftDate,
        startTime,
        endTime,
        locationId: candidate.location_id ?? null,
        restaurantId: candidate.restaurant_id ?? null,
      });
      if (validation.violations.length) {
        skipped.push({ ...base, reason: 'conflict', violations: validation.violations });
        continue;
      }
      const { rows: [inserted] } = await db.query(
        `INSERT INTO business_staff_shifts
           (business_id, user_id, shift_date, start_time, end_time, role_label, notes, location_id, restaurant_id)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [businessId, candidate.user_id, shiftDate, startTime, endTime,
          candidate.role_label ?? null, candidate.notes ?? null,
          candidate.location_id ?? null, candidate.restaurant_id ?? null]
      );
      created.push({ ...inserted, warnings: validation.warnings || [] });
    } catch (err) {
      // A scope failure is a per-candidate skip, not a whole-copy
      // failure: the manager sees which people were out of scope.
      skipped.push({ ...base, reason: 'out_of_scope', error: String(err?.message || err) });
    }
  }
  return { created, skipped };
}

module.exports = { copyCandidates, dateOnly, timeOnly };
