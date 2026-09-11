'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { cleanupExpiredSupportMessages, RETENTION_LOCK_ID } = require('../jobs/supportConversationRetentionCleanup');

beforeEach(() => resetMocks());

describe('support conversation retention cleanup', () => {
  test('redacts expired active conversation messages under a replica-safe lock', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1' }, { id: 'message-2' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await cleanupExpiredSupportMessages();

    expect(result).toMatchObject({ success: true, skipped: false, redacted: 2 });
    expect(mockQuery.mock.calls[0]).toEqual(['BEGIN']);
    expect(mockQuery.mock.calls[1][0]).toContain('pg_try_advisory_xact_lock');
    expect(mockQuery.mock.calls[1][1]).toEqual([RETENTION_LOCK_ID]);
    expect(mockQuery.mock.calls[2][0]).toContain("'[Message removed under retention policy]'");
    expect(mockQuery.mock.calls[2][0]).toContain("'retention_policy'");
    expect(mockQuery.mock.calls[3]).toEqual(['COMMIT']);
  });

  test('skips when another replica owns the retention lock', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ acquired: false }] });

    const result = await cleanupExpiredSupportMessages();

    expect(result).toMatchObject({ success: true, skipped: true, redacted: 0 });
    expect(mockQuery.mock.calls).toEqual([
      ['BEGIN'],
      ['SELECT pg_try_advisory_xact_lock($1) AS acquired', [RETENTION_LOCK_ID]],
      ['ROLLBACK'],
    ]);
  });
});
