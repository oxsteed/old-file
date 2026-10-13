'use strict';

/**
 * Direct Bookable slots: calendar windows − blackouts − busy assignee-pool members.
 * Pattern-inspired by bookingSlotEngine.js but wired only to Direct tables.
 */

const crypto = require('crypto');
const db = require('../db');
const { generatePublicReference } = require('../utils/directQuote');
const {
  zonedParts,
  zonedDateStr,
  zonedDayStartUTC,
  addDaysISO,
  resolveTimeZone,
} = require('./helperAvailabilityService');

const DISPATCH_ROLES = ['helper', 'helper_pro', 'broker', 'admin', 'super_admin'];
const TERMINAL_STATUSES = ['cancelled', 'closed', 'completed'];
const DEFAULT_SLOT_MINUTES = 120;
const DEFAULT_HORIZON_DAYS = 28;
const MAX_SLOTS = 50;
const HOLD_TTL_MS = 4 * 60 * 1000;

function toDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function addMinutes(d, minutes) {
  return new Date(d.getTime() + minutes * 60000);
}

async function loadServiceRow(serviceId, executor = db) {
  const { rows } = await executor.query(
    `SELECT s.*, c.id AS category_id, c.slug AS category_slug,
            c.lifecycle_status AS category_lifecycle_status,
            c.is_active AS category_is_active,
            c.name_i18n AS category_name_i18n
       FROM direct_catalog_services s
       JOIN direct_catalog_categories c ON c.id = s.category_id
      WHERE s.id = $1
      LIMIT 1`,
    [serviceId]
  );
  return rows[0] || null;
}

async function loadAssigneePool(serviceId, executor = db) {
  const [{ rows: roles }, { rows: users }] = await Promise.all([
    executor.query(
      `SELECT role FROM direct_service_assignee_roles WHERE service_id = $1`,
      [serviceId]
    ),
    executor.query(
      `SELECT user_id FROM direct_service_assignees WHERE service_id = $1`,
      [serviceId]
    ),
  ]);
  return {
    roles: roles.map((r) => r.role),
    userIds: users.map((u) => String(u.user_id)),
  };
}

/**
 * Resolve the service's eligible dispatch members.
 *
 * Eligibility is bounded by the service's real roster
 * (direct_service_assignees): a configured role selects the roster members
 * holding that role — it never expands to every platform user with the role.
 * An empty roster (and no explicit ids) yields an empty pool, never a
 * platform-wide expansion, so slot capacity is never computed against
 * people who were never put on this service's team.
 */
async function resolveEligibleAssignees(serviceId, pool, executor = db) {
  const roleList = (pool.roles || []).filter((r) => DISPATCH_ROLES.includes(r));
  const explicitIds = [...new Set(pool.userIds || [])];
  if (!roleList.length && !explicitIds.length) return [];

  const params = [serviceId, DISPATCH_ROLES];
  const clauses = [];
  if (explicitIds.length) {
    params.push(explicitIds);
    clauses.push(`u.id = ANY($${params.length}::uuid[])`);
  }
  if (roleList.length) {
    params.push(roleList);
    clauses.push(`(
      u.role = ANY($${params.length}::text[])
      AND u.id IN (SELECT user_id FROM direct_service_assignees WHERE service_id = $1)
    )`);
  }
  const { rows } = await executor.query(
    `SELECT DISTINCT u.id, u.first_name, u.last_name, u.email, u.role
       FROM users u
      WHERE u.is_active = TRUE
        AND u.deleted_at IS NULL
        AND u.role = ANY($2::text[])
        AND (${clauses.join(' OR ')})
      ORDER BY u.first_name ASC, u.last_name ASC, u.email ASC`,
    params
  );
  return rows.map((row) => ({
    id: String(row.id),
    name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email,
    role: row.role,
  }));
}

async function loadCalendarBlocks(from, to, executor = db) {
  const { rows } = await executor.query(
    `SELECT id, block_type, title, starts_at, ends_at, city
       FROM direct_calendar_blocks
      WHERE starts_at < $2
        AND ends_at > $1
      ORDER BY starts_at ASC`,
    [from.toISOString(), to.toISOString()]
  );
  return rows.map((row) => ({
    id: row.id,
    blockType: row.block_type,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
  }));
}

