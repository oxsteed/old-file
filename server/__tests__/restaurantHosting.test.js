'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(async () => ({ id: 3, business_id: 42, display_name: 'Ox Burger Lab', effective_role: 'manager' })),
}));
jest.mock('../services/permissionsService', () => ({ hasRestaurantPermission: jest.fn(async () => true) }));
jest.mock('../services/smsNotificationService', () => ({ sendTransactionalSMS: jest.fn() }));

const hosting = require('../controllers/restaurantHostingController');
const { sendTransactionalSMS } = require('../services/smsNotificationService');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => { req.user = { id: '00000000-0000-4000-8000-000000000123' }; next(); });
  instance.post('/:restaurantId/reservations', hosting.createReservation);
  instance.patch('/:restaurantId/reservations/:reservationId', hosting.updateReservation);
  instance.post('/:restaurantId/waitlist', hosting.createWaitlistEntry);
  instance.post('/:restaurantId/waitlist/:entryId/notify', hosting.notifyWaitlistEntry);
  instance.use(errorHandler);
  return instance;
}

const location = { id: 7, restaurant_id: 3, name: 'Main', status: 'active', timezone: 'America/New_York' };
const reservation = { id: 18, restaurant_id: 3, location_id: 7, table_id: 11, guest_name: 'Ada', party_size: 2, starts_at: '2026-10-21T18:00:00.000Z', ends_at: '2026-10-21T19:00:00.000Z', status: 'confirmed' };

beforeEach(() => { resetMocks(); jest.clearAllMocks(); sendTransactionalSMS.mockResolvedValue({ success: true, sid: 'SM-test' }); });

test('reservation creation scopes the location and rejects an occupied table', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (sql.startsWith('SELECT id, restaurant_id, name, status')) return { rows: [location] };
    if (sql.startsWith('SELECT * FROM restaurant_tables')) return { rows: [{ id: 11, restaurant_id: 3, location_id: 7, capacity: 4, status: 'active' }] };
    if (sql.startsWith('SELECT id FROM restaurant_reservations')) return { rows: [{ id: 99 }] };
    return { rows: [] };
  });
  const response = await request(app()).post('/3/reservations').send({ locationId: 7, tableId: 11, guestName: 'Ada', partySize: 2, startsAt: reservation.starts_at, endsAt: reservation.ends_at });
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('reservation_conflict');
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes('restaurant_id=$1 AND location_id=$2'))).toBe(true);
});

test('reservation idempotency returns the existing record without inserting', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (sql.startsWith('SELECT id, restaurant_id, name, status')) return { rows: [location] };
    if (sql.startsWith('SELECT * FROM restaurant_reservations')) return { rows: [reservation] };
    return { rows: [] };
  });
  const response = await request(app()).post('/3/reservations').send({ locationId: 7, idempotencyKey: 'retry-1', guestName: 'Ada', partySize: 2, startsAt: reservation.starts_at, endsAt: reservation.ends_at });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ idempotent: true, reservation: { id: 18 } });
  expect(mockQuery.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO restaurant_reservations'))).toBe(false);
});

test('reservation updates validate the final time window before writing', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (sql.startsWith('SELECT * FROM restaurant_reservations')) return { rows: [reservation] };
    return { rows: [] };
  });
  const response = await request(app()).patch('/3/reservations/18').send({ startsAt: '2026-10-21T20:00:00Z' });
  expect(response.status).toBe(400);
  expect(response.body.code).toBe('invalid_request');
  expect(mockQuery.mock.calls.some(([sql]) => sql.startsWith('UPDATE restaurant_reservations'))).toBe(false);
});

test('waitlist notification sends the guest SMS then records notified state', async () => {
  const entry = { id: 23, restaurant_id: 3, location_id: 7, guest_name: 'Grace', guest_phone: '+15555550123', quoted_wait_min: 20, status: 'waiting' };
  mockQuery.mockImplementation(async (sql) => {
    if (sql.startsWith('SELECT * FROM restaurant_waitlist_entries')) return { rows: [entry] };
    if (sql.startsWith('UPDATE restaurant_waitlist_entries')) return { rows: [{ ...entry, status: 'notified', notified_at: '2026-10-21T18:00:00Z' }] };
    return { rows: [] };
  });
  const response = await request(app()).post('/3/waitlist/23/notify');
  expect(response.status).toBe(200);
  expect(response.body.entry.status).toBe('notified');
  expect(sendTransactionalSMS).toHaveBeenCalledWith('+15555550123', expect.stringContaining('20 minutes'));
});

