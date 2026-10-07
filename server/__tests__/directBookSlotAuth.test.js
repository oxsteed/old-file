'use strict';

// P0 (2026-10-07): the Direct instant-book endpoint was unauthenticated, so
// anyone could create scheduled quote_requests with user_id NULL and
// payment_status='unpaid'. The route is now behind authenticate (matching
// the holds route), the service layer enforces the Bookable gate, and the
// service refuses ownerless unpaid scheduled bookings fail-closed.

jest.mock('../services/directSlotEngine', () => ({
  computeServiceSlots: jest.fn(),
  createHold: jest.fn(),
  bookServiceSlot: jest.fn(),
  getServiceAssigneePool: jest.fn(),
  setServiceAssigneePool: jest.fn(),
  expireHolds: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { bookServiceSlot } = require('../services/directSlotEngine');

const app = express();
app.use(express.json());
app.use('/direct', require('../routes/direct'));

const OWNER = '11111111-1111-4111-8111-111111111111';
const user = {
  id: OWNER,
  role: 'customer',
  default_mode: 'customer',
  email: 'synthetic@example.invalid',
  is_active: true,
  email_verified: true,
  id_verified: true,
  didit_status: 'verified',
  totp_enabled: true,
};

function bearer(claims = {}) {
  return `Bearer ${jwt.sign({ id: OWNER, role: user.role, ...claims }, process.env.JWT_SECRET, { algorithm: 'HS256' })}`;
}

const payload = {
  startsAt: '2026-10-08T10:00:00.000Z',
  endsAt: '2026-10-08T11:00:00.000Z',
  firstName: 'Casey',
  email: 'casey@example.invalid',
  serviceLocation: '123 Main St',
};

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  // authenticate looks the token up in the users table
  mockQuery.mockImplementation(async () => ({ rows: [user] }));
});

test('unauthenticated book request is rejected with 401 and never reaches the service', async () => {
  const res = await request(app)
    .post('/direct/catalog/services/svc-1/book')
    .send(payload)
    .expect(401);

  expect(res.body.error).toBe('No token provided');
  expect(bookServiceSlot).not.toHaveBeenCalled();
});

test('authenticated book on a non-bookable service is refused (Bookable gate)', async () => {
  const err = new Error('This service is not currently bookable');
  err.statusCode = 400;
  err.code = 'not_bookable';
  bookServiceSlot.mockRejectedValueOnce(err);

  const res = await request(app)
    .post('/direct/catalog/services/svc-1/book')
    .set('Authorization', bearer())
    .send(payload)
    .expect(400);

  expect(res.body.code).toBe('not_bookable');
  expect(bookServiceSlot).toHaveBeenCalledWith(
    expect.objectContaining({ serviceId: 'svc-1', actorUserId: OWNER })
  );
});

test('authenticated book on a bookable service creates the booking with the user as owner', async () => {
  bookServiceSlot.mockResolvedValueOnce({
    request: { id: 7, status: 'scheduled' },
    startsAt: payload.startsAt,
    endsAt: payload.endsAt,
    serviceId: 'svc-1',
    serviceName: 'Sink fix',
  });

  const res = await request(app)
    .post('/direct/catalog/services/svc-1/book')
    .set('Authorization', bearer())
    .send(payload)
    .expect(201);

  expect(res.body.success).toBe(true);
  expect(res.body.requestId).toBe('7');
  expect(bookServiceSlot).toHaveBeenCalledWith(
    expect.objectContaining({ serviceId: 'svc-1', actorUserId: OWNER })
  );
});

test('service layer fails closed: refuses ownerless bookings before touching the DB', async () => {
  // jest.requireActual bypasses the module mock above so the real
  // fail-closed check is exercised.
  const { bookServiceSlot: realBook } = jest.requireActual('../services/directSlotEngine');

  await expect(
    realBook({
      serviceId: 'svc-1',
      startsAt: payload.startsAt,
      endsAt: payload.endsAt,
      actorUserId: null,
      contact: {
        firstName: payload.firstName,
        email: payload.email,
        serviceLocation: payload.serviceLocation,
      },
    })
  ).rejects.toMatchObject({ statusCode: 401, code: 'auth_required' });

  expect(mockQuery).not.toHaveBeenCalled();
});