async function loadBusyIntervals(userIds, from, to, executor = db) {
  if (!userIds.length) return { jobs: [], holds: [] };
  const terminal = TERMINAL_STATUSES;
  // Widen the window by the max buffer (240 min) so padded neighbours count.
  const qFrom = new Date(new Date(from).getTime() - 240 * 60000);
  const qTo = new Date(new Date(to).getTime() + 240 * 60000);
  const [{ rows: jobs }, { rows: holds }] = await Promise.all([
    executor.query(
      // Review P1-174: every crew member of a multi-crew booking is busy,
      // not only assigned_to (crew rows live in quote_request_crew).
      `SELECT qr.id, crew_member.user_id AS assigned_to, qr.scheduled_start_at, qr.scheduled_end_at, qr.status
         FROM quote_requests qr
         CROSS JOIN LATERAL (
           SELECT qr.assigned_to AS user_id
           UNION
           SELECT qrc.user_id FROM quote_request_crew qrc WHERE qrc.quote_request_id = qr.id
         ) crew_member
        WHERE COALESCE(qr.metadata->>'flow', 'direct') = 'direct'
          AND crew_member.user_id = ANY($1::uuid[])
          AND qr.scheduled_start_at IS NOT NULL
          AND qr.scheduled_end_at IS NOT NULL
          AND qr.scheduled_start_at < $3
          AND qr.scheduled_end_at > $2
          AND qr.status <> ALL($4::text[])`,
      [userIds, qFrom.toISOString(), qTo.toISOString(), terminal]
    ),
    executor.query(
      `SELECT id, reserved_user_id, starts_at, ends_at
         FROM direct_slot_holds
        WHERE reserved_user_id = ANY($1::uuid[])
          AND expires_at > CURRENT_TIMESTAMP
          AND starts_at < $3
          AND ends_at > $2`,
      [userIds, qFrom.toISOString(), qTo.toISOString()]
    ),
  ]);
  // Review P1-192/P1-194: the member's helper appointments, personal
  // time-off blocks and business appointments also make them busy, and every
  // commitment is padded by their booking_buffer_minutes turnaround.
  const { loadCrossSurfaceBusy, loadBookingBuffers } = require('./crossSurfaceBusy');
  const [cross, buffers] = await Promise.all([
    loadCrossSurfaceBusy(userIds, qFrom, qTo, { exclude: ['direct'], executor }),
    loadBookingBuffers(userIds, executor),
  ]);
  const pad = (item) => {
    const minutes = buffers.get(item.userId) || 0;
    if (!minutes || String(item.source || '').endsWith('_block')) return item;
    return {
      ...item,
      startsAt: new Date(item.startsAt.getTime() - minutes * 60000),
      endsAt: new Date(item.endsAt.getTime() + minutes * 60000),
    };
  };
  return {
    jobs: [
      ...jobs.map((j) => ({
        userId: String(j.assigned_to),
        startsAt: new Date(j.scheduled_start_at),
        endsAt: new Date(j.scheduled_end_at),
        source: 'direct',
      })),
      ...cross,
    ].map(pad),
    holds: holds.map((h) => ({
      userId: String(h.reserved_user_id),
      startsAt: new Date(h.starts_at),
      endsAt: new Date(h.ends_at),
    })),
  };
}

// Review P1-5-F03 (templates): a crew member who configured a weekly
// availability template (helper_availability + helper_availability_overrides)
// is only offered for slots inside their template. Members with no template
// stay eligible (fail-open: preserves today's behavior for crews that never
// configured one).
async function loadMemberTemplates(userIds, from, to, executor = db) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const fromDate = new Date(from).toISOString().slice(0, 10);
  const toDate = new Date(to).toISOString().slice(0, 10);
  const [{ rows: tplRows }, { rows: ovRows }, { rows: tzRows }] = await Promise.all([
    executor.query(
      `SELECT helper_id::text AS user_id, day_of_week,
              EXTRACT(HOUR FROM start_time)::int * 60 + EXTRACT(MINUTE FROM start_time)::int AS start_min,
              EXTRACT(HOUR FROM end_time)::int * 60 + EXTRACT(MINUTE FROM end_time)::int AS end_min
         FROM helper_availability
        WHERE helper_id = ANY($1::uuid[]) AND is_active = TRUE`,
      [ids]
    ),
    executor.query(
      `SELECT helper_id::text AS user_id, override_date::text AS override_date, is_blocked,
              CASE WHEN start_time IS NULL THEN NULL
                   ELSE EXTRACT(HOUR FROM start_time)::int * 60 + EXTRACT(MINUTE FROM start_time)::int END AS start_min,
              CASE WHEN end_time IS NULL THEN NULL
                   ELSE EXTRACT(HOUR FROM end_time)::int * 60 + EXTRACT(MINUTE FROM end_time)::int END AS end_min
         FROM helper_availability_overrides
        WHERE helper_id = ANY($1::uuid[])
          AND override_date BETWEEN ($2::date - INTERVAL '1 day') AND ($3::date + INTERVAL '1 day')`,
      [ids, fromDate, toDate]
    ),
    executor.query(
      `SELECT id::text AS user_id, timezone FROM users WHERE id = ANY($1::uuid[])`,
      [ids]
    ),
  ]);
  const map = new Map();
  const entry = (uid) => {
    let e = map.get(uid);
    if (!e) {
      e = { byDay: new Map(), overrides: new Map(), timeZone: null };
      map.set(uid, e);
    }
    return e;
  };
  for (const r of tzRows) {
    if (r.timezone) entry(String(r.user_id)).timeZone = r.timezone;
  }
  for (const r of tplRows) {
    const e = entry(String(r.user_id));
    const dow = Number(r.day_of_week);
    if (!e.byDay.has(dow)) e.byDay.set(dow, []);
    e.byDay.get(dow).push({ start: Number(r.start_min), end: Number(r.end_min) });
  }
  for (const r of ovRows) {
    const e = entry(String(r.user_id));
    const d = String(r.override_date);
    if (!e.overrides.has(d)) e.overrides.set(d, []);
    e.overrides.get(d).push({
      isBlocked: r.is_blocked === true,
      start: r.start_min == null ? null : Number(r.start_min),
      end: r.end_min == null ? null : Number(r.end_min),
    });
  }
  // Only members who actually configured template windows constrain
  // dispatch; everyone else stays eligible.
  for (const [uid, e] of [...map.entries()]) {
    if (![...e.byDay.values()].some((w) => w.length)) map.delete(uid);
  }
  return map;
}

