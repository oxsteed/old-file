'use strict';

const crypto = require('crypto');
const { strictInteger } = require('../utils/strictInteger');
const { hostingMessage } = require('../services/restaurantHostingMessages');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const { withTransaction } = require('../utils/transaction');
const { sendTransactionalSMS } = require('../services/smsNotificationService');
const { logBusinessAction } = require('../services/businessAuditLog');
const { assertLocationAccess } = require('../services/restaurantLocationAccessService');

const ACTIVE_RESERVATION_STATUSES = ['pending', 'confirmed', 'seated'];
const RESERVATION_STATUSES = ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'];
const TABLE_STATUSES = ['active', 'disabled'];
const WAITLIST_STATUSES = ['waiting', 'notified', 'seated', 'cancelled', 'expired'];

function positiveId(value, label) {
  const id = strictInteger(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(`Invalid ${label}`, 400, 'invalid_request');
  return id;
}

function requiredText(value, label, max = 160) {
  const text = String(value || '').trim();
  if (!text || text.length > max) throw new AppError(`Invalid ${label}`, 400, 'invalid_request');
  return text;
}

function optionalText(value, max = 320) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (text.length > max) throw new AppError('Text field is too long', 400, 'invalid_request');
  return text || null;
}

function partySize(value) {
  const size = Number(value);
  if (!Number.isInteger(size) || size < 1 || size > 1000) throw new AppError('Invalid party size', 400, 'invalid_request');
  return size;
}

function instant(value, label) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw new AppError(`Invalid ${label}`, 400, 'invalid_request');
  return parsed.toISOString();
}

async function access(req, codes = ['restaurant.manage', 'pos.use', 'orders.manage']) {
  const restaurantId = positiveId(req.params.restaurantId, 'restaurant');
  const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
  if (!await permissions.hasRestaurantPermission(restaurant, req.user.id, codes)) {
    throw new AppError('Permission denied', 403, 'forbidden');
  }
  return restaurant;
}

async function resolveLocation(client, restaurantId, requested, restaurant = null, userId = null) {
  const locationId = requested == null ? null : positiveId(requested, 'location');
  const result = await client.query(`SELECT id, restaurant_id, name, status, timezone
    FROM restaurant_locations
    WHERE restaurant_id=$1 AND status <> 'archived' AND ($2::bigint IS NULL AND is_primary=TRUE OR id=$2)
    ORDER BY is_primary DESC, id ASC LIMIT 1`, [restaurantId, locationId]);
  if (!result.rows[0]) throw new AppError('Location not found', 404, 'location_not_found');
  if (restaurant) await assertLocationAccess(restaurant, userId, result.rows[0].id, client);
  return result.rows[0];
}

function normalizePosition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !['x', 'y'].includes(key))) {
    throw new AppError('Invalid table position', 400, 'invalid_request');
  }
  for (const coordinate of Object.values(value)) {
    if (typeof coordinate !== 'number' || !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 100) {
      throw new AppError('Table coordinates must be percentages from 0 to 100', 400, 'invalid_request');
    }
  }
  return value;
}

function assertReservationReplay(existing, locationId, input, source) {
  const sameInstant = (a, b) => new Date(a).getTime() === new Date(b).getTime();
  if (Number(existing.location_id) !== Number(locationId)
    || existing.guest_name !== input.guestName
    || (existing.guest_phone || null) !== input.guestPhone
    || (existing.guest_email || null) !== input.guestEmail
    || Number(existing.party_size) !== input.partySize
    || !sameInstant(existing.starts_at, input.startsAt) || !sameInstant(existing.ends_at, input.endsAt)
    || (existing.notes || null) !== input.notes || existing.source !== source
    || Number(existing.table_id || 0) !== Number(input.tableId || 0)) {
    throw new AppError('Reservation retry conflicts with the original request', 409, 'idempotency_conflict');
  }
}

const RESERVATION_TRANSITIONS = {
  pending: ['confirmed', 'cancelled', 'no_show'],
  confirmed: ['seated', 'cancelled', 'no_show'],
  seated: ['completed', 'cancelled'],
  completed: [], cancelled: [], no_show: [],
};

