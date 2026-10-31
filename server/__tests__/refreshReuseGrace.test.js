'use strict';

/**
 * Auth audit item 11: the 60s refresh-reuse grace covers ONLY the first
 * in-window replay of the same token value (a possible double-submit
 * after a dropped response). A second replay, or any replay outside the
 * window, revokes the token family. Drives the real auth.refreshToken
 * with SQL-pattern mocks (ws1 harness style):
 *   - first in-window replay (rotation child 30s old, no marker) -> 401
 *     token_reuse, marker UPDATE written, NO family-revoke UPDATE;
 *   - second replay (marker set) within the window -> family-revoke
 *     UPDATE covering the presented session and its rotation child;
 *   - replay after the window (child 120s old, no marker) -> revoke;
 *   - a stale token with no rotation child -> no revoke and no marker
 *     (trigger-superseded/logout rows must never hand out a kill-all).
 * In every case the caller still answers 401 token_reuse, so the response
 * reveals nothing about whether a family revoke happened.
 */

const { mockQuery, resetMocks } = require('./setup');
const auth = require('../controllers/authController');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.cookie = jest.fn(() => res);
  res.clearCookie = jest.fn(() => res);
  res.setHeader = jest.fn();
  res.getHeader = jest.fn(() => undefined);
  return res;
}

function installMocks({ childCreatedAt, marker }) {
  mockQuery.mockImplementation((sql) => {
    if (/FROM sessions s WHERE/i.test(sql)) {
      return Promise.resolve({
        rows: [{
          id: 'sess-old',
          user_id: 'u1',
          is_valid: false,
          is_revoked: true,
          refresh_replay_noted_at: marker || null,
          created_at: new Date(Date.now() - 3600 * 1000).toISOString(),
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          absolute_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        }],
      });
    }
    if (/ORDER BY created_at DESC LIMIT 1/i.test(sql)) {
      // Rotation-child lookup (newest first).
      return Promise.resolve({
        rows: childCreatedAt ? [{ id: 'sess-new', created_at: childCreatedAt }] : [],
      });
    }
    if (/regenerated_from_session_id/i.test(sql)) {
      // Chain walk: no further descendants in these tests.
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

function callsMatching(pattern) {
  return mockQuery.mock.calls.filter(([sql]) => pattern.test(sql));
}

async function replay() {
  const res = mockRes();
  const next = jest.fn();
  await auth.refreshToken({ body: { refreshToken: 'stale-token' }, headers: {} }, res, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'token_reuse', status: 401 }));
  return next;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('item 11: refresh-reuse grace', () => {
  test('first in-window replay notes the replay but does not revoke', async () => {
    installMocks({ childCreatedAt: new Date(Date.now() - 30 * 1000).toISOString(), marker: null });
    await replay();
    expect(callsMatching(/SET refresh_replay_noted_at/i)).toHaveLength(1);
    expect(callsMatching(/WHERE id = ANY/i)).toHaveLength(0);
  });

  test('second in-window replay revokes the family', async () => {
    installMocks({
      childCreatedAt: new Date(Date.now() - 30 * 1000).toISOString(),
      marker: new Date(Date.now() - 10 * 1000).toISOString(),
    });
    await replay();
    const revokes = callsMatching(/WHERE id = ANY/i);
    expect(revokes).toHaveLength(1);
    expect(revokes[0][1][0]).toEqual(expect.arrayContaining(['sess-old', 'sess-new']));
    expect(callsMatching(/SET refresh_replay_noted_at/i)).toHaveLength(0);
  });

  test('replay after the window revokes even without a marker', async () => {
    installMocks({ childCreatedAt: new Date(Date.now() - 120 * 1000).toISOString(), marker: null });
    await replay();
    expect(callsMatching(/WHERE id = ANY/i)).toHaveLength(1);
  });

  test('a stale token with no rotation child revokes nothing', async () => {
    installMocks({ childCreatedAt: null, marker: null });
    await replay();
    expect(callsMatching(/WHERE id = ANY/i)).toHaveLength(0);
    expect(callsMatching(/SET refresh_replay_noted_at/i)).toHaveLength(0);
  });
});
