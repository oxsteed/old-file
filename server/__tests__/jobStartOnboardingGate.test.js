'use strict';

// Review P2-7-F01: starting a job is accepting work. The helper side of
// POST /api/jobs/:id/start must be gated on DB-fact helper onboarding
// (verified identity); the client side is unaffected.
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../utils/transaction', () => ({
  withTransaction: jest.fn(async (pool, op) => op({ query: jest.fn(async () => ({ rows: [] })) })),
  withJobTransaction: jest.fn(async (pool, op) => op({
    query: jest.fn(async (sql) => {
      if (/UPDATE jobs SET/.test(sql)) {
        return { rows: [{ id: 'job-1', client_id: 'client-1', assigned_helper_id: 'helper-1', status: 'in_progress' }] };
      }
      return { rows: [] };
    }),
  })),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));

const jobController = require('../controllers/jobController');

const incompleteFacts = {
  id: 'helper-1', role: 'helper', email_verified: true,
  profile_completed: false, contact_completed: false,
  terms_accepted: true, terms_accepted_at: new Date(), terms_version: 'v1',
  id_verified: false, identity_verified: false, didit_status: 'pending',
  background_check_status: null, background_check_passed: false,
  onboarding_completed: true, onboarding_status: 'onboarding_complete',
};
const completeFacts = {
  ...incompleteFacts,
  profile_completed: true, contact_completed: true, didit_status: 'verified',
};
const jobRow = {
  id: 'job-1', client_id: 'client-1', assigned_helper_id: 'helper-1',
  status: 'accepted', expires_at: null,
};

const req = (userId, role = 'helper') => ({ params: { id: 'job-1' }, user: { id: userId, role } });
const res = () => {
  const r = {};
  r.json = jest.fn((b) => { r.body = b; return r; });
  r.status = jest.fn(() => r);
  return r;
};

beforeEach(() => resetMocks());

test('helper with incomplete onboarding facts cannot start a job (JWT flag is not trusted)', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM jobs/.test(sql)) return { rows: [jobRow] };
    if (/FROM users/.test(sql)) return { rows: [incompleteFacts] };
    return { rows: [] };
  });
  const r = res();
  const next = jest.fn();
  await jobController.startJob(req('helper-1'), r, next);
  expect(next).toHaveBeenCalledTimes(1);
  const err = next.mock.calls[0][0];
  expect(err.statusCode).toBe(403);
  expect(err.code).toBe('helper_onboarding_incomplete');
  expect(r.json).not.toHaveBeenCalled();
});

test('helper with complete onboarding facts can start a job', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM jobs/.test(sql)) return { rows: [jobRow] };
    if (/FROM users/.test(sql)) return { rows: [completeFacts] };
    return { rows: [] };
  });
  const r = res();
  const next = jest.fn();
  await jobController.startJob(req('helper-1'), r, next);
  expect(next).not.toHaveBeenCalled();
  expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Job started' }));
});

test('client starting a job is not subject to the helper onboarding gate', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM jobs/.test(sql)) return { rows: [jobRow] };
    return { rows: [] };
  });
  const r = res();
  const next = jest.fn();
  await jobController.startJob(req('client-1', 'customer'), r, next);
  expect(next).not.toHaveBeenCalled();
  expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Job started' }));
  // The onboarding derivation query must not run for the client side.
  expect(mockQuery.mock.calls.some(([sql]) => /FROM users/.test(sql))).toBe(false);
});