function reservationPayload(body) {
  const startsAt = instant(body.startsAt, 'start time');
  const endsAt = instant(body.endsAt, 'end time');
  if (new Date(endsAt) <= new Date(startsAt)) throw new AppError('End time must be after start time', 400, 'invalid_request');
  return {
    guestName: requiredText(body.guestName, 'guest name'),
    guestPhone: optionalText(body.guestPhone, 40),
    guestEmail: optionalText(body.guestEmail),
    partySize: partySize(body.partySize),
    startsAt,
    endsAt,
    tableId: body.tableId == null || body.tableId === '' ? null : positiveId(body.tableId, 'table'),
    source: optionalText(body.source, 32) || 'host',
    notes: optionalText(body.notes, 2000),
    idempotencyKey: optionalText(body.idempotencyKey, 180),
  };
}

function publicReservationPayload(body, idempotencyKey) {
  const startsAt = instant(body.startsAt, 'start time');
  const endsAt = instant(body.endsAt, 'end time');
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (end <= start) throw new AppError('End time must be after start time', 400, 'invalid_request');
  if (start < new Date(Date.now() - 60_000)) throw new AppError('Reservation time must be in the future', 400, 'invalid_request');
  if (start > new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)) throw new AppError('Reservations can be requested up to 90 days ahead', 400, 'invalid_request');
  if ((end - start) > 4 * 60 * 60 * 1000) throw new AppError('Reservation window is too long', 400, 'invalid_request');
  const guestPhone = optionalText(body.guestPhone, 40);
  const guestEmail = optionalText(body.guestEmail);
  if (!guestPhone && !guestEmail) throw new AppError('A phone or email is required', 400, 'contact_required');
  const key = String(idempotencyKey || body.idempotencyKey || '').trim();
  if (!key || key.length > 180) throw new AppError('An idempotency key is required', 400, 'idempotency_required');
  const size = partySize(body.partySize);
  if (size > 20) throw new AppError('Public reservations support parties up to 20', 400, 'invalid_request');
  return {
    guestName: requiredText(body.guestName, 'guest name'), guestPhone, guestEmail,
    partySize: size, startsAt, endsAt,
    notes: optionalText(body.notes, 500), idempotencyKey: key,
  };
}

function publicReservationShape(row) {
  return {
    id: Number(row.id), restaurantId: Number(row.restaurant_id), locationId: Number(row.location_id),
    guestName: row.guest_name, partySize: Number(row.party_size), startsAt: row.starts_at,
    endsAt: row.ends_at, status: row.status, source: row.source, createdAt: row.created_at,
  };
}

exports.createPublicReservationRequest = async (req, res, next) => {
  try {
    const restaurantId = positiveId(req.params.restaurantId, 'restaurant');
    const input = publicReservationPayload(req.body || {}, req.get('Idempotency-Key'));
    const result = await withTransaction(pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`reservation:${restaurantId}:${input.idempotencyKey}`]);
      const location = await resolveLocation(client, restaurantId, req.body?.locationId);
      const { rows: [existing] } = await client.query(
        `SELECT * FROM restaurant_reservations WHERE restaurant_id=$1 AND idempotency_key=$2 FOR UPDATE`,
        [restaurantId, input.idempotencyKey]
      );
      if (existing) { assertReservationReplay(existing, location.id, input, 'public'); return { reservation: publicReservationShape(existing), idempotent: true }; }
      const { rows: [created] } = await client.query(`INSERT INTO restaurant_reservations
        (restaurant_id, location_id, guest_name, guest_phone, guest_email, party_size,
         starts_at, ends_at, status, source, notes, idempotency_key, created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending','public',$9,$10,NULL) RETURNING *`,
      [restaurantId, location.id, input.guestName, input.guestPhone, input.guestEmail,
        input.partySize, input.startsAt, input.endsAt, input.notes, input.idempotencyKey]);
      return { reservation: publicReservationShape(created), idempotent: false };
    }, 'restaurant_public_reservation_request');
    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) { next(error); }
};

exports.listTables = async (req, res, next) => {
  try {
    const restaurant = await access(req, ['restaurant.manage', 'pos.use', 'orders.manage']);
    const location = await resolveLocation(pool, restaurant.id, req.query.locationId, restaurant, req.user.id);
    const { rows } = await pool.query(`SELECT * FROM restaurant_tables
      WHERE restaurant_id=$1 AND location_id=$2 ORDER BY status, section NULLS LAST, name, id`, [restaurant.id, location.id]);
    res.json({ location, tables: rows });
  } catch (error) { next(error); }
};

