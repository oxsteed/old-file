'use strict';
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const directController = require('../controllers/directController');

beforeEach(() => resetMocks());

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.user = { id: 'user-1', email: 'guest@example.com' };
    next();
  });
  a.post('/direct/requests/claim', directController.claimGuestRequest);
  return a;
}

const guestRequest = {
  id: 42,
  user_id: null,
  email: 'guest@example.com',
  public_reference: 'DQ-ABC123',
};

describe('POST /direct/requests/claim (P1-4-F01)', () => {
  test('404 when the reference does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app()).post('/direct/requests/claim').send({ publicReference: 'DQ-NOPE' });
    expect(res.status).toBe(404);
  });

  test('403 when the request email differs from the account email', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...guestRequest, email: 'someone-else@example.com' }] });
    const res = await request(app()).post('/direct/requests/claim').send({ publicReference: 'DQ-ABC123' });
    expect(res.status).toBe(403);
  });

  test('404 when the request is already owned by someone else', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...guestRequest, user_id: 'user-9' }] });
    const res = await request(app()).post('/direct/requests/claim').send({ publicReference: 'DQ-ABC123' });
    expect(res.status).toBe(404);
  });

  test('claims the request when the emails match', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [guestRequest] }) // loadRequestByPublicReference
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // UPDATE claim
      .mockResolvedValueOnce({ rows: [] }); // appendEvent
    const res = await request(app()).post('/direct/requests/claim').send({ publicReference: 'DQ-ABC123' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, requestId: '42' });
    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[0]).toMatch(/SET user_id = \$1/);
    expect(updateCall[1]).toEqual(['user-1', 42]);
  });

  test('409 when the request was claimed concurrently', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [guestRequest] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE matched nothing
    const res = await request(app()).post('/direct/requests/claim').send({ publicReference: 'DQ-ABC123' });
    expect(res.status).toBe(409);
  });
});
