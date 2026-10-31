'use strict';

/**
 * Q3 One Truth scale redesign: scoped discovery replaces the 5,000-row cap.
 *
 * - The scoped builder issues the two GROUP BY queries over the scoped user
 *   set directly: no LIMIT 5000, no `id = ANY($1)` id-array round trip.
 * - On the same underlying user set, the scoped builder produces exactly
 *   the same pairs, in the same order, as the old indexed builder (the
 *   pairing logic itself is unchanged; only discovery widens).
 * - The pair guard aborts with 413 instead of materializing unbounded pairs.
 */

require('./setup');
const { linkSignalGroups } = require('../services/oneTruthPairing');
const {
  _buildSuspectPairsIndexed,
  _buildSuspectPairsScoped,
  _oneTruthMaxPairs,
} = require('../controllers/oneTruthController');

// Synthetic users: two phone groups, two IP groups (one overlapping the
// phone groups), singletons, one admin (out of scope), one deleted (out of scope).
const USERS = [
  { id: 'u01', created_at: '2024-01-01T00:00:00Z', phone: '+15550001', last_login_ip: '10.0.0.1', deleted_at: null, role: 'helper' },
  { id: 'u02', created_at: '2024-01-02T00:00:00Z', phone: '+15550001', last_login_ip: '10.0.0.2', deleted_at: null, role: 'helper' },
  { id: 'u03', created_at: '2024-01-03T00:00:00Z', phone: '+15550002', last_login_ip: '10.0.0.1', deleted_at: null, role: 'helper' },
  { id: 'u04', created_at: '2024-01-04T00:00:00Z', phone: '+15550002', last_login_ip: '10.0.0.1', deleted_at: null, role: 'customer' },
  { id: 'u05', created_at: '2024-01-05T00:00:00Z', phone: '+15550003', last_login_ip: '10.0.0.9', deleted_at: null, role: 'helper' },
  { id: 'u06', created_at: '2024-01-06T00:00:00Z', phone: null, last_login_ip: '10.0.0.9', deleted_at: null, role: 'helper' },
  { id: 'u07', created_at: '2024-01-07T00:00:00Z', phone: '+15550009', last_login_ip: '10.0.0.7', deleted_at: null, role: 'helper' },
  { id: 'u08', created_at: '2024-01-08T00:00:00Z', phone: '+15550001', last_login_ip: '10.0.0.8', deleted_at: null, role: 'admin' },
  { id: 'u09', created_at: '2024-01-09T00:00:00Z', phone: '+15550001', last_login_ip: '10.0.0.8', deleted_at: '2024-02-01T00:00:00Z', role: 'helper' },
];

const IN_SCOPE = USERS.filter((u) => !u.deleted_at && !['admin', 'super_admin'].includes(u.role));

function groupRows(users, key) {
  const map = new Map();
  for (const u of users) {
    const k = u[key];
    if (k === null || k === undefined || k === '') continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(u);
  }
  const rows = [];
  for (const [, members] of map) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
    rows.push({ user_ids: sorted.map((m) => m.id), [key]: members[0][key] });
  }
  return rows;
}

// Mock client emulating SQL semantics for both builders. Old builder:
// `id = ANY($1)` filters to the passed ids. Scoped builder: no id param;
// scope conditions (deleted_at, non-admin role) apply to the full set.
function mockClient(seen) {
  return {
    query: jest.fn(async (sql, params) => {
      seen.push(sql);
      if (sql.includes('GROUP BY phone')) {
        const users = params && params[0] ? IN_SCOPE.filter((u) => params[0].includes(u.id)) : IN_SCOPE;
        return { rows: groupRows(users, 'phone').map((r) => ({ phone: r.phone, user_ids: r.user_ids })) };
      }
      if (sql.includes('GROUP BY last_login_ip')) {
        const users = params && params[0] ? IN_SCOPE.filter((u) => params[0].includes(u.id)) : IN_SCOPE;
        return { rows: groupRows(users, 'last_login_ip').map((r) => ({ last_login_ip: r.last_login_ip, user_ids: r.user_ids })) };
      }
      return { rows: [] };
    }),
  };
}