exports.createTable = async (req, res, next) => {
  try {
    const restaurant = await access(req, ['restaurant.manage']);
    const table = await withTransaction(pool, async (client) => {
      const location = await resolveLocation(client, restaurant.id, req.body.locationId, restaurant, req.user.id);
      const name = requiredText(req.body.name, 'table name', 120);
      const capacity = partySize(req.body.capacity);
      const section = optionalText(req.body.section, 120);
      const position = req.body.position === undefined ? {} : normalizePosition(req.body.position);
      const { rows: [created] } = await client.query(`INSERT INTO restaurant_tables
        (restaurant_id, location_id, name, capacity, section, position, created_by)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`,
      [restaurant.id, location.id, name, capacity, section, JSON.stringify(position), req.user.id]);
      return created;
    }, 'restaurant_table_create');
    res.status(201).json({ table });
  } catch (error) { next(error); }
};

exports.updateTable = async (req, res, next) => {
  try {
    const restaurant = await access(req, ['restaurant.manage']);
    const tableId = positiveId(req.params.tableId, 'table');
    const status = req.body.status == null ? null : String(req.body.status);
    if (status && !TABLE_STATUSES.includes(status)) throw new AppError('Invalid table status', 400, 'invalid_request');
    const updates = [];
    const values = [restaurant.id, tableId];
    for (const [field, value] of [['name', req.body.name], ['section', req.body.section]]) {
      if (value !== undefined) { updates.push(`${field}=$${values.length + 1}`); values.push(field === 'name' ? requiredText(value, 'table name', 120) : optionalText(value, 120)); }
    }
    if (req.body.capacity !== undefined) { updates.push(`capacity=$${values.length + 1}`); values.push(partySize(req.body.capacity)); }
    if (status) { updates.push(`status=$${values.length + 1}`); values.push(status); }
    if (req.body.position !== undefined) { updates.push(`position=$${values.length + 1}::jsonb`); values.push(JSON.stringify(normalizePosition(req.body.position))); }
    if (!updates.length) throw new AppError('No table changes supplied', 400, 'invalid_request');
    const table = await withTransaction(pool, async (client) => {
      const { rows: [current] } = await client.query('SELECT * FROM restaurant_tables WHERE restaurant_id=$1 AND id=$2 FOR UPDATE', [restaurant.id, tableId]);
      if (!current) throw new AppError('Table not found', 404, 'table_not_found');
      await assertLocationAccess(restaurant, req.user.id, current.location_id, client);
      if (req.body.capacity !== undefined) {
        const { rows } = await client.query(`SELECT id FROM restaurant_reservations
          WHERE restaurant_id=$1 AND table_id=$2 AND status = ANY($3::text[]) AND party_size > $4 LIMIT 1`,
        [restaurant.id, tableId, ACTIVE_RESERVATION_STATUSES, partySize(req.body.capacity)]);
        if (rows.length) throw new AppError('Capacity is below an active reservation party size', 409, 'table_capacity_exceeded');
      }
      const { rows: [updated] } = await client.query(`UPDATE restaurant_tables SET ${updates.join(', ')}, updated_at=NOW()
        WHERE restaurant_id=$1 AND id=$2 RETURNING *`, values);
      return updated;
    }, 'restaurant_table_update');
    res.json({ table });
  } catch (error) { next(error); }
};

exports.listReservations = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const location = await resolveLocation(pool, restaurant.id, req.query.locationId, restaurant, req.user.id);
    const { rows } = await pool.query(`SELECT r.*, t.name AS table_name, t.capacity AS table_capacity
      FROM restaurant_reservations r LEFT JOIN restaurant_tables t ON t.id=r.table_id AND t.restaurant_id=r.restaurant_id
      WHERE r.restaurant_id=$1 AND r.location_id=$2
      ORDER BY r.starts_at ASC, r.id ASC LIMIT 501`, [restaurant.id, location.id]);
    res.json({ location, reservations: rows });
  } catch (error) { next(error); }
};

