// server/services/helperAvailabilityService.js
//
// ONE system for helper availability. Every consumer (profile display, slot
// pickers, booking guards, appointment conflict checks) computes from here.
//
// Canonical storage:
//   helper_availability  — weekly recurring template (day_of_week 0=Sun..6=Sat)
//   availability_blocks  — dated exceptions (unavailable/busy subtract,
//                          available adds a special opening)
// Retired (migrated in 581, no longer read): helper_profiles.availability_json,
// helper_availability_overrides.
//
// True availability for a date =
//   template windows
//   − unavailable/busy blocks
//   + available blocks (special openings)
//   − appointments (requested/confirmed/in_progress), expanded by the helper's
//     booking buffer
//
// All date math is local wall-clock time. Callers pass YYYY-MM-DD dates;
// instants (appointments, blocks) are bucketed by the server's local date
// so they line up with the wall-clock weekly template.

const pool = require('../db');

// ─── Pure helpers (unit-tested) ─────────────────────────────────────────────

/** Accepts 'HH:MM', 'HH:MM:SS', or minutes number → minutes since midnight. */
function toMinutes(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Math.round(v);
  const m = String(v).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function formatTime(min) {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Merge overlapping/adjacent [{start,end}] minute ranges. */
function mergeRanges(ranges) {
  const sorted = ranges
    .filter((r) => r && r.end > r.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      out.push({ start: r.start, end: r.end });
    }
  }
  return out;
}

/** Subtract busy ranges from windows → free ranges. */
function subtractRanges(windows, busy) {
  let free = mergeRanges(windows);
  for (const b of mergeRanges(busy)) {
    const next = [];
    for (const w of free) {
      if (b.end <= w.start || b.start >= w.end) {
        next.push(w);
        continue;
      }
      if (b.start > w.start) next.push({ start: w.start, end: b.start });
      if (b.end < w.end) next.push({ start: b.end, end: w.end });
    }
    free = next;
  }
  return free;
}

function totalMinutes(ranges) {
  return ranges.reduce((s, r) => s + (r.end - r.start), 0);
}

function isoDate(d) {
  return d.toISOString().split('T')[0];
}

/** Local wall-clock YYYY-MM-DD (matches the wall-clock template model). */
function localDateStr(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today's date in local wall-clock time. */
function localTodayISO() {
  return localDateStr(new Date());
}

const DAY_NAME_TO_DOW = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

function parseJsonTime(v) {
  if (v == null) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  m = s.match(/^(\d{1,2}):(\d{2})\s*([AaPp])\.?\s?[Mm]\.?$/);
  if (m) {
    let h = parseInt(m[1], 10) % 12;
    if (m[3].toLowerCase() === 'p') h += 12;
    return h * 60 + parseInt(m[2], 10);
  }
  return null;
}

/**
 * Parse the legacy availability_json blob into template windows.
 * Pure. Used to keep the ONE system truthful when an older client still
 * submits the JSON shape.
 */
function templateWindowsFromJson(availabilityJson) {
  if (!availabilityJson || typeof availabilityJson !== 'object' || Array.isArray(availabilityJson)) {
    return [];
  }
  const out = [];
  for (const [key, val] of Object.entries(availabilityJson)) {
    const dow = DAY_NAME_TO_DOW[String(key).toLowerCase()];
    if (dow == null || !val || val.closed) continue;
    const start = parseJsonTime(val.start ?? val.open);
    const end = parseJsonTime(val.end ?? val.close);
    if (start == null || end == null || end <= start) continue;
    out.push({ dayOfWeek: dow, startMin: start, endMin: end });
  }
  return out;
}

/** Full-replace the weekly template. */
async function replaceTemplate(helperId, windows, client = pool) {
  const run = async (c) => {
    await c.query('DELETE FROM helper_availability WHERE helper_id = $1', [helperId]);
    for (const w of windows) {
      await c.query(
        `INSERT INTO helper_availability (helper_id, day_of_week, start_time, end_time, is_active)
         VALUES ($1, $2, make_time($3, $4, 0), make_time($5, $6, 0), TRUE)`,
        [
          helperId,
          w.dayOfWeek,
          Math.floor(w.startMin / 60),
          w.startMin % 60,
          Math.floor(w.endMin / 60),
          w.endMin % 60,
        ]
      );
    }
  };
  if (client === pool) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await run(c);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  } else {
    await run(client);
  }
}

function addDaysISO(dateISO, n) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

function utcDayOfWeek(dateISO) {
  return new Date(`${dateISO}T00:00:00Z`).getUTCDay();
}

function eachDateISO(fromISO, toISO) {
  const out = [];
  let cur = fromISO;
  while (cur <= toISO) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
  }
  return out;
}