function mergeWindows(windows) {
  const sorted = [...windows]
    .filter((w) => w && w.end > w.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ start: w.start, end: w.end });
  }
  return merged;
}

function subtractWindows(windows, cuts) {
  let out = mergeWindows(windows);
  for (const c of mergeWindows(cuts)) {
    const next = [];
    for (const w of out) {
      if (c.end <= w.start || c.start >= w.end) { next.push(w); continue; }
      if (c.start > w.start) next.push({ start: w.start, end: c.start });
      if (c.end < w.end) next.push({ start: c.end, end: w.end });
    }
    out = next;
  }
  return out;
}

// Weekday of a zoned YYYY-MM-DD date (mid-day anchor avoids DST edges).
function zonedWeekday(dateStr, tz) {
  return new Date(zonedDayStartUTC(dateStr, tz) + 12 * 3600000).getUTCDay();
}

// Template windows available on one zoned date: weekly template minus
// blocked overrides plus special openings.
function availableWindowsForDate(tpl, dateStr) {
  const tz = resolveTimeZone(tpl.timeZone);
  const dow = zonedWeekday(dateStr, tz);
  let wins = (tpl.byDay.get(dow) || []).map((w) => ({ start: w.start, end: w.end }));
  const ovs = tpl.overrides.get(dateStr) || [];
  const blocked = ovs
    .filter((o) => o.isBlocked)
    .map((o) => ({ start: o.start == null ? 0 : o.start, end: o.end == null ? 1440 : o.end }));
  const openings = ovs
    .filter((o) => !o.isBlocked)
    .map((o) => ({ start: o.start == null ? 0 : o.start, end: o.end == null ? 1440 : o.end }));
  wins = subtractWindows(wins, blocked);
  return mergeWindows([...wins, ...openings]);
}

// True when every zoned-date segment of the slot sits inside the member's
// available template windows.
function memberCoversSlot(tpl, slotStart, slotEnd) {
  const tz = resolveTimeZone(tpl.timeZone);
  const start = new Date(slotStart);
  const end = new Date(slotEnd);
  let cursor = new Date(start);
  let guard = 0;
  while (cursor < end) {
    if (guard++ >= 8) return false; // fail closed on pathological spans
    const dateStr = zonedDateStr(cursor, tz);
    const dayEndMs = zonedDayStartUTC(addDaysISO(dateStr, 1), tz);
    const segEndMs = Math.min(dayEndMs, end.getTime());
    const p0 = zonedParts(cursor, tz);
    const segStartMin = p0.hour * 60 + p0.minute;
    const segEndMin = segEndMs >= dayEndMs ? 1440 : (() => {
      const p1 = zonedParts(new Date(segEndMs), tz);
      return p1.hour * 60 + p1.minute;
    })();
    const wins = availableWindowsForDate(tpl, dateStr);
    const covered = wins.some((w) => w.start <= segStartMin && w.end >= segEndMin);
    if (!covered) return false;
    cursor = new Date(segEndMs);
  }
  return true;
}

// Review P1-6-F03: a helper who switched booking off (helper_profiles.
// allow_booking = false) is never dispatched through Direct. Members
// without a helper_profiles row default to allowed, matching the other
// booking surfaces.
async function filterBookingAllowed(members, executor = db) {
  const ids = [...new Set((members || []).map((m) => String(m.id)).filter(Boolean))];
  if (!ids.length) return members || [];
  const { rows } = await executor.query(
    `SELECT user_id::text AS user_id
       FROM helper_profiles
      WHERE user_id = ANY($1::uuid[]) AND COALESCE(allow_booking, TRUE) = FALSE`,
    [ids]
  );
  const blocked = new Set(rows.map((r) => String(r.user_id)));
  if (!blocked.size) return members;
  return members.filter((m) => !blocked.has(String(m.id)));
}

function isCalendarOpen(slotStart, slotEnd, blocks) {
  const availability = blocks.filter((b) => b.blockType === 'availability');
  if (!availability.length) return false;
  const covered = availability.some(
    (b) => b.startsAt <= slotStart && b.endsAt >= slotEnd
  );
  if (!covered) return false;
  const blocked = blocks.some(
    (b) => ['unavailable', 'holiday', 'blackout'].includes(b.blockType)
      && overlaps(slotStart, slotEnd, b.startsAt, b.endsAt)
  );
  return !blocked;
}