exports.createReservation = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const input = reservationPayload(req.body);
    const result = await withTransaction(pool, async (client) => {
      const location = await resolveLocation(client, restaurant.id, req.body.locationId, restaurant, req.user.id);
      if (input.idempotencyKey) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`reservation:${restaurant.id}:${input.idempotencyKey}`]);
        const { rows: [existing] } = await client.query(`SELECT * FROM restaurant_reservations
          WHERE restaurant_id=$1 AND idempotency_key=$2 FOR UPDATE`, [restaurant.id, input.idempotencyKey]);
        if (existing) { assertReservationReplay(existing, location.id, input, input.source); return { reservation: existing, idempotent: true }; }
      }
      let table = null;
      if (input.tableId) {
        const { rows: [row] } = await client.query(`SELECT * FROM restaurant_tables
          WHERE restaurant_id=$1 AND location_id=$2 AND id=$3 AND status='active' FOR UPDATE`, [restaurant.id, location.id, input.tableId]);
        if (!row) throw new AppError('Table not found', 404, 'table_not_found');
        if (input.partySize > row.capacity) throw new AppError('Party exceeds table capacity', 409, 'table_capacity_exceeded');
        table = row;
        const { rows: conflicts } = await client.query(`SELECT id FROM restaurant_reservations
          WHERE restaurant_id=$1 AND location_id=$2 AND table_id=$3 AND status = ANY($4::text[])
            AND starts_at < $5::timestamptz AND ends_at > $6::timestamptz LIMIT 1
          FOR UPDATE`, [restaurant.id, location.id, input.tableId, ACTIVE_RESERVATION_STATUSES, input.endsAt, input.startsAt]);
        if (conflicts[0]) throw new AppError('Table is already reserved for that time', 409, 'reservation_conflict');
      }
      const { rows: [reservation] } = await client.query(`INSERT INTO restaurant_reservations
        (restaurant_id, location_id, table_id, guest_name, guest_phone, guest_email, party_size,
         starts_at, ends_at, source, notes, idempotency_key, created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [restaurant.id, location.id, table?.id || null, input.guestName, input.guestPhone, input.guestEmail,
        input.partySize, input.startsAt, input.endsAt, input.source, input.notes, input.idempotencyKey, req.user.id]);
      return { reservation, idempotent: false };
    }, 'restaurant_reservation_create');
    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) { next(error); }
};

exports.updateReservation = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const reservationId = positiveId(req.params.reservationId, 'reservation');
    const status = req.body.status == null ? null : String(req.body.status);
    if (status && !RESERVATION_STATUSES.includes(status)) throw new AppError('Invalid reservation status', 400, 'invalid_request');
    const reservation = await withTransaction(pool, async (client) => {
      const { rows: [identity] } = await client.query('SELECT * FROM restaurant_reservations WHERE restaurant_id=$1 AND id=$2', [restaurant.id, reservationId]);
      if (!identity) throw new AppError('Reservation not found', 404, 'reservation_not_found');
      await assertLocationAccess(restaurant, req.user.id, identity.location_id, client);
      let table = null;
      if (identity.table_id) {
        const { rows } = await client.query('SELECT * FROM restaurant_tables WHERE restaurant_id=$1 AND location_id=$2 AND id=$3 FOR UPDATE', [restaurant.id, identity.location_id, identity.table_id]);
        table = rows[0];
        if (!table) throw new AppError('Table not found', 404, 'table_not_found');
      }
      const { rows: [current] } = await client.query('SELECT * FROM restaurant_reservations WHERE restaurant_id=$1 AND id=$2 FOR UPDATE', [restaurant.id, reservationId]);
      if (!current) throw new AppError('Reservation not found', 404, 'reservation_not_found');
      // Auth-audit item 14: the row lookup is restaurant-wide, so a
      // store-A-scoped employee could edit a store-B reservation (guest
      // PII). Assert store access on the row's location before mutating.
      await assertLocationAccess(restaurant, req.user.id, current.location_id, client);
      if (status && status !== current.status && !RESERVATION_TRANSITIONS[current.status]?.includes(status)) {
        throw new AppError('Invalid reservation transition', 409, 'reservation_transition_invalid');
      }
      const finalStatus = status || current.status;
      const finalPartySize = req.body.partySize === undefined ? Number(current.party_size) : partySize(req.body.partySize);
      if (table && ACTIVE_RESERVATION_STATUSES.includes(finalStatus) && (table.status !== 'active' || finalPartySize > Number(table.capacity))) {
        throw new AppError('Party exceeds available table capacity', 409, 'table_capacity_exceeded');
      }
      const updates = [];
      const values = [restaurant.id, reservationId];
      if (status) { updates.push(`status=$${values.length + 1}`); values.push(status); }
      for (const [field, value, max] of [['guest_name', req.body.guestName, 160], ['guest_phone', req.body.guestPhone, 40], ['guest_email', req.body.guestEmail, 320], ['notes', req.body.notes, 2000]]) {
        if (value !== undefined) { updates.push(`${field}=$${values.length + 1}`); values.push(field === 'guest_name' ? requiredText(value, 'guest name', max) : optionalText(value, max)); }
      }
      if (req.body.partySize !== undefined) { updates.push(`party_size=$${values.length + 1}`); values.push(partySize(req.body.partySize)); }
      const startsAt = req.body.startsAt === undefined ? current.starts_at : instant(req.body.startsAt, 'start time');
      const endsAt = req.body.endsAt === undefined ? current.ends_at : instant(req.body.endsAt, 'end time');
      if (new Date(endsAt) <= new Date(startsAt)) throw new AppError('End time must be after start time', 400, 'invalid_request');
      if (current.table_id && ACTIVE_RESERVATION_STATUSES.includes(finalStatus)) {
        const { rows: conflicts } = await client.query(`SELECT id FROM restaurant_reservations
          WHERE restaurant_id=$1 AND location_id=$2 AND table_id=$3 AND id<>$4 AND status = ANY($5::text[])
            AND starts_at < $6::timestamptz AND ends_at > $7::timestamptz LIMIT 1`,
        [restaurant.id, current.location_id, current.table_id, reservationId, ACTIVE_RESERVATION_STATUSES, endsAt, startsAt]);
        if (conflicts[0]) throw new AppError('Table is already reserved for that time', 409, 'reservation_conflict');
      }
      if (req.body.startsAt !== undefined) { updates.push(`starts_at=$${values.length + 1}`); values.push(startsAt); }
      if (req.body.endsAt !== undefined) { updates.push(`ends_at=$${values.length + 1}`); values.push(endsAt); }
      if (!updates.length) throw new AppError('No reservation changes supplied', 400, 'invalid_request');
      const { rows: [updated] } = await client.query(`UPDATE restaurant_reservations SET ${updates.join(', ')}, updated_at=NOW()
        WHERE restaurant_id=$1 AND id=$2 RETURNING *`, values);
      return updated;
    }, 'restaurant_reservation_update');
    res.json({ reservation });
  } catch (error) { next(error); }
};

exports.notifyReservation = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const reservationId = positiveId(req.params.reservationId, 'reservation');
    const { rows: [reservation] } = await pool.query(`SELECT * FROM restaurant_reservations
      WHERE restaurant_id=$1 AND id=$2`, [restaurant.id, reservationId]);
    if (!reservation) throw new AppError('Reservation not found', 404, 'reservation_not_found');
    // Auth-audit item 14: the row lookup is restaurant-wide and this
    // endpoint sends the guest an SMS; assert store access first.
    await assertLocationAccess(restaurant, req.user.id, reservation.location_id);
    if (!reservation.guest_phone) throw new AppError('A phone number is required to send an SMS', 400, 'phone_required');
    if (!['pending', 'confirmed'].includes(reservation.status)) {
      throw new AppError('Reservation is no longer awaiting guest notification', 409, 'reservation_closed');
    }
    if (reservation.notified_at) {
      return res.json({ reservation, delivery: { success: true, alreadyNotified: true } });
    }
    const claimToken = crypto.randomUUID();
    const { rows: [claimed] } = await pool.query(`UPDATE restaurant_reservations
      SET notification_claimed_at=NOW(), notification_claim_token=$3, updated_at=NOW()
      WHERE restaurant_id=$1 AND id=$2 AND notified_at IS NULL
        AND (notification_claimed_at IS NULL OR notification_claimed_at < NOW() - INTERVAL '5 minutes')
      RETURNING *`, [restaurant.id, reservationId, claimToken]);
    if (!claimed) {
      const { rows: [current] } = await pool.query(`SELECT notified_at FROM restaurant_reservations
        WHERE restaurant_id=$1 AND id=$2`, [restaurant.id, reservationId]);
      if (current?.notified_at) {
        return res.json({ reservation: { ...reservation, notified_at: current.notified_at }, delivery: { success: true, alreadyNotified: true } });
      }
      throw new AppError('Reservation notification is already in progress', 409, 'reservation_notification_in_progress');
    }

    try {
      const delivery = await sendTransactionalSMS(
        reservation.guest_phone,
        hostingMessage('reservation', req.body?.locale || req.language, { restaurant: restaurant.display_name, startsAt: reservation.starts_at, confirmed: reservation.status === 'confirmed', timezone: restaurant.timezone })
      );
      if (!delivery.success) throw new AppError('SMS could not be sent', 503, 'sms_unavailable');
      const { rows: [updated] } = await pool.query(`UPDATE restaurant_reservations
        SET notified_at=NOW(), notification_claimed_at=NULL, notification_claim_token=NULL, updated_at=NOW()
        WHERE restaurant_id=$1 AND id=$2 AND notified_at IS NULL AND notification_claim_token=$3 RETURNING *`, [restaurant.id, reservationId, claimToken]);
      if (!updated) throw new AppError('Reservation notification state could not be saved', 503, 'notification_state_unavailable');
      await logBusinessAction(req, {
        business_id: restaurant.business_id,
        action: 'restaurant.reservation.notification_sent',
        target_type: 'restaurant_reservation',
        target_id: reservationId,
        after_state: { status: updated.status, notified_at: updated.notified_at },
        metadata: { channel: 'sms', provider_sid: delivery.sid || null },
      });
      res.json({ reservation: updated, delivery: { success: true, sid: delivery.sid || null } });
    } catch (error) {
      await pool.query(`UPDATE restaurant_reservations
        SET notification_claimed_at=NULL, notification_claim_token=NULL, updated_at=NOW()
        WHERE restaurant_id=$1 AND id=$2 AND notification_claim_token=$3`, [restaurant.id, reservationId, claimToken]).catch(() => {});
      throw error;
    }
  } catch (error) { next(error); }
};

exports.listWaitlist = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const location = await resolveLocation(pool, restaurant.id, req.query.locationId, restaurant, req.user.id);
    const limit = req.query.limit === undefined ? 100 : strictInteger(req.query.limit, { max: 200 });
    const offset = req.query.offset === undefined ? 0 : strictInteger(req.query.offset, { min: 0, max: 1000000 });
    const status = req.query.status;
    if (limit === null || offset === null || (status && !WAITLIST_STATUSES.includes(status))) throw new AppError('Invalid waitlist filters', 400, 'invalid_request');
    const { rows } = await pool.query(`SELECT * FROM restaurant_waitlist_entries
      WHERE restaurant_id=$1 AND location_id=$2 AND ($3::text IS NULL OR status=$3)
      ORDER BY joined_at ASC, id ASC LIMIT $4 OFFSET $5`, [restaurant.id, location.id, status || null, limit + 1, offset]);
    res.json({ location, entries: rows.slice(0, limit), limit, offset, hasMore: rows.length > limit });
  } catch (error) { next(error); }
};

exports.createWaitlistEntry = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const location = await resolveLocation(pool, restaurant.id, req.body.locationId, restaurant, req.user.id);
    const quotedWaitMin = req.body.quotedWaitMin == null ? null : Number(req.body.quotedWaitMin);
    if (quotedWaitMin !== null && (!Number.isInteger(quotedWaitMin) || quotedWaitMin < 0)) {
      throw new AppError('Invalid quoted wait', 400, 'invalid_request');
    }
    const { rows: [entry] } = await pool.query(`INSERT INTO restaurant_waitlist_entries
      (restaurant_id, location_id, guest_name, guest_phone, guest_email, party_size, quoted_wait_min, notes, created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [restaurant.id, location.id,
      requiredText(req.body.guestName, 'guest name'), optionalText(req.body.guestPhone, 40), optionalText(req.body.guestEmail),
      partySize(req.body.partySize), quotedWaitMin, optionalText(req.body.notes, 2000), req.user.id]);
    res.status(201).json({ entry });
  } catch (error) { next(error); }
};

