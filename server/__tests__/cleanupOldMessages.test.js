'use strict';

// Review P3-6-F15: the legacy support_messages retention job must queue the
// storage objects referenced by deleted rows instead of orphaning them.

const { mockQuery, resetMocks } = require('./setup');
const cleanupJob = require('../jobs/cleanupOldMessages');

beforeEach(() => resetMocks());

describe('cleanupOldMessages storage cleanup (P3-6-F15)', () => {
  test('queues storage objects referenced in legacy metadata before hard delete', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 'm1', metadata: { fileUrl: '/api/storage/files/support-legacy/a.png?exp=1&sig=2' } },
          { id: 'm2', metadata: { note: 'plain text, not a reference' } },
          { id: 'm3', metadata: null },
        ],
      })
      .mockResolvedValue({ rows: [] }); // storage_deletion_queue inserts

    const result = await cleanupJob.handler();

    expect(result).toMatchObject({ success: true, deleted: 3, attachmentsQueued: 1 });
    const enqueueCall = mockQuery.mock.calls.find(
      (call) => /INSERT INTO storage_deletion_queue/.test(call[0])
    );
    expect(enqueueCall).toBeDefined();
    expect(enqueueCall[1][0]).toBe('support-legacy/a.png');
    expect(enqueueCall[1][1]).toBe('support_legacy_retention');
  });

  test('ignores non-reference strings and odd metadata shapes', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 'm1', metadata: { note: 'just some text', count: 3, tags: ['a', 'b'] } },
          { id: 'm2', metadata: 'not-an-object' },
        ],
      })
      .mockResolvedValue({ rows: [] });

    const result = await cleanupJob.handler();

    expect(result).toMatchObject({ success: true, deleted: 2, attachmentsQueued: 0 });
    expect(
      mockQuery.mock.calls.some((call) => /INSERT INTO storage_deletion_queue/.test(call[0]))
    ).toBe(false);
  });

  test('still hard-deletes rows when there is nothing to queue', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await cleanupJob.handler();

    expect(result).toMatchObject({ success: true, deleted: 0, attachmentsQueued: 0 });
    expect(mockQuery.mock.calls[0][0]).toMatch(/DELETE FROM support_messages/);
  });
});
