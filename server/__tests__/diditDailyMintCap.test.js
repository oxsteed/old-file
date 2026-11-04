'use strict';
// Cost audit 2026-11-04 item 9: fresh Didit mints are capped per user per
// rolling 24h, counting mints only; reusing a saved session never counts
// and bypasses the cap.
const { mockQuery, resetMocks } = require('./setup');
const { createSession } = require('../controllers/diditController');

beforeEach(() => { resetMocks(); jest.clearAllMocks(); });

function res() {
  return { json: jest.fn(), status: jest.fn().mockReturnThis() };
}

test('a user at the daily mint cap gets 429 and no provider call', async () => {
  const prevKey = process.env.DIDIT_API_KEY;
  process.env.DIDIT_API_KEY = 'synthetic-test-key';
  mockQuery
    .mockResolvedValueOnce({ rows: [{ didit_status: 'pending', didit_session_id: null, didit_session_payload_ciphertext: null, identity_verified: false, id_verified: false }] })
    .mockResolvedValueOnce({ rows: [{ count: '10' }] });
  const fetchMock = jest.fn();
  const original = global.fetch;
  global.fetch = fetchMock;
  const r = res();
  try {
    await createSession({ user: { id: 'user-capped' } }, r);
  } finally {
    global.fetch = original;
    if (prevKey === undefined) delete process.env.DIDIT_API_KEY; else process.env.DIDIT_API_KEY = prevKey;
  }
  expect(r.status).toHaveBeenCalledWith(429);
  expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'didit_daily_mint_cap' }));
  expect(fetchMock).not.toHaveBeenCalled();
});

test('a reusable session bypasses the cap without a provider call', async () => {
  const { encrypt } = require('../utils/encryption');
  const payload = encrypt(JSON.stringify({ verificationUrl: 'https://verify.example.test/open', verification_url: 'https://verify.example.test/open', sessionToken: 't', session_token: 't' }));
  mockQuery.mockResolvedValueOnce({ rows: [{ didit_status: 'pending', didit_session_id: 'saved-1', didit_session_payload_ciphertext: payload, identity_verified: false, id_verified: false }] });
  const fetchMock = jest.fn();
  const original = global.fetch;
  global.fetch = fetchMock;
  const r = res();
  try {
    await createSession({ user: { id: 'user-reuse' } }, r);
  } finally {
    global.fetch = original;
  }
  expect(r.status).toHaveBeenCalledWith(200);
  expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ reused: true, sessionId: 'saved-1' }));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(mockQuery).toHaveBeenCalledTimes(1);
});
