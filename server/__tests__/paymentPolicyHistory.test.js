'use strict';

const fs = require('fs');
const path = require('path');
const { mockQuery, resetMocks } = require('./setup');

const policiesCtrl = require('../controllers/helperCancellationPoliciesController');

function mockResponse() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const USER_A = '00000000-0000-4000-8000-000000000111';
const USER_B = '00000000-0000-4000-8000-000000000222';

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('diffPaymentPolicyChanges', () => {
  const diff = policiesCtrl.diffPaymentPolicyChanges;
  const state = (customEnabled, policy) => ({
    oxsteed_enabled: true,
    custom_enabled: customEnabled,
    custom_policy: policy,
  });

  test('detects added, removed, and updated payment methods', () => {
    const changes = diff(
      state(true, {
        payment_details: [
          { label: 'Mobile money', handle: '111' },
          { label: 'Cash' },
        ],
      }),
      state(true, {
        payment_details: [
          { label: '  MOBILE money ', handle: '222' },
          { label: 'Bank transfer' },
        ],
      })
    );
    expect(changes).toEqual([
      { kind: 'payment_method_updated', label: 'MOBILE money' },
      { kind: 'payment_method_added', label: 'Bank transfer' },
      { kind: 'payment_method_removed', label: 'Cash' },
    ]);
  });

  test('ignores identical payment methods even with label case differences', () => {
    const changes = diff(
      state(true, { payment_details: [{ label: 'Mobile money', handle: '111' }] }),
      state(true, { payment_details: [{ label: 'mobile MONEY', handle: '111' }] })
    );
    expect(changes).toEqual([]);
  });

  test('detects deposit, notice, and terms changes', () => {
    const changes = diff(
      state(true, { deposit_percent: 10, min_notice_hours: 24, terms: 'old terms' }),
      state(true, { deposit_percent: 25, min_notice_hours: 48, terms: 'new terms' })
    );
    expect(changes).toEqual([
      { kind: 'deposit_changed', from: 10, to: 25 },
      { kind: 'notice_changed', from: 24, to: 48 },
      { kind: 'terms_changed' },
    ]);
  });

  test('detects deposit added from nothing and terms cleared', () => {
    const changes = diff(state(true, {}), state(true, { deposit_percent: 15, terms: 'x' }));
    expect(changes).toEqual([
      { kind: 'deposit_changed', from: null, to: 15 },
      { kind: 'terms_changed' },
    ]);
  });

  test('detects custom enable and disable toggles', () => {
    expect(diff(state(false, {}), state(true, {}))).toEqual([{ kind: 'custom_enabled' }]);
    expect(diff(state(true, {}), state(false, {}))).toEqual([{ kind: 'custom_disabled' }]);
  });

  test('returns an empty diff when nothing changed', () => {
    const policy = {
      deposit_percent: 10,
      min_notice_hours: 24,
      terms: 'same',
      payment_details: [{ label: 'Mobile money', handle: '111' }],
    };
    expect(diff(state(true, policy), state(true, JSON.parse(JSON.stringify(policy))))).toEqual([]);
  });

  test('treats a missing old state as disabled defaults', () => {
    const changes = diff(null, state(true, { payment_details: [{ label: 'Mobile money' }] }));
    expect(changes).toEqual([
      { kind: 'payment_method_added', label: 'Mobile money' },
      { kind: 'custom_enabled' },
    ]);
  });
});