exports.updateWaitlistEntry = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const entryId = positiveId(req.params.entryId, 'waitlist entry');
    const status = req.body.status == null ? null : String(req.body.status);
    if (status && !WAITLIST_STATUSES.includes(status)) throw new AppError('Invalid waitlist status', 400, 'invalid_request');
    const entry = await withTransaction(pool, async (client) => {
      // Auth-audit item 14: the row lookup is restaurant-wide, so a
      // store-A-scoped employee could edit a store-B waitlist entry
      // (guest PII). Lock the row, assert store access on its location,
      // then mutate — all inside one transaction.
      const { rows: [current] } = await client.query(
        'SELECT * FROM restaurant_waitlist_entries WHERE restaurant_id=$1 AND id=$2 FOR UPDATE',
        [restaurant.id, entryId]
      );
      if (!current) throw new AppError('Waitlist entry not found', 404, 'waitlist_entry_not_found');
      await assertLocationAccess(restaurant, req.user.id, current.location_id, client);
      const updates = [];
      const values = [restaurant.id, entryId];
      if (status) { updates.push(`status=$${values.length + 1}`); values.push(status); if (status === 'seated') updates.push('seated_at=NOW()'); }
      if (req.body.quotedWaitMin !== undefined) { const wait = Number(req.body.quotedWaitMin); if (!Number.isInteger(wait) || wait < 0) throw new AppError('Invalid quoted wait', 400, 'invalid_request'); updates.push(`quoted_wait_min=$${values.length + 1}`); values.push(wait); }
      if (req.body.notes !== undefined) { updates.push(`notes=$${values.length + 1}`); values.push(optionalText(req.body.notes, 2000)); }
      if (!updates.length) throw new AppError('No waitlist changes supplied', 400, 'invalid_request');
      const { rows: [updated] } = await client.query(`UPDATE restaurant_waitlist_entries SET ${updates.join(', ')}, updated_at=NOW()
        WHERE restaurant_id=$1 AND id=$2 RETURNING *`, values);
      return updated;
    }, 'restaurant_waitlist_entry_update');
    res.json({ entry });
  } catch (error) { next(error); }
};