/** Clamp a timestamptz block to minute ranges per UTC date it touches. */
/**
 * Split a timestamped block/appointment into per-date minute ranges.
 * Uses the server's local wall-clock time so the ranges line up with the
 * wall-clock weekly template (helper_availability stores plain TIME values).
 */
function blockRangesPerDate(block) {
  const out = {};
  const startD = new Date(block.start_time);
  const endD = new Date(block.end_time);
  if (!(endD > startD)) return out;
  const pad = (n) => String(n).padStart(2, '0');
  let dayStart = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate());
  while (dayStart < endD) {
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const s = Math.max(0, Math.round((startD - dayStart) / 60000));
    const e = Math.min(1440, Math.round((Math.min(endD.getTime(), dayEnd.getTime()) - dayStart.getTime()) / 60000));
    if (e > s) {
      const key = `${dayStart.getFullYear()}-${pad(dayStart.getMonth() + 1)}-${pad(dayStart.getDate())}`;
      (out[key] = out[key] || []).push({ start: s, end: e, type: block.type, title: block.title });
    }
    dayStart = dayEnd;
  }
  return out;
}

// ─── DB reads ───────────────────────────────────────────────────────────────

async function getTemplate(client, helperId) {
  const { rows } = await client.query(
    `SELECT day_of_week,
            EXTRACT(HOUR FROM start_time)::int * 60 + EXTRACT(MINUTE FROM start_time)::int AS start_min,
            EXTRACT(HOUR FROM end_time)::int   * 60 + EXTRACT(MINUTE FROM end_time)::int   AS end_min
       FROM helper_availability
      WHERE helper_id = $1 AND is_active = TRUE
      ORDER BY day_of_week, start_min`,
    [helperId]
  );
  const byDay = {};
  for (const r of rows) {
    (byDay[r.day_of_week] = byDay[r.day_of_week] || []).push({
      start: r.start_min,
      end: r.end_min,
    });
  }
  return { byDay, hasTemplate: rows.length > 0 };
}

async function getBlocks(client, helperId, fromISO, toISO) {
  const { rows } = await client.query(
    `SELECT start_time, end_time, type, title
       FROM availability_blocks
      WHERE helper_id = $1
        AND start_time < ($3::date + INTERVAL '1 day')
        AND end_time   > $2::date`,
    [helperId, fromISO, toISO]
  );
  return rows;
}

async function getAppointmentsBusy(client, helperId, fromISO, toISO, bufferMin) {
  const { rows } = await client.query(
    `SELECT scheduled_start_time, scheduled_end_time
       FROM appointments
      WHERE helper_id = $1
        AND status IN ('requested','confirmed','in_progress')
        AND scheduled_start_time < ($3::date + INTERVAL '1 day')
        AND scheduled_end_time   > $2::date`,
    [helperId, fromISO, toISO]
  );
  const byDate = {};
  for (const a of rows) {
    const perDate = blockRangesPerDate({
      start_time: a.scheduled_start_time,
      end_time: a.scheduled_end_time,
    });
    for (const [date, ranges] of Object.entries(perDate)) {
      for (const r of ranges) {
        (byDate[date] = byDate[date] || []).push({
          start: Math.max(0, r.start - bufferMin),
          end: Math.min(1440, r.end + bufferMin),
        });
      }
    }
  }
  return byDate;
}

async function getBookedCounts(client, helperId, fromISO, toISO) {
  const { rows } = await client.query(
    `SELECT COALESCE(j.scheduled_date::date, j.scheduled_start_at::date, j.scheduled_time::date)::text AS day,
            COUNT(*)::int AS count
       FROM jobs j
      WHERE j.assigned_helper_id = $1
        AND j.status IN ('accepted','in_progress')
        AND COALESCE(j.scheduled_date::date, j.scheduled_start_at::date, j.scheduled_time::date)
            BETWEEN $2::date AND $3::date
      GROUP BY 1`,
    [helperId, fromISO, toISO]
  );
  const out = {};
  for (const r of rows) out[r.day] = r.count;
  return out;
}

