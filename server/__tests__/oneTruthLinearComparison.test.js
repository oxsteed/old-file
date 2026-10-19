'use strict';

require('./setup');
const { linkSignalGroups, comparisonMode, PAIRWISE_DEPRECATION } = require('../services/oneTruthPairing');
const { _buildSuspectPairsIndexed } = require('../controllers/oneTruthController');

const ids = (n) => Array.from({ length: n }, (_, i) => `u${String(i).padStart(4, '0')}`);
const group = (userIds, signalType = 'same_ip') => ({ signalType, label: 'Same last login IP', weight: 2, userIds });

describe('decision 10: One Truth linear comparison', () => {
  test('each member is linked once to the group reference (k-1 links)', () => {
    const { pairs, groups } = linkSignalGroups([group(ids(5))]);
    expect(pairs).toHaveLength(4);
    expect(pairs.every((p) => p.userA.id === 'u0000' && p.referenceUserId === 'u0000')).toBe(true);
    expect(pairs.map((p) => p.userB.id)).toEqual(['u0001', 'u0002', 'u0003', 'u0004']);
    expect(groups).toEqual([{ signalType: 'same_ip', label: 'Same last login IP', weight: 2, referenceUserId: 'u0000', memberIds: ids(5), size: 5 }]);
  });

  test('a 5,000-user shared IP yields 4,999 links, not ~12.5M', () => {
    const { pairs } = linkSignalGroups([group(ids(5000))]);
    expect(pairs).toHaveLength(4999);
  });

  test('the deprecated pairwise shape is still available', () => {
    const { pairs } = linkSignalGroups([group(ids(5))], 'pairwise');
    expect(pairs).toHaveLength(10);
    expect(pairs[0].referenceUserId).toBeUndefined();
    expect(PAIRWISE_DEPRECATION.deprecated).toBe(true);
  });

  test('comparison mode defaults to linear', () => {
    expect(comparisonMode(undefined)).toBe('linear');
    expect(comparisonMode('PAIRWISE')).toBe('pairwise');
    expect(comparisonMode('anything')).toBe('linear');
  });

  test('signals are linked per group and duplicates within a signal are dropped', () => {
    const { pairs } = linkSignalGroups([group(['a', 'b', 'b']), group(['a', 'b'], 'same_phone'), group(['z'])]);
    expect(pairs.map((p) => `${p.userA.id}-${p.userB.id}-${p.signals[0].type}`)).toEqual(['a-b-same_ip', 'a-b-same_phone']);
  });

  test('the earliest account is the reference (SQL orders members by created_at)', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ phone: '1', user_ids: ['old', 'mid', 'new'] }] })
      .mockResolvedValueOnce({ rows: [] }) };
    const { pairs, groups } = await _buildSuspectPairsIndexed(client, ['old', 'mid', 'new'], { withGroups: true });
    expect(client.query.mock.calls[0][0]).toMatch(/array_agg\(id ORDER BY created_at ASC NULLS LAST, id\)/);
    expect(groups[0].referenceUserId).toBe('old');
    expect(pairs.map((p) => [p.userA.id, p.userB.id])).toEqual([['old', 'mid'], ['old', 'new']]);
    // Default return stays an array of pairs for existing callers.
    client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    expect(await _buildSuspectPairsIndexed(client, ['x'])).toEqual([]);
  });
});