describe('updatePolicies history recording', () => {
  test('writes a history row with the right changes on the update path', async () => {
    const previousRow = {
      custom_policy: {
        deposit_percent: 10,
        min_notice_hours: 24,
        terms: 'old terms',
        payment_details: [{ label: 'Mobile money', handle: '111' }, { label: 'Cash' }],
      },
      custom_enabled: true,
      oxsteed_enabled: true,
    };
    const updatedRow = {
      id: 7,
      helper_id: USER_A,
      oxsteed_enabled: true,
      custom_enabled: true,
      custom_policy: {},
      updated_at: new Date('2026-09-28T12:00:00Z'),
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [previousRow] }) // SELECT previous
      .mockResolvedValueOnce({ rows: [updatedRow] }); // UPDATE
    const req = {
      user: { id: USER_A },
      body: {
        custom_enabled: true,
        custom_policy: {
          deposit_percent: 20,
          min_notice_hours: 24,
          terms: 'new terms',
          payment_details: [
            { label: 'Mobile money', handle: '222' },
            { label: 'Bank transfer' },
          ],
        },
      },
    };
    const res = mockResponse();
    const next = jest.fn();
    await policiesCtrl.updatePolicies(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(3);

    const historyCall = mockQuery.mock.calls[2];
    expect(historyCall[0]).toContain('helper_payment_policy_history');
    const params = historyCall[1];
    expect(params[0]).toBe(USER_A);
    expect(JSON.parse(params[1])).toEqual([
      { kind: 'payment_method_updated', label: 'Mobile money' },
      { kind: 'payment_method_added', label: 'Bank transfer' },
      { kind: 'payment_method_removed', label: 'Cash' },
      { kind: 'deposit_changed', from: 10, to: 20 },
      { kind: 'terms_changed' },
    ]);
    // Snapshot stores the new custom_policy, including sanitized payment details
    expect(JSON.parse(params[2]).payment_details).toEqual([
      { label: 'Mobile money', handle: '222' },
      { label: 'Bank transfer' },
    ]);
  });

  test('writes a history row on the insert path diffed against disabled defaults', async () => {
    const storedPolicy = {
      id: 8,
      helper_id: USER_A,
      oxsteed_enabled: true,
      custom_enabled: true,
      custom_policy: {},
      updated_at: new Date('2026-09-28T12:00:00Z'),
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT previous: none
      .mockResolvedValueOnce({ rows: [] }) // UPDATE: no row
      .mockResolvedValueOnce({ rows: [storedPolicy] }); // INSERT policy
    const req = {
      user: { id: USER_A },
      body: {
        custom_enabled: true,
        custom_policy: { payment_details: [{ label: 'Mobile money' }] },
      },
    };
    const res = mockResponse();
    const next = jest.fn();
    await policiesCtrl.updatePolicies(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const historyCall = mockQuery.mock.calls[3];
    expect(JSON.parse(historyCall[1][1])).toEqual([
      { kind: 'payment_method_added', label: 'Mobile money' },
      { kind: 'custom_enabled' },
    ]);
  });

  test('writes no history row when nothing changed', async () => {
    const policy = {
      deposit_percent: 10,
      payment_details: [{ label: 'Mobile money' }],
    };
    const row = {
      custom_policy: JSON.parse(JSON.stringify(policy)),
      custom_enabled: true,
      oxsteed_enabled: true,
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [row] }) // SELECT previous
      .mockResolvedValueOnce({ rows: [{ ...row, id: 7 }] }); // UPDATE
    const req = {
      user: { id: USER_A },
      body: { custom_enabled: true, custom_policy: JSON.parse(JSON.stringify(policy)) },
    };
    const res = mockResponse();
    const next = jest.fn();
    await policiesCtrl.updatePolicies(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(2); // no history INSERT
  });

  test('a failing history write never breaks the policy update', async () => {
    const previousRow = { custom_policy: {}, custom_enabled: false, oxsteed_enabled: true };
    mockQuery
      .mockResolvedValueOnce({ rows: [previousRow] }) // SELECT previous
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // UPDATE
      .mockRejectedValueOnce(new Error('history table missing')); // history INSERT fails
    const req = {
      user: { id: USER_A },
      body: { custom_enabled: true, custom_policy: {} },
    };
    const res = mockResponse();
    const next = jest.fn();
    await policiesCtrl.updatePolicies(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });
});

describe('getPolicyHistory', () => {
  test('returns newest-first history scoped to the requesting helper', async () => {
    const rows = [
      { id: 2, created_at: '2026-09-28T12:00:00Z', changes: [{ kind: 'terms_changed' }], snapshot: {} },
      { id: 1, created_at: '2026-09-27T12:00:00Z', changes: [{ kind: 'custom_enabled' }], snapshot: {} },
    ];
    mockQuery.mockResolvedValueOnce({ rows });
    const req = { user: { id: USER_B } };
    const res = mockResponse();
    const next = jest.fn();
    await policiesCtrl.getPolicyHistory(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const sql = mockQuery.mock.calls[0][0];
    const params = mockQuery.mock.calls[0][1];
    expect(sql).toContain('helper_payment_policy_history');
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(sql).toContain('LIMIT 50');
    expect(params[0]).toBe(USER_B);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { history: rows },
    });
  });

  test('returns an empty list when the helper has no history', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = mockResponse();
    const next = jest.fn();
    await policiesCtrl.getPolicyHistory({ user: { id: USER_A } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { history: [] } });
  });
});

describe('migration 579 static checks', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '579_payment_policy_change_history.sql'),
    'utf8'
  );

  test('creates the helper_payment_policy_history table with required columns', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS helper_payment_policy_history');
    expect(sql).toContain('helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE');
    expect(sql).toContain('changes JSONB NOT NULL');
    expect(sql).toContain('snapshot JSONB');
  });

  test('adds a helper recency index and both immutability rules', () => {
    expect(sql).toContain('idx_helper_payment_policy_history_helper');
    expect(sql).toContain('helper_payment_policy_history_no_update');
    expect(sql).toContain('helper_payment_policy_history_no_delete');
    expect(sql).toContain('DO INSTEAD NOTHING');
  });
});
