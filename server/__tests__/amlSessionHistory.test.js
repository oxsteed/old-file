'use strict';

jest.mock('../services/complianceCaseService', () => ({ openComplianceCase: jest.fn(async () => ({ id: 'synthetic-case' })) }));
const { openComplianceCase } = require('../services/complianceCaseService');
const { runBatchRules } = require('../services/creditCompliance/amlRules');

beforeEach(() => jest.clearAllMocks());

test('AML device evidence includes historical sessions and opens cases without granting authentication', async () => {
  const subjects = ['synthetic-one', 'synthetic-two', 'synthetic-three'];
  const client = { query: jest.fn(async sql => ({ rows: /FROM\s+sessions\b/i.test(sql)
    ? [{ fingerprint: 'synthetic-device', users: subjects }] : [] })) };
  const result = await runBatchRules({ client });
  expect(result).toEqual({ structuring: 0, deviceLinkage: 1, crossBorder: 0, largePayout: 0 });
  const [query, params] = client.query.mock.calls.find(([sql]) => /FROM\s+sessions\b/i.test(sql));
  expect(query).toMatch(/s\.created_at >= NOW\(\) - INTERVAL '30 days'/);
  expect(query).toMatch(/s\.ip_address IS NOT NULL/);
  // Revoked/invalid sessions still describe a historical device. Applying
  // live-session authorization filters here would hide that evidence.
  expect(query).not.toMatch(/s\.(?:is_valid|is_revoked)\s*(?:=|IS\b)/i);
  expect(params).toEqual([3]);
  expect(openComplianceCase).toHaveBeenCalledTimes(3);
  expect(openComplianceCase.mock.calls.map(([, args]) => args.subjectId)).toEqual(subjects);
  for (const [, args] of openComplianceCase.mock.calls) {
    expect(args).toMatchObject({ caseType: 'device_linkage', subjectType: 'customer', severity: 'medium',
      evidence: { rule: 'shared_device_cashout_30d', linkedUsers: subjects } });
  }
  // This monitoring path never creates, revokes, or updates a login session.
  expect(client.query.mock.calls.some(([sql]) => /(?:INSERT INTO|UPDATE|DELETE FROM)\s+sessions\b/i.test(sql))).toBe(false);
});

test('an empty historical device aggregate opens no linkage cases', async () => {
  const client = { query: jest.fn(async () => ({ rows: [] })) };
  expect((await runBatchRules({ client })).deviceLinkage).toBe(0);
  expect(openComplianceCase).not.toHaveBeenCalled();
});
