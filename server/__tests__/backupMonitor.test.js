'use strict';

const { mockQuery, resetMocks } = require('./setup');
const backupMonitor = require('../services/backupMonitor');

beforeEach(() => {
  resetMocks();
  backupMonitor.lastBackupTime = null;
  backupMonitor.lastBackupSuccess = null;
  backupMonitor.backupHistory = [];
});

test('persists backup events and reports history after a process restart', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ backup_id: 'backup-1', success: true, details: {
      filename: 'db.dump', sizeBytes: 1234, durationMs: 250,
    }, created_at: new Date().toISOString() }] });

  await backupMonitor.recordBackup('backup-1', 'db.dump', 1234, 250, true);
  const status = await backupMonitor.getStatus();

  expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO backup_log');
  expect(status.lastBackupSuccess).toBe(true);
  expect(status.recentBackups[0]).toMatchObject({ backupId: 'backup-1', filename: 'db.dump' });
});

test('falls back to process history when the backup log is unavailable', async () => {
  const timestamp = new Date().toISOString();
  backupMonitor.lastBackupTime = new Date(timestamp);
  backupMonitor.lastBackupSuccess = true;
  backupMonitor.backupHistory = [{
    timestamp,
    backupId: 'memory-backup',
    filename: 'db.dump',
    sizeBytes: 42,
    durationMs: 10,
    success: true,
  }];
  mockQuery.mockRejectedValueOnce(new Error('database unavailable'));

  await expect(backupMonitor.getStatus()).resolves.toMatchObject({
    lastBackupSuccess: true,
    recentBackups: [{ backupId: 'memory-backup' }],
  });
});
