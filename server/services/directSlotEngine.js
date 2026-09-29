'use strict';

/**
 * Direct Bookable slots: calendar windows − blackouts − busy assignee-pool members.
 * Pattern-inspired by bookingSlotEngine.js but wired only to Direct tables.
 */

const crypto = require('crypto');
const db = require('../db');
const { generatePublicReference } = require('../utils/directQuote');

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

async function resolveEligibleAssignees(pool, executor = db) {
  const roleList = (pool.roles || []).filter((r) => DISPATCH_ROLES.includes(r));
  const explicitIds = [...new Set(pool.userIds || [])];
  if (!roleList.length && !explicitIds.length) return [];

  const params = [];
  const clauses = [];
  if (roleList.length) {
    params.push(roleList);
    clauses.push(`role = ANY($${params.length}::text[])`);
  }
  if (explicitIds.length) {
    params.push(explicitIds);
    clauses.push(`id = ANY($${params.length}::uuid[])`);
  }
  params.push(DISPATCH_ROLES);
  const { rows } = await executor.query(
    `SELECT id, first_name, last_name, email, role
       FROM users
      WHERE is_active = TRUE
        AND deleted_at IS NULL
        AND role = ANY($${params.length}::text[])
        AND (${clauses.join(' OR ')})
      ORDER BY first_name ASC, last_name ASC, email ASC
      LIMIT 500`,
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
  const [{ rows: jobs }, { rows: holds }] = await Promise.all([
    executor.query(
      `SELECT id, assigned_to, scheduled_start_at, scheduled_end_at, status
         FROM quote_requests
        WHERE COALESCE(metadata->>'flow', 'direct') = 'direct'
          AND assigned_to = ANY($1::uuid[])
          AND scheduled_start_at IS NOT NULL
          AND scheduled_end_at IS NOT NULL
          AND scheduled_start_at < $3
          AND scheduled_end_at > $2
          AND status <> ALL($4::text[])`,
      [userIds, from.toISOString(), to.toISOString(), terminal]
    ),
    executor.query(
      `SELECT id, reserved_user_id, starts_at, ends_at
         FROM direct_slot_holds
        WHERE reserved_user_id = ANY($1::uuid[])
          AND expires_at > CURRENT_TIMESTAMP
          AND starts_at < $3
          AND ends_at > $2`,
      [userIds, from.toISOString(), to.toISOString()]
    ),
  ]);
  return {
    jobs: jobs.map((j) => ({
      userId: String(j.assigned_to),
      startsAt: new Date(j.scheduled_start_at),
      endsAt: new Date(j.scheduled_end_at),
    })),
    holds: holds.map((h) => ({
      userId: String(h.reserved_user_id),
      startsAt: new Date(h.starts_at),
      endsAt: new Date(h.ends_at),
    })),
  };
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

function freeMembersForSlot(members, busy, slotStart, slotEnd) {
  const occupied = new Set();
  for (const item of [...busy.jobs, ...busy.holds]) {
    if (overlaps(slotStart, slotEnd, item.startsAt, item.endsAt)) {
      occupied.add(item.userId);
    }
  }
  return members.filter((m) => !occupied.has(m.id));
}

function pickLeastLoaded(freeMembers, busy, slotStart, slotEnd) {
  if (!freeMembers.length) return null;
  const load = new Map(freeMembers.map((m) => [m.id, 0]));
  for (const item of [...busy.jobs, ...busy.holds]) {
    if (load.has(item.userId)) load.set(item.userId, (load.get(item.userId) || 0) + 1);
  }
  return [...freeMembers].sort((a, b) => {
    const loadDiff = (load.get(a.id) || 0) - (load.get(b.id) || 0);
    if (loadDiff !== 0) return loadDiff;
    return a.name.localeCompare(b.name);
  })[0];
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
  const members = await resolveEligibleAssignees(pool, executor);
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
        const free = freeMembersForSlot(members, busy, slotStart, slotEnd);
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
      `SELECT id, role FROM users
        WHERE is_active = TRUE AND deleted_at IS NULL
          AND role = ANY($${params.length}::text[])
          AND (${clauses.join(' OR ')})`,
      params
    );
    candidates = rows.map((r) => ({ id: String(r.id), role: r.role }));
  }

  for (const [serviceId, entry] of map.entries()) {
    const roleSet = new Set(entry.roles);
    const userSet = new Set(entry.userIds);
    const eligible = candidates.filter(
      (c) => userSet.has(c.id) || roleSet.has(c.role)
    );
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

    const pool = await loadAssigneePool(serviceId, client);
    const members = await resolveEligibleAssignees(pool, client);
    const busy = await loadBusyIntervals(
      members.map((m) => m.id),
      start,
      end,
      client
    );
    const free = freeMembersForSlot(members, busy, start, end);
    const chosen = pickLeastLoaded(free, busy, start, end);
    if (!chosen) {
      const err = new Error('No free assignee for this slot');
      err.statusCode = 409;
      err.code = 'capacity_exhausted';
      throw err;
    }

    // Advisory lock per assignee
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      [chosen.id]
    );

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + HOLD_TTL_MS);
    const { rows } = await client.query(
      `INSERT INTO direct_slot_holds
         (service_id, starts_at, ends_at, reserved_user_id, expires_at, hold_token, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [serviceId, start.toISOString(), end.toISOString(), chosen.id, expiresAt.toISOString(), token, actorUserId]
    );
    if (shouldRelease) await client.query('COMMIT');
    return {
      holdId: String(rows[0].id),
      holdToken: token,
      expiresAt: expiresAt.toISOString(),
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      reservedUserId: chosen.id,
    };
  } catch (error) {
    if (shouldRelease) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (shouldRelease) client.release();
  }
}

async function expireHolds(executor = db) {
  await executor.query(
    `DELETE FROM direct_slot_holds WHERE expires_at <= CURRENT_TIMESTAMP`
  );
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
    const members = await resolveEligibleAssignees(pool, client);
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

    let reservedUserId = null;
    if (holdToken) {
      const { rows: holdRows } = await client.query(
        `SELECT * FROM direct_slot_holds
          WHERE hold_token = $1
            AND service_id = $2
            AND expires_at > CURRENT_TIMESTAMP
            AND starts_at = $3
            AND ends_at = $4
          FOR UPDATE`,
        [holdToken, serviceId, start.toISOString(), end.toISOString()]
      );
      if (!holdRows[0]) {
        const err = new Error('Hold expired or invalid');
        err.statusCode = 409;
        err.code = 'slot_conflict';
        throw err;
      }
      reservedUserId = String(holdRows[0].reserved_user_id);
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

    const free = freeMembersForSlot(members, busy, start, end);
    let chosen = reservedUserId
      ? free.find((m) => m.id === reservedUserId) || null
      : pickLeastLoaded(free, busy, start, end);
    if (!chosen && reservedUserId) {
      // Hold member no longer free
      chosen = null;
    }
    if (!chosen) {
      const err = new Error('No free assignee for this slot');
      err.statusCode = 409;
      err.code = 'capacity_exhausted';
      throw err;
    }

    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      [chosen.id]
    );

    // Re-check after lock
    const busyAfter = await loadBusyIntervals([chosen.id], start, end, client);
    if (freeMembersForSlot([chosen], busyAfter, start, end).length < 1) {
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
        chosen.id,
        start.toISOString(),
        end.toISOString(),
        JSON.stringify(metadata),
      ]
    );

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

    if (holdToken) {
      await client.query(
        `DELETE FROM direct_slot_holds WHERE hold_token = $1`,
        [holdToken]
      );
    }

    await client.query('COMMIT');
    return {
      request: inserted[0],
      assignedTo: chosen.id,
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
  const members = await resolveEligibleAssignees(pool, executor);
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
};