exports.notifyWaitlistEntry = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const entryId = positiveId(req.params.entryId, 'waitlist entry');
    const { rows: [entry] } = await pool.query(`SELECT * FROM restaurant_waitlist_entries
      WHERE restaurant_id=$1 AND id=$2`, [restaurant.id, entryId]);
    if (!entry) throw new AppError('Waitlist entry not found', 404, 'waitlist_entry_not_found');
    // Auth-audit item 14: the row lookup is restaurant-wide and this
    // endpoint sends the guest an SMS; assert store access first.
    await assertLocationAccess(restaurant, req.user.id, entry.location_id);
    if (!entry.guest_phone) throw new AppError('A phone number is required to send an SMS', 400, 'phone_required');
    if (!['waiting', 'notified'].includes(entry.status)) throw new AppError('Waitlist entry is no longer active', 409, 'waitlist_entry_closed');
    if (entry.notified_at) return res.json({ entry, delivery: { success: true, alreadyNotified: true } });
    const claimToken = crypto.randomUUID();
    const { rows: [claimed] } = await pool.query(`UPDATE restaurant_waitlist_entries
      SET notification_claimed_at=NOW(), notification_claim_token=$3, updated_at=NOW()
      WHERE restaurant_id=$1 AND id=$2 AND notified_at IS NULL AND status='waiting'
        AND (notification_claimed_at IS NULL OR notification_claimed_at < NOW() - INTERVAL '5 minutes') RETURNING *`,
    [restaurant.id, entryId, claimToken]);
    if (!claimed) throw new AppError('Waitlist notification is already in progress', 409, 'waitlist_notification_in_progress');
    try {
      const delivery = await sendTransactionalSMS(entry.guest_phone,
        hostingMessage('waitlist', req.body?.locale || req.language, { restaurant: restaurant.display_name, wait: entry.quoted_wait_min }));
      if (!delivery.success) throw new AppError('SMS could not be sent', 503, 'sms_unavailable');
      const { rows: [updated] } = await pool.query(`UPDATE restaurant_waitlist_entries
        SET status='notified', notified_at=NOW(), notification_claimed_at=NULL, notification_claim_token=NULL, updated_at=NOW()
        WHERE restaurant_id=$1 AND id=$2 AND notified_at IS NULL AND status='waiting' AND notification_claim_token=$3 RETURNING *`, [restaurant.id, entryId, claimToken]);
      if (!updated) throw new AppError('Waitlist notification state could not be saved', 503, 'notification_state_unavailable');
      res.json({ entry: updated, delivery: { success: true, sid: delivery.sid || null } });
    } catch (error) {
      await pool.query(`UPDATE restaurant_waitlist_entries SET notification_claimed_at=NULL, notification_claim_token=NULL
        WHERE restaurant_id=$1 AND id=$2 AND notification_claim_token=$3`, [restaurant.id, entryId, claimToken]).catch(() => {});
      throw error;
    }
  } catch (error) { next(error); }
};