function freeMembersForSlot(members, busy, slotStart, slotEnd, templates) {
  const occupied = new Set();
  for (const item of [...busy.jobs, ...busy.holds]) {
    if (overlaps(slotStart, slotEnd, item.startsAt, item.endsAt)) {
      occupied.add(item.userId);
    }
  }
  return members.filter((m) => {
    if (occupied.has(m.id)) return false;
    // Review P1-5-F03: crew with a configured availability template are
    // only free inside it; members without one stay eligible.
    const tpl = templates ? templates.get(String(m.id)) : undefined;
    if (tpl && !memberCoversSlot(tpl, slotStart, slotEnd)) return false;
    return true;
  });
}

// Review P1-175: pick the N least-loaded free members (jobs + holds count as load).
function pickCrew(freeMembers, busy, n) {
  const load = new Map(freeMembers.map((m) => [String(m.id), 0]));
  for (const item of [...(busy.jobs || []), ...(busy.holds || [])]) {
    if (load.has(item.userId)) load.set(item.userId, load.get(item.userId) + 1);
  }
  return [...freeMembers].sort((a, b) => {
    const diff = load.get(String(a.id)) - load.get(String(b.id));
    return diff !== 0 ? diff : String(a.name || '').localeCompare(String(b.name || ''));
  }).slice(0, n);
}

/**
 * Compute offerable slots for a Direct catalog service.
 */
async function computeServiceSlots({
  serviceId,
  from,
  to,
  horizonDays = DEFAULT_HORIZON_DAYS,
  maxSlots = MAX_SLOTS,
  executor = db,
} = {}) {
  const service = await loadServiceRow(serviceId, executor);
  if (!service) {
    return { error: 'Service not found', statusCode: 404, slots: [], assigneePoolSize: 0 };
  }

  const now = new Date();
  let fromDate = toDate(from) || now;
  let toDateExclusive = toDate(to);
  if (!toDateExclusive) {
    toDateExclusive = addMinutes(now, horizonDays * 24 * 60);
  }
  if (fromDate < now) fromDate = now;
  if (toDateExclusive <= fromDate) {
    return {
      serviceId: String(service.id),
      slotMinutes: Number(service.booking_slot_minutes) || DEFAULT_SLOT_MINUTES,
      assigneePoolSize: 0,
      slots: [],
    };
  }

  const pool = await loadAssigneePool(serviceId, executor);
  let members = await resolveEligibleAssignees(serviceId, pool, executor);
  // Review P1-6-F03: helpers who switched booking off never enter dispatch.
  members = await filterBookingAllowed(members, executor);
  const slotMinutes = Number(service.booking_slot_minutes) || DEFAULT_SLOT_MINUTES;
  const requiredCrew = Number(service.required_crew_size) || 1;

  if (!members.length) {
    return {
      serviceId: String(service.id),
      slotMinutes,
      assigneePoolSize: 0,
      requiredCrewSize: requiredCrew,
      slots: [],
      reason: 'bookable_without_pool',
    };
  }

  const blocks = await loadCalendarBlocks(fromDate, toDateExclusive, executor);
  const busy = await loadBusyIntervals(members.map((m) => m.id), fromDate, toDateExclusive, executor);
  // Review P1-5-F03: crew availability templates bound the slots a member
  // can take.
  const templates = await loadMemberTemplates(members.map((m) => m.id), fromDate, toDateExclusive, executor);

  const availabilityWindows = blocks
    .filter((b) => b.blockType === 'availability')
    .sort((a, b) => a.startsAt - b.startsAt);

  const slots = [];
  for (const window of availabilityWindows) {
    let cursor = new Date(Math.max(window.startsAt.getTime(), fromDate.getTime()));
    // Align to slotMinutes from window start
    const windowStartMs = window.startsAt.getTime();
    const offsetMs = cursor.getTime() - windowStartMs;
    if (offsetMs > 0) {
      const rem = offsetMs % (slotMinutes * 60000);
      if (rem !== 0) cursor = new Date(cursor.getTime() + (slotMinutes * 60000 - rem));
    }
    const windowEnd = new Date(Math.min(window.endsAt.getTime(), toDateExclusive.getTime()));
    while (addMinutes(cursor, slotMinutes) <= windowEnd && slots.length < maxSlots) {
      const slotStart = new Date(cursor);
      const slotEnd = addMinutes(slotStart, slotMinutes);
      if (
        slotStart >= fromDate
        && isCalendarOpen(slotStart, slotEnd, blocks)
      ) {
        const free = freeMembersForSlot(members, busy, slotStart, slotEnd, templates);
        if (free.length >= requiredCrew) {
          slots.push({
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
            availableCapacity: free.length,
            freeAssigneeCount: free.length,
          });
        }
      }
      cursor = addMinutes(cursor, slotMinutes);
    }
    if (slots.length >= maxSlots) break;
  }

  return {
    serviceId: String(service.id),
    slotMinutes,
    assigneePoolSize: members.length,
    requiredCrewSize: requiredCrew,
    slots,
    nextSlotStartsAt: slots[0]?.start || null,
  };
}

