'use strict';
// c94983de review: a pending Didit session without a saved payload (created
// before migration 99988, or cleared) must not be "reused" with no URL.
const { mockQuery, resetMocks } = require('./setup');
const { createSession, requireDiditPayload } = require('../controllers/diditController');

beforeEach(() => { resetMocks(); jest.clearAllMocks(); });

test('legacy pending session without payload creates a fresh session', async () => {
  const prevKey = process.env.DIDIT_API_KEY;
  process.env.DIDIT_API_KEY = 'synthetic-test-key';
  mockQuery
    .mockResolvedValueOnce({ rows: [{ didit_status: 'pending', didit_session_id: 'legacy-1', didit_session_payload_ciphertext: null }] })
    .mockResolvedValue({ rows: [], rowCount: 1 });
  const original = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ session_id: 'fresh-1', session_token: 't', url: 'https://verify.example.test/new' }) });
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  try {
    await createSession({ user: { id: 'user-b' } }, res);
  } finally {
    global.fetch = original;
    if (prevKey === undefined) delete process.env.DIDIT_API_KEY; else process.env.DIDIT_API_KEY = prevKey;
  }
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'fresh-1', verificationUrl: 'https://verify.example.test/new' }));
  expect(res.json.mock.calls[0][0].reused).toBeUndefined();
});

test('provider responses without a usable URL are rejected before persistence', async () => {
  const prevKey = process.env.DIDIT_API_KEY;
  process.env.DIDIT_API_KEY = 'synthetic-test-key';
  mockQuery
    .mockResolvedValueOnce({ rows: [{ didit_status: null, didit_session_id: null, didit_session_payload_ciphertext: null, identity_verified: false, id_verified: false }] })
    .mockResolvedValueOnce({ rows: [{ count: '0' }] });
  const original = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ session_id: 'fresh-2', session_token: 't', url: null }) });
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  try {
    await createSession({ user: { id: 'user-invalid-provider' } }, res);
  } finally {
    global.fetch = original;
    if (prevKey === undefined) delete process.env.DIDIT_API_KEY; else process.env.DIDIT_API_KEY = prevKey;
  }
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ error: 'verification_unavailable', code: 'didit_session_unavailable' });
  expect(mockQuery.mock.calls).toHaveLength(2);
});

test('Didit payload validation requires an HTTPS URL and session token', () => {
  expect(requireDiditPayload({ session_id: 's1', session_token: 't1', url: 'https://verify.example.test/s1' })).toEqual({
    sessionId: 's1', sessionToken: 't1', verificationUrl: 'https://verify.example.test/s1',
  });
  expect(() => requireDiditPayload({ session_id: 's1', session_token: 't1', url: 'http://verify.example.test/s1' })).toThrow();
  expect(() => requireDiditPayload({ session_id: 's1', url: 'https://verify.example.test/s1' })).toThrow();
});