async function getBookingBuffer(client, helperId) {
  const { rows } = await client.query(
    'SELECT COALESCE(booking_buffer_minutes, 0)::int AS booking_buffer_minutes FROM helper_profiles WHERE user_id = $1',
    [helperId]
  );
  return Math.max(0, Math.min(240, rows[0]?.booking_buffer_minutes || 0));
}

// ─── Core computation ───────────────────────────────────────────────────────

const LIMITED_THRESHOLD_MIN = 120; // under 2h of free time → "limited"

function computeDay(dateISO, templateWindows, blockRanges, apptBusy, bookedCount, hasTemplate) {
  const blockedRanges = mergeRanges((blockRanges || []).filter((b) => b.type !== 'available'));
  const openingRanges = mergeRanges((blockRanges || []).filter((b) => b.type === 'available'));
  const busyRanges = mergeRanges([...blockedRanges, ...(apptBusy || []).map((a) => ({ start: a.start, end: a.end }))]);

  // Free = template − unavailable/busy + special openings − appointments
  let free = subtractRanges(templateWindows, blockedRanges);
  free = mergeRanges([...free, ...openingRanges]);
  free = subtractRanges(free, apptBusy || []);

  // Slot grid base: template windows plus special openings (gridded on the
  // hour like the template, not from wherever a free fragment starts).
  const gridBase = mergeRanges([...templateWindows, ...openingRanges]);

  const templateMin = totalMinutes(templateWindows);
  const freeMin = totalMinutes(free);

  let status;
  if (!hasTemplate) {
    status = 'unset';
  } else if (templateMin === 0 && openingRanges.length === 0) {
    status = 'closed';
  } else if (freeMin === 0) {
    // Nothing free: blocks ate the whole template → blocked, else appointments did → booked.
    status = totalMinutes(subtractRanges(templateWindows, blockedRanges)) === 0 ? 'blocked' : 'booked';
  } else if (freeMin < LIMITED_THRESHOLD_MIN) {
    status = 'limited';
  } else {
    status = 'available';
  }

  return {
    date: dateISO,
    dayOfWeek: utcDayOfWeek(dateISO),
    status,
    windows: free.map((w) => ({
      start: formatTime(w.start),
      end: formatTime(w.end),
      startMin: w.start,
      endMin: w.end,
    })),
    templateWindows: mergeRanges(templateWindows).map((w) => ({
      start: formatTime(w.start),
      end: formatTime(w.end),
    })),
    // For slot pickers: grid these minute ranges, drop slots touching busy.
    slotGrid: gridBase.map((w) => ({ startMin: w.start, endMin: w.end })),
    busy: busyRanges.map((w) => ({ startMin: w.start, endMin: w.end })),
    blocked: blockedRanges.length > 0,
    bookedCount: bookedCount || 0,
    freeMinutes: freeMin,
  };
}

/**
 * Compute true availability for a date range (inclusive YYYY-MM-DD,
 * local wall-clock). Returns { days, summary, hasTemplate, bookingBufferMinutes }.
 */
async function computeAvailability(helperId, fromISO, toISO, client = pool) {
  const [template, blocks, bufferMin] = await Promise.all([
    getTemplate(client, helperId),
    getBlocks(client, helperId, fromISO, toISO),
    getBookingBuffer(client, helperId),
  ]);
  const [apptBusy, bookedCounts] = await Promise.all([
    getAppointmentsBusy(client, helperId, fromISO, toISO, bufferMin),
    getBookedCounts(client, helperId, fromISO, toISO),
  ]);

  const blocksByDate = {};
  for (const b of blocks) {
    const perDate = blockRangesPerDate(b);
    for (const [date, ranges] of Object.entries(perDate)) {
      (blocksByDate[date] = blocksByDate[date] || []).push(...ranges);
    }
  }

  const days = eachDateISO(fromISO, toISO).map((dateISO) =>
    computeDay(
      dateISO,
      template.byDay[utcDayOfWeek(dateISO)] || [],
      blocksByDate[dateISO] || [],
      apptBusy[dateISO] || [],
      bookedCounts[dateISO] || 0,
      template.hasTemplate
    )
  );

  return {
    days,
    summary: buildSummary(days, template.hasTemplate),
    hasTemplate: template.hasTemplate,
    bookingBufferMinutes: bufferMin,
  };
}