/**
 * Lightweight: does this service have any offerable slot in the default horizon?
 *
 * Three distinct outcomes: available (slots found), unavailable (no slots, no
 * error), and error (the engine itself failed — surfaced via `error` so
 * callers never mistake an engine failure for "not Bookable").
 */
async function hasOfferableSlots(serviceId, executor = db) {
  const result = await computeServiceSlots({
    serviceId,
    maxSlots: 1,
    executor,
  });
  return {
    slotsAvailable: (result.slots || []).length > 0,
    nextSlotStartsAt: result.nextSlotStartsAt || null,
    assigneePoolSize: result.assigneePoolSize || 0,
    capacityExhausted: (result.assigneePoolSize || 0) > 0 && !(result.slots || []).length,
    reason: result.reason || null,
    error: result.error || null,
    statusCode: result.statusCode || null,
  };
}

/**
 * Batch pool sizes for many services (no slot scan).
 */
async function loadPoolSizes(serviceIds, executor = db) {
  const ids = [...new Set((serviceIds || []).map(String).filter(Boolean))];
  const map = new Map(ids.map((id) => [id, { roles: [], userIds: [], size: 0 }]));
  if (!ids.length) return map;

  const [{ rows: roleRows }, { rows: userRows }] = await Promise.all([
    executor.query(
      `SELECT service_id, role FROM direct_service_assignee_roles WHERE service_id = ANY($1::uuid[])`,
      [ids]
    ),
    executor.query(
      `SELECT service_id, user_id FROM direct_service_assignees WHERE service_id = ANY($1::uuid[])`,
      [ids]
    ),
  ]);
  for (const row of roleRows) {
    const entry = map.get(String(row.service_id));
    if (entry) entry.roles.push(row.role);
  }
  for (const row of userRows) {
    const entry = map.get(String(row.service_id));
    if (entry) entry.userIds.push(String(row.user_id));
  }

  // Resolve unique eligible users per service (role expansion once)
  const allRoles = [...new Set([...map.values()].flatMap((e) => e.roles))];
  const allExplicit = [...new Set([...map.values()].flatMap((e) => e.userIds))];
  let candidates = [];
  if (allRoles.length || allExplicit.length) {
    const params = [];
    const clauses = [];
    if (allRoles.length) {
      params.push(allRoles);
      clauses.push(`role = ANY($${params.length}::text[])`);
    }
    if (allExplicit.length) {
      params.push(allExplicit);
      clauses.push(`id = ANY($${params.length}::uuid[])`);
    }
    params.push(DISPATCH_ROLES);
    const { rows } = await executor.query(
      // Review P1-6-F03: helpers who switched booking off do not count
      // toward bookable pool size.
      `SELECT id, role FROM users
        LEFT JOIN helper_profiles hp ON hp.user_id = users.id
        WHERE is_active = TRUE AND deleted_at IS NULL
          AND COALESCE(hp.allow_booking, TRUE) = TRUE
          AND role = ANY($${params.length}::text[])
          AND (${clauses.join(' OR ')})`,
      params
    );
    candidates = rows.map((r) => ({ id: String(r.id), role: r.role }));
  }

  for (const [serviceId, entry] of map.entries()) {
    const userSet = new Set(entry.userIds);
    // Roster-bounded eligibility (same rule as resolveEligibleAssignees):
    // only the service's real roster members (direct_service_assignees)
    // count toward the pool. A configured role selects roster members
    // holding that role but can never expand the pool beyond the roster,
    // so an empty roster always yields a size of 0.
    const eligible = candidates.filter((c) => userSet.has(c.id));
    entry.size = new Set(eligible.map((c) => c.id)).size;
    entry.eligibleIds = [...new Set(eligible.map((c) => c.id))];
  }
  return map;
}