const SCOPE = { country: '', regionDef: null, warnings: [] };
const pairKey = (p) => `${p.userA.id}|${p.userB.id}|${p.signals[0].type}|${p.score}|${p.referenceUserId || ''}`;

describe('Q3: scoped suspect discovery', () => {
  test('scoped builder issues GROUP BY queries with no LIMIT and no id array', async () => {
    const seen = [];
    const client = mockClient(seen);
    await _buildSuspectPairsScoped(client, SCOPE, null, { withGroups: true });
    const groupSql = seen.filter((s) => s.includes('GROUP BY'));
    expect(groupSql).toHaveLength(2);
    for (const sql of groupSql) {
      expect(sql).not.toMatch(/LIMIT 5000/);
      expect(sql).not.toMatch(/id = ANY/);
      expect(sql).toMatch(/deleted_at IS NULL/);
      expect(sql).toMatch(/NOT IN \('admin','super_admin'\)/);
    }
  });

  test('scoped output is identical to the old indexed output, same order', async () => {
    const seen = [];
    const client = mockClient(seen);
    const oldPairs = await _buildSuspectPairsIndexed(client, IN_SCOPE.map((u) => u.id), { withGroups: false });
    const scoped = await _buildSuspectPairsScoped(client, SCOPE, null, { withGroups: true });
    expect(scoped.pairs.map(pairKey)).toEqual(oldPairs.map(pairKey));
    // Sanity: the fixture really exercises both signals and the reference shape.
    expect(scoped.pairs.length).toBeGreaterThan(0);
    expect(scoped.groups.every((g) => g.referenceUserId === g.memberIds[0])).toBe(true);
    expect(scoped.pairs.map(pairKey)).toContain('u01|u02|same_phone|3|u01');
    expect(scoped.pairs.map(pairKey)).toContain('u01|u03|same_ip|3|u01');
    // Out-of-scope users never appear.
    expect(scoped.pairs.flatMap((p) => [p.userA.id, p.userB.id])).not.toContain('u08');
    expect(scoped.pairs.flatMap((p) => [p.userA.id, p.userB.id])).not.toContain('u09');
  });

  test('pairwise mode is unchanged by the redesign (still capped at 100)', async () => {
    const seen = [];
    const client = mockClient(seen);
    const oldPairs = await _buildSuspectPairsIndexed(client, IN_SCOPE.map((u) => u.id), { mode: 'pairwise' });
    const scoped = await _buildSuspectPairsScoped(client, SCOPE, null, { mode: 'pairwise' });
    expect(scoped.map(pairKey)).toEqual(oldPairs.map(pairKey));
  });

  test('pair guard aborts with 413 instead of materializing unbounded pairs', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `u${String(i).padStart(2, '0')}`);
    const groups = [{ signalType: 'same_ip', label: 'Same last login IP', weight: 3, userIds: ids }];
    expect(() => linkSignalGroups(groups, 'linear', { maxPairs: 10 })).toThrow('refine the scope');
    try {
      linkSignalGroups(groups, 'linear', { maxPairs: 10 });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.statusCode).toBe(413);
      expect(err.code).toBe('one_truth_pair_limit_exceeded');
    }
    // Unbounded by default: existing callers and tests are unaffected.
    expect(linkSignalGroups(groups, 'linear').pairs).toHaveLength(49);
  });

  test('max pairs defaults to 100000 and honors the env override', () => {
    const prev = process.env.ONE_TRUTH_MAX_PAIRS;
    try {
      delete process.env.ONE_TRUTH_MAX_PAIRS;
      expect(_oneTruthMaxPairs()).toBe(100000);
      process.env.ONE_TRUTH_MAX_PAIRS = '250';
      expect(_oneTruthMaxPairs()).toBe(250);
      process.env.ONE_TRUTH_MAX_PAIRS = 'not-a-number';
      expect(_oneTruthMaxPairs()).toBe(100000);
    } finally {
      if (prev === undefined) delete process.env.ONE_TRUTH_MAX_PAIRS;
      else process.env.ONE_TRUTH_MAX_PAIRS = prev;
    }
  });
});