function buildSummary(days, hasTemplate) {
  if (!hasTemplate) return { state: 'unset' };
  const now = new Date();
  const todayISO = localDateStr(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const today = days.find((d) => d.date === todayISO);
  if (today && today.windows.length > 0) {
    const current = today.windows.find((w) => nowMin >= w.startMin && nowMin < w.endMin);
    if (current) {
      return { state: 'open-now', openUntil: current.end, openUntilMin: current.endMin };
    }
    const later = today.windows.find((w) => w.startMin > nowMin);
    if (later) {
      return { state: 'opens-today', opensAt: later.start, opensAtMin: later.startMin };
    }
  }
  for (const d of days) {
    if (d.date <= todayISO || d.windows.length === 0) continue;
    const first = d.windows[0];
    return {
      state: 'opens-on',
      date: d.date,
      dayOfWeek: d.dayOfWeek,
      opensAt: first.start,
      opensAtMin: first.startMin,
    };
  }
  return { state: 'none' };
}

/** True if [startISO, endISO) falls inside free availability. */
async function isSlotFree(helperId, startISO, endISO, client = pool) {
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (!(end > start)) return { free: false, reason: 'invalid-range' };
  // Wall-clock model: bucket by the server's local date so the slot lines
  // up with the plain-TIME weekly template.
  const fromISO = localDateStr(start);
  const toISO = localDateStr(end);
  const { days, hasTemplate } = await computeAvailability(helperId, fromISO, toISO, client);

  // No template configured → fall back to blocks + appointments only
  // (preserves the historical permissiveness of the appointment guard).
  if (!hasTemplate) {
    const { rows } = await client.query(
      `SELECT 1 FROM availability_blocks
        WHERE helper_id = $1 AND type IN ('unavailable','busy')
          AND start_time < $3 AND end_time > $2 LIMIT 1`,
      [helperId, start.toISOString(), end.toISOString()]
    );
    if (rows.length > 0) return { free: false, reason: 'blocked' };
    const appts = await client.query(
      `SELECT 1 FROM appointments
        WHERE helper_id = $1 AND status IN ('requested','confirmed','in_progress')
          AND scheduled_start_time < $3 AND scheduled_end_time > $2 LIMIT 1`,
      [helperId, start.toISOString(), end.toISOString()]
    );
    if (appts.rows.length > 0) return { free: false, reason: 'conflict' };
    return { free: true };
  }

  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = end.getHours() * 60 + end.getMinutes();

  if (fromISO === toISO) {
    const day = days.find((d) => d.date === fromISO);
    const ok = day && day.windows.some((w) => w.startMin <= startMin && w.endMin >= endMin);
    return ok ? { free: true } : { free: false, reason: day?.status === 'blocked' ? 'blocked' : 'unavailable' };
  }
  // Multi-day: every touched day must cover its portion.
  for (const d of days) {
    const s = d.date === fromISO ? startMin : 0;
    const e = d.date === toISO ? endMin : 1440;
    const ok = d.windows.some((w) => w.startMin <= s && w.endMin >= e);
    if (!ok) return { free: false, reason: d.status === 'blocked' ? 'blocked' : 'unavailable' };
  }
  return { free: true };
}

/** Slice a day's free windows into bookable slots (for pickers). */
async function getHourSlots(helperId, dateISO, slotMinutes = 60, client = pool) {
  const { days, hasTemplate, bookingBufferMinutes } = await computeAvailability(
    helperId,
    dateISO,
    dateISO,
    client
  );
  const day = days[0];
  const slots = [];
  if (day && (day.status === 'available' || day.status === 'limited')) {
    // Grid on the template/opening windows; drop slots touching busy ranges.
    for (const w of day.slotGrid) {
      let s = w.startMin;
      while (s + slotMinutes <= w.endMin) {
        const e = s + slotMinutes;
        const overlapsBusy = day.busy.some((b) => b.startMin < e && b.endMin > s);
        if (!overlapsBusy) {
          slots.push({
            start: formatTime(s),
            end: formatTime(e),
            startMin: s,
            endMin: e,
          });
        }
        s += slotMinutes;
      }
    }
  }
  return {
    slots,
    hasTemplate,
    dayHasAvailability: day ? day.windows.length > 0 : false,
    dayStatus: day?.status || 'unset',
    bookingBufferMinutes,
  };
}

module.exports = {
  // pure (tested)
  toMinutes,
  formatTime,
  mergeRanges,
  subtractRanges,
  blockRangesPerDate,
  computeDay,
  buildSummary,
  addDaysISO,
  localTodayISO,
  templateWindowsFromJson,
  replaceTemplate,
  // db-backed
  getTemplate,
  getBlocks,
  computeAvailability,
  isSlotFree,
  getHourSlots,
  getBookingBuffer,
};
