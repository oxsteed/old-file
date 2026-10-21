'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const { withTransaction } = require('../utils/transaction');
const { sendTransactionalSMS } = require('../services/smsNotificationService');

const ACTIVE_RESERVATION_STATUSES = ['pending', 'confirmed', 'seated'];
const RESERVATION_STATUSES = ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'];
const TABLE_STATUSES = ['active', 'disabled'];
const WAITLIST_STATUSES = ['waiting', 'notified', 'seated', 'cancelled', 'expired'];

function positiveId(value, label) {
  const id = Number(value);
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

async function resolveLocation(client, restaurantId, requested) {
  const locationId = requested == null ? null : positiveId(requested, 'location');
  const result = await client.query(`SELECT id, restaurant_id, name, status, timezone
    FROM restaurant_locations
    WHERE restaurant_id=$1 AND status <> 'archived' AND ($2::bigint IS NULL AND is_primary=TRUE OR id=$2)
    ORDER BY is_primary DESC, id ASC LIMIT 1`, [restaurantId, locationId]);
  if (!result.rows[0]) throw new AppError('Location not found', 404, 'location_not_found');
  return result.rows[0];
}

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

exports.listTables = async (req, res, next) => {
  try {
    const restaurant = await access(req, ['restaurant.manage', 'pos.use', 'orders.manage']);
    const location = await resolveLocation(pool, restaurant.id, req.query.locationId);
    const { rows } = await pool.query(`SELECT * FROM restaurant_tables
      WHERE restaurant_id=$1 AND location_id=$2 ORDER BY status, section NULLS LAST, name, id`, [restaurant.id, location.id]);
    res.json({ location, tables: rows });
  } catch (error) { next(error); }
};

exports.createTable = async (req, res, next) => {
  try {
    const restaurant = await access(req, ['restaurant.manage']);
    const table = await withTransaction(pool, async (client) => {
      const location = await resolveLocation(client, restaurant.id, req.body.locationId);
      const name = requiredText(req.body.name, 'table name', 120);
      const capacity = partySize(req.body.capacity);
      const section = optionalText(req.body.section, 120);
      const position = req.body.position && typeof req.body.position === 'object' && !Array.isArray(req.body.position) ? req.body.position : {};
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
    if (req.body.position !== undefined) { updates.push(`position=$${values.length + 1}::jsonb`); values.push(JSON.stringify(req.body.position || {})); }
    if (!updates.length) throw new AppError('No table changes supplied', 400, 'invalid_request');
    const { rows: [table] } = await pool.query(`UPDATE restaurant_tables SET ${updates.join(', ')}, updated_at=NOW()
      WHERE restaurant_id=$1 AND id=$2 RETURNING *`, values);
    if (!table) throw new AppError('Table not found', 404, 'table_not_found');
    res.json({ table });
  } catch (error) { next(error); }
};

exports.listReservations = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const location = await resolveLocation(pool, restaurant.id, req.query.locationId);
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
      const location = await resolveLocation(client, restaurant.id, req.body.locationId);
      if (input.idempotencyKey) {
        const { rows: [existing] } = await client.query(`SELECT * FROM restaurant_reservations
          WHERE restaurant_id=$1 AND idempotency_key=$2 FOR UPDATE`, [restaurant.id, input.idempotencyKey]);
        if (existing) return { reservation: existing, idempotent: true };
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
      const { rows: [current] } = await client.query('SELECT * FROM restaurant_reservations WHERE restaurant_id=$1 AND id=$2 FOR UPDATE', [restaurant.id, reservationId]);
      if (!current) throw new AppError('Reservation not found', 404, 'reservation_not_found');
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
      if (current.table_id && (req.body.startsAt !== undefined || req.body.endsAt !== undefined)) {
        const { rows: conflicts } = await client.query(`SELECT id FROM restaurant_reservations
          WHERE restaurant_id=$1 AND location_id=$2 AND table_id=$3 AND id<>$4 AND status = ANY($5::text[])
            AND starts_at < $6::timestamptz AND ends_at > $7::timestamptz LIMIT 1 FOR UPDATE`,
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

exports.listWaitlist = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const location = await resolveLocation(pool, restaurant.id, req.query.locationId);
    const { rows } = await pool.query(`SELECT * FROM restaurant_waitlist_entries
      WHERE restaurant_id=$1 AND location_id=$2 ORDER BY joined_at ASC, id ASC`, [restaurant.id, location.id]);
    res.json({ location, entries: rows });
  } catch (error) { next(error); }
};

exports.createWaitlistEntry = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const location = await resolveLocation(pool, restaurant.id, req.body.locationId);
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
    const updates = [];
    const values = [restaurant.id, entryId];
    if (status) { updates.push(`status=$${values.length + 1}`); values.push(status); if (status === 'seated') updates.push('seated_at=NOW()'); }
    if (req.body.quotedWaitMin !== undefined) { const wait = Number(req.body.quotedWaitMin); if (!Number.isInteger(wait) || wait < 0) throw new AppError('Invalid quoted wait', 400, 'invalid_request'); updates.push(`quoted_wait_min=$${values.length + 1}`); values.push(wait); }
    if (req.body.notes !== undefined) { updates.push(`notes=$${values.length + 1}`); values.push(optionalText(req.body.notes, 2000)); }
    if (!updates.length) throw new AppError('No waitlist changes supplied', 400, 'invalid_request');
    const { rows: [entry] } = await pool.query(`UPDATE restaurant_waitlist_entries SET ${updates.join(', ')}, updated_at=NOW()
      WHERE restaurant_id=$1 AND id=$2 RETURNING *`, values);
    if (!entry) throw new AppError('Waitlist entry not found', 404, 'waitlist_entry_not_found');
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
    if (!entry.guest_phone) throw new AppError('A phone number is required to send an SMS', 400, 'phone_required');
    if (!['waiting', 'notified'].includes(entry.status)) throw new AppError('Waitlist entry is no longer active', 409, 'waitlist_entry_closed');
    const wait = entry.quoted_wait_min == null ? '' : ` Estimated wait: ${entry.quoted_wait_min} minutes.`;
    const delivery = await sendTransactionalSMS(entry.guest_phone, `Your table at ${restaurant.display_name || 'the restaurant'} is ready soon.${wait}`);
    if (!delivery.success) throw new AppError('SMS could not be sent', 503, 'sms_unavailable');
    const { rows: [updated] } = await pool.query(`UPDATE restaurant_waitlist_entries
      SET status='notified', notified_at=NOW(), updated_at=NOW() WHERE restaurant_id=$1 AND id=$2 RETURNING *`, [restaurant.id, entryId]);
    res.json({ entry: updated, delivery: { success: true, sid: delivery.sid || null } });
  } catch (error) { next(error); }
};

