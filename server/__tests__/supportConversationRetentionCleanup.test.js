'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { cleanupExpiredSupportMessages, RETENTION_LOCK_ID } = require('../jobs/supportConversationRetentionCleanup');

beforeEach(() => resetMocks());

describe('support conversation retention cleanup', () => {
  test('redacts expired active conversation messages under a replica-safe lock', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1', attachment_url: '/api/storage/files/support-conversations/a.png?exp=1&sig=2' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1' }, { id: 'message-2' }] })
      .mockResolvedValue({ rows: [] });

    const result = await cleanupExpiredSupportMessages();

    expect(result).toMatchObject({ success: true, skipped: false, redacted: 2, attachmentsQueued: 1 });
    expect(mockQuery.mock.calls[0]).toEqual(['BEGIN']);
    expect(mockQuery.mock.calls[1][0]).toContain('pg_try_advisory_xact_lock');
    expect(mockQuery.mock.calls[1][1]).toEqual([RETENTION_LOCK_ID]);
    expect(mockQuery.mock.calls[2][0]).toContain('attachment_url');
    expect(mockQuery.mock.calls[3][0]).toContain("'[Message removed under retention policy]'");
    expect(mockQuery.mock.calls[3][0]).toContain("'retention_policy'");
    expect(mockQuery.mock.calls[4]).toEqual(['COMMIT']);
    // Review P3-6-F15: the expired attachment's storage object is queued for
    // deletion (signed download URL resolved to its storage key).
    const enqueueCall = mockQuery.mock.calls.find(
      (call) => /INSERT INTO storage_deletion_queue/.test(call[0])
    );
    expect(enqueueCall).toBeDefined();
    expect(enqueueCall[1][0]).toBe('support-conversations/a.png');
    expect(enqueueCall[1][1]).toBe('retention_policy');
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
