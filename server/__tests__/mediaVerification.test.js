'use strict';

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue(undefined) }));

const pool = require('../db');
const audit = require('../services/auditService');
const verification = require('../controllers/mediaVerificationController');
const verificationAdmin = require('../controllers/mediaVerificationAdminController');

function resMock() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('OxSteed Media verification paths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockReset();
    pool.connect.mockReset();
  });

  test('returns Didit, business, and restaurant status for the signed-in owner', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ is_verified: false, didit_status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [{ id: '12', business_name: 'Local Works', is_verified: false, request_status: 'submitted' }] })
      .mockResolvedValueOnce({ rows: [{ id: '7', display_name: 'Ox Cafe', is_verified: true }] });
    const res = resMock();

    await verification.getCenter({ user: { id: 'user-1' } }, res);

    expect(res.json).toHaveBeenCalledWith({
      helper: { is_verified: false, didit_status: 'pending' },
      businesses: expect.arrayContaining([expect.objectContaining({ id: '12' })]),
      restaurants: expect.arrayContaining([expect.objectContaining({ id: '7', is_verified: true })]),
    });
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  test('preserves an operational verification dependency error', async () => {
    pool.query.mockRejectedValueOnce({
      status: 503,
      isOperational: true,
      code: 'media_identity_unavailable',
      message: 'Identity verification is temporarily unavailable.',
    });
    const res = resMock();

    await verification.getCenter({ user: { id: 'user-1' } }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Identity verification is temporarily unavailable.',
      code: 'media_identity_unavailable',
    });
  });

  test('keeps unknown verification failures generic', async () => {
    pool.query.mockRejectedValueOnce(new Error('database password leaked'));
    const res = resMock();

    await verification.getCenter({ user: { id: 'user-1' } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to load verification status.',
      code: 'media_verification_load_failed',
    });
  });

  test('only creates a request for an owned unverified entity', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect.mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: '7', display_name: 'Ox Cafe', is_verified: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'request-1', status: 'submitted' }] })
      .mockResolvedValueOnce({});
    const res = resMock();

    await verification.createRequest({
      user: { id: 'user-1' },
      body: { entity_type: 'restaurant', entity_id: '7', details: { notes: 'Downtown location' } },
    }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ request: expect.objectContaining({ id: 'request-1' }) });
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO media_verification_requests'))).toBe(true);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('admin approval updates the entity flag and records an audit row in one transaction', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect.mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'request-1', requester_user_id: 'user-1', entity_type: 'business', entity_id: '12', status: 'submitted' }] })
      .mockResolvedValueOnce({ rows: [{ id: '12', display_name: 'Local Works', is_verified: false }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const res = resMock();

    await verificationAdmin.reviewVerificationRequest({
      params: { id: 'request-1' },
      user: { id: 'admin-1' },
      body: { status: 'approved', note: 'Ownership confirmed.' },
      ip: '127.0.0.1',
      headers: {},
    }, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true, status: 'approved', request_id: 'request-1' });
    expect(client.query.mock.calls.some(([sql]) => sql.includes('UPDATE businesses SET is_business_verified = TRUE'))).toBe(true);
    expect(audit.logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ client, throwOnError: true, action: 'media_verification_approved' }));
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });
});