async function createHold({
  serviceId,
  startsAt,
  endsAt,
  actorUserId = null,
  executor = db,
} = {}) {
  const start = toDate(startsAt);
  const end = toDate(endsAt);
  if (!start || !end || end <= start) {
    const err = new Error('A valid slot start and end are required');
    err.statusCode = 400;
    throw err;
  }

  const client = executor.connect ? await executor.connect() : executor;
  const shouldRelease = Boolean(executor.connect);
  try {
    if (shouldRelease) await client.query('BEGIN');
    await expireHolds(client);

    const slotResult = await computeServiceSlots({
      serviceId,
      from: start,
      to: end,
      maxSlots: 20,
      executor: client,
    });
    const match = (slotResult.slots || []).find(
      (s) => s.start === start.toISOString() && s.end === end.toISOString()
    );
    if (!match) {
      const err = new Error('Selected slot is no longer available');
      err.statusCode = 409;
      err.code = 'slot_conflict';
      throw err;
    }

    // Bookable gate: holds may only be placed on services that are
    // currently bookable. Same rule as the booking path.
    const { deriveServiceCapability } = require('./directCapability');
    const serviceRow = await loadServiceRow(serviceId, client);
    if (!serviceRow) {
      const err = new Error('Service not found');
      err.statusCode = 404;
      throw err;
    }
    const capability = deriveServiceCapability(serviceRow, {
      lifecycle_status: serviceRow.category_lifecycle_status,
      is_active: serviceRow.category_is_active,
    }, {
      slotsAvailable: true,
      assigneePoolSize: 0,
      freeCapacityInHorizon: false,
    });
    if (!capability.requestable || !capability.isBookable) {
      const err = new Error('This service is not currently bookable');
      err.statusCode = 400;
      err.code = 'not_bookable';
      throw err;
    }

    const pool = await loadAssigneePool(serviceId, client);
    const allMembers = await resolveEligibleAssignees(serviceId, pool, client);
    // Review P1-6-F03: helpers who switched booking off never enter dispatch.
    const members = await filterBookingAllowed(allMembers, client);
    const busy = await loadBusyIntervals(
      members.map((m) => m.id),
      start,
      end,
      client
    );
    // Review P1-5-F03: crew availability templates bound the crew a hold
    // can reserve.
    const templates = await loadMemberTemplates(members.map((m) => m.id), start, end, client);
    const free = freeMembersForSlot(members, busy, start, end, templates);
    // Crew-aware: reserve the full required crew, not just one member.
    // Sort by load and take the N least-loaded free members.
    const requiredCrew = Number(serviceRow.required_crew_size) || 1;
    const crew = pickCrew(free, busy, requiredCrew);
    if (crew.length < requiredCrew) {
      const err = new Error('Not enough free crew for this slot');
      err.statusCode = 409;
      err.code = 'capacity_exhausted';
      throw err;
    }

    // Advisory lock per crew member, then re-check so two concurrent holds
    // cannot both reserve the same pool members.
    for (const member of crew) {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
        [member.id]
      );
    }

    const busyAfter = await loadBusyIntervals(crew.map((m) => m.id), start, end, client);
    if (freeMembersForSlot(crew, busyAfter, start, end, templates).length < requiredCrew) {
      const err = new Error('Crew was just reserved');
      err.statusCode = 409;
      err.code = 'capacity_exhausted';
      throw err;
    }

    const groupToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + HOLD_TTL_MS);
    const inserted = [];
    for (let i = 0; i < crew.length; i++) {
      const rowToken = `${groupToken}:${i}`;
      const { rows } = await client.query(
        `INSERT INTO direct_slot_holds
           (service_id, starts_at, ends_at, reserved_user_id, expires_at, hold_token, hold_group_token, crew_index, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [serviceId, start.toISOString(), end.toISOString(), crew[i].id, expiresAt.toISOString(), rowToken, groupToken, i, actorUserId]
      );
      inserted.push(rows[0]);
    }
    if (shouldRelease) await client.query('COMMIT');
    const token = groupToken;
    return {
      holdId: String(inserted[0].id),
      holdToken: token,
      expiresAt: expiresAt.toISOString(),
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      reservedUserId: crew[0].id,
      reservedUserIds: crew.map((m) => m.id),
      crewSize: crew.length,
    };
  } catch (error) {
    if (shouldRelease) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (shouldRelease) client.release();
  }
}

async function expireHolds(executor = db, { limit = 1000 } = {}) {
  const batchLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.min(Math.floor(Number(limit)), 5000)
    : 1000;
  const { rows } = await executor.query(
    `DELETE FROM direct_slot_holds
      WHERE id IN (
        SELECT id
          FROM direct_slot_holds
         WHERE expires_at <= CURRENT_TIMESTAMP
         ORDER BY expires_at ASC
         LIMIT $1
      )
      RETURNING id`,
    [batchLimit]
  );
  return { count: rows.length, ids: rows.map((row) => String(row.id)) };
}

/**
 * Transactional book: re-check capacity, assign pool member, create quote_requests.
 */
async function bookServiceSlot({
  serviceId,
  startsAt,
  endsAt,
  contact,
  holdToken = null,
  actorUserId = null,
  locale = 'en',
} = {}) {
  const start = toDate(startsAt);
  const end = toDate(endsAt);
  if (!start || !end || end <= start) {
    const err = new Error('A valid slot start and end are required');
    err.statusCode = 400;
    throw err;
  }
  if (!contact?.firstName || !contact?.email || !contact?.serviceLocation) {
    const err = new Error('firstName, email, and serviceLocation are required');
    err.statusCode = 400;
    throw err;
  }

  // Fail closed (audit 2026-10-07): a scheduled booking is inserted with
  // payment_status='unpaid', so it must always have an authenticated owner.
  // This is defense in depth behind the route-level authenticate middleware;
  // the route denies anonymous callers first, but the service layer refuses
  // on its own so no caller path can ever create an ownerless booking.
  if (!actorUserId) {
    const err = new Error('Sign in is required to book a slot');
    err.statusCode = 401;
    err.code = 'auth_required';
    throw err;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await expireHolds(client);

    const service = await loadServiceRow(serviceId, client);
    if (!service) {
      const err = new Error('Service not found');
      err.statusCode = 404;
      throw err;
    }

    const { deriveServiceCapability } = require('./directCapability');
    const pool = await loadAssigneePool(serviceId, client);
    const allMembers = await resolveEligibleAssignees(serviceId, pool, client);
    // Review P1-6-F03: helpers who switched booking off never enter dispatch.
    const members = await filterBookingAllowed(allMembers, client);
    const offerability = await hasOfferableSlots(serviceId, client);
    const capability = deriveServiceCapability(service, {
      lifecycle_status: service.category_lifecycle_status,
      is_active: service.category_is_active,
    }, {
      slotsAvailable: true, // will re-verify below
      assigneePoolSize: members.length,
      freeCapacityInHorizon: members.length > 0,
    });

    // Preference + requestable gate (ignore derived bookable slotsAvailable for preference check)
    const requestable = capability.requestable;
    if (!requestable || !capability.isBookable) {
      const err = new Error('This service is not currently bookable');
      err.statusCode = 400;
      err.code = 'not_bookable';
      throw err;
    }
    if (!members.length) {
      const err = new Error('No assignee pool configured for this service');
      err.statusCode = 409;
      err.code = 'bookable_without_pool';
      throw err;
    }

    let reservedUserIds = [];
    if (holdToken) {
      const { rows: holdRows } = await client.query(
        `SELECT * FROM direct_slot_holds
          WHERE hold_group_token = $1
            AND service_id = $2
            AND expires_at > CURRENT_TIMESTAMP
            AND starts_at = $3
            AND ends_at = $4
          FOR UPDATE`,
        [holdToken, serviceId, start.toISOString(), end.toISOString()]
      );
      if (!holdRows.length) {
        const err = new Error('Hold expired or invalid');
        err.statusCode = 409;
        err.code = 'slot_conflict';
        throw err;
      }
      reservedUserIds = holdRows.map((r) => String(r.reserved_user_id));
    }

    const busy = await loadBusyIntervals(
      members.map((m) => m.id),
      start,
      end,
      client
    );
    const blocks = await loadCalendarBlocks(start, end, client);
    if (!isCalendarOpen(start, end, blocks)) {
      const err = new Error('Selected slot is outside open calendar windows');
      err.statusCode = 409;
      err.code = 'slot_conflict';
      throw err;
    }

    // Review P1-5-F03: crew availability templates bound the crew a booking
    // can take; P1-6-F03 already filtered booking-disabled members above.
    const templates = await loadMemberTemplates(members.map((m) => m.id), start, end, client);
    const free = freeMembersForSlot(members, busy, start, end, templates);
    // Crew-aware: if a hold reserved a crew, use the whole crew.
    let crew = [];
    if (reservedUserIds.length) {
      crew = reservedUserIds
        .map((id) => free.find((m) => String(m.id) === id))
        .filter(Boolean);
      if (crew.length < reservedUserIds.length) {
        crew = []; // Hold crew no longer fully free
      }
    }
    const requiredCrew = Number(service.required_crew_size) || 1;
    if (!crew.length && !reservedUserIds.length) {
      crew = pickCrew(free, busy, requiredCrew);
      if (crew.length < requiredCrew) crew = [];
    }
    if (!crew.length) {
      const err = new Error('No free assignee for this slot');
      err.statusCode = 409;
      err.code = 'capacity_exhausted';
      throw err;
    }

    for (const member of crew) {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
        [member.id]
      );
    }

    // Re-check after lock
    const busyAfter = await loadBusyIntervals(crew.map((m) => m.id), start, end, client);
    if (freeMembersForSlot(crew, busyAfter, start, end, templates).length < crew.length) {
      const err = new Error('Selected assignee was just booked');
      err.statusCode = 409;
      err.code = 'capacity_exhausted';
      throw err;
    }

    const localizedName = (service.name_i18n && (service.name_i18n[locale] || service.name_i18n.en))
      || service.slug;
    const categoryName = (service.category_name_i18n && (service.category_name_i18n[locale] || service.category_name_i18n.en))
      || service.category_slug
      || 'General Direct';

    const metadata = {
      flow: 'direct',
      source: 'direct_slot_book',
      serviceId: String(service.id),
      serviceSlug: service.slug,
      serviceIds: [String(service.id).toLowerCase()],
      catalogServiceIds: [String(service.id).toLowerCase()],
      catalogServices: [{
        id: String(service.id),
        slug: service.slug,
        name: localizedName,
        categorySlug: service.category_slug,
      }],
      slotBooked: true,
      bookedAt: new Date().toISOString(),
    };

    const publicReference = generatePublicReference();
    const { rows: inserted } = await client.query(
      `INSERT INTO quote_requests (
         user_id, public_reference, first_name, last_name, email, phone, company_name,
         service_category, service_location, service_city, service_zip_code,
         preferred_contact_method, details, status, assigned_to,
         scheduled_start_at, scheduled_end_at,
         metadata, payment_status, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11,
         'email', $12, 'scheduled', $13,
         $14, $15,
         $16::jsonb, 'unpaid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )
       RETURNING *`,
      [
        actorUserId || null,
        publicReference,
        String(contact.firstName).trim().slice(0, 100),
        String(contact.lastName || '').trim().slice(0, 100) || '—',
        String(contact.email).trim().slice(0, 255).toLowerCase(),
        contact.phone ? String(contact.phone).trim().slice(0, 40) : null,
        contact.companyName ? String(contact.companyName).trim().slice(0, 200) : null,
        categoryName.slice(0, 200),
        String(contact.serviceLocation).trim().slice(0, 200),
        contact.serviceCity ? String(contact.serviceCity).trim().slice(0, 120) : null,
        contact.serviceZipCode ? String(contact.serviceZipCode).trim().slice(0, 20) : null,
        (contact.details || `Booked slot for ${localizedName}`).trim().slice(0, 4000) || `Booked slot for ${localizedName}`,
        crew[0].id,
        start.toISOString(),
        end.toISOString(),
        JSON.stringify(metadata),
      ]
    );

    // Review P1-174: persist the whole crew, not just crew[0].
    await client.query(
      `INSERT INTO quote_request_crew (quote_request_id, user_id)
       SELECT $1, unnest($2::uuid[])
       ON CONFLICT DO NOTHING`,
      [inserted[0].id, crew.map((m) => m.id)]
    );
    inserted[0].crew_user_ids = crew.map((m) => String(m.id));

    // Link catalog service if junction exists
    try {
      await client.query(
        `INSERT INTO quote_request_services (quote_request_id, service_id, service_name, category_slug)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (quote_request_id, service_id) DO NOTHING`,
        [inserted[0].id, service.id, localizedName, service.category_slug || 'general']
      );
    } catch (_) {
      // junction table may not exist in older deploys; metadata still carries linkage
    }

    // Drop the converted hold (if any) and any overlapping abandoned holds for
    // the same crew so capacity listing stays honest after book.
    await client.query(
      `DELETE FROM direct_slot_holds
        WHERE reserved_user_id = ANY($1::uuid[])
          AND starts_at < $3
          AND ends_at > $2`,
      [crew.map((m) => m.id), start.toISOString(), end.toISOString()]
    );

    await client.query('COMMIT');
    return {
      request: inserted[0],
      assignedTo: crew[0].id,
      assignedCrew: crew.map((m) => m.id),
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      serviceId: String(service.id),
      serviceName: localizedName,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    // Map DB overlap trigger to 409
    if (error?.code === '23P01' || /schedule overlaps/i.test(error?.message || '')) {
      const err = new Error('Selected slot conflicts with an existing booking');
      err.statusCode = 409;
      err.code = 'slot_conflict';
      throw err;
    }
    throw error;
  } finally {
    client.release();
  }
}

async function getServiceAssigneePool(serviceId, executor = db) {
  const pool = await loadAssigneePool(serviceId, executor);
  const members = await resolveEligibleAssignees(serviceId, pool, executor);
  return {
    roles: pool.roles,
    userIds: pool.userIds,
    members: members.map((m) => ({ id: m.id, name: m.name, role: m.role })),
    size: members.length,
  };
}

async function setServiceAssigneePool(serviceId, { roles = [], userIds = [] } = {}, actorUserId = null, executor = db) {
  const cleanRoles = [...new Set((roles || [])
    .map((r) => String(r || '').trim())
    .filter((r) => DISPATCH_ROLES.includes(r)))];
  const cleanUserIds = [...new Set((userIds || []).map((id) => String(id || '').trim()).filter(Boolean))];

  const client = executor.connect ? await executor.connect() : executor;
  const shouldRelease = Boolean(executor.connect);
  try {
    if (shouldRelease) await client.query('BEGIN');
    const exists = await client.query(
      `SELECT id FROM direct_catalog_services WHERE id = $1 LIMIT 1`,
      [serviceId]
    );
    if (!exists.rows[0]) {
      const err = new Error('Catalog service not found');
      err.statusCode = 404;
      throw err;
    }
    await client.query(`DELETE FROM direct_service_assignee_roles WHERE service_id = $1`, [serviceId]);
    await client.query(`DELETE FROM direct_service_assignees WHERE service_id = $1`, [serviceId]);
    for (const role of cleanRoles) {
      await client.query(
        `INSERT INTO direct_service_assignee_roles (service_id, role) VALUES ($1, $2)`,
        [serviceId, role]
      );
    }
    for (const userId of cleanUserIds) {
      await client.query(
        `INSERT INTO direct_service_assignees (service_id, user_id) VALUES ($1, $2)`,
        [serviceId, userId]
      );
    }
    if (shouldRelease) await client.query('COMMIT');
    return getServiceAssigneePool(serviceId, shouldRelease ? db : client);
  } catch (error) {
    if (shouldRelease) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (shouldRelease) client.release();
  }
}

module.exports = {
  DISPATCH_ROLES,
  DEFAULT_SLOT_MINUTES,
  DEFAULT_HORIZON_DAYS,
  HOLD_TTL_MS,
  computeServiceSlots,
  hasOfferableSlots,
  loadPoolSizes,
  createHold,
  bookServiceSlot,
  expireHolds,
  getServiceAssigneePool,
  setServiceAssigneePool,
  loadServiceRow,
  resolveEligibleAssignees,
  loadAssigneePool,
  loadBusyIntervals,
  loadMemberTemplates,
  filterBookingAllowed,
  freeMembersForSlot,
  pickCrew,
};
