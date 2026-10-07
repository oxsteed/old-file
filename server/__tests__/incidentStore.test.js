'use strict';

const { mockQuery, resetMocks } = require('./setup');
const incidentStore = require('../services/incidentStore');

beforeEach(() => resetMocks());

describe('incidentStore', () => {
  test('creates stable keys and respects an explicit dedupe key', () => {
    expect(incidentStore.incidentDedupeKey('HIGH_ERROR_RATE', 'critical')).toHaveLength(64);
    expect(incidentStore.incidentDedupeKey('HIGH_ERROR_RATE', 'critical'))
      .toBe(incidentStore.incidentDedupeKey('HIGH_ERROR_RATE', 'critical'));
    expect(incidentStore.incidentDedupeKey('x', 'warning', '  alert-key  ')).toBe('alert-key');
  });

  test('upserts an open incident instead of creating duplicate alert rows', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, occurrence_count: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, notification_count: 1 }] });

    const result = await incidentStore.recordIncident({
      type: 'HIGH_ERROR_RATE',
      severity: 'critical',
      message: 'Error rate is high',
      details: { total: 10 },
      dedupeKey: 'HIGH_ERROR_RATE',
    });

    expect(result).toEqual({
      persisted: true,
      incident: { id: 7, occurrence_count: 2 },
      notificationClaimed: true,
    });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (dedupe_key)'),
      expect.arrayContaining(['HIGH_ERROR_RATE', 'critical', 'Error rate is high', JSON.stringify({ total: 10 }), 'HIGH_ERROR_RATE'])
    );
  });

  test('suppresses a notification when another replica already claimed the window', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, occurrence_count: 3 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await incidentStore.recordIncident({
      type: 'HIGH_ERROR_RATE',
      severity: 'critical',
      message: 'Error rate is still high',
      dedupeKey: 'HIGH_ERROR_RATE',
    });

    expect(result.notificationClaimed).toBe(false);
    expect(mockQuery.mock.calls[1][0]).toContain('last_notified_at');
    expect(mockQuery.mock.calls[1][1]).toEqual([7, incidentStore.DEFAULT_NOTIFICATION_COOLDOWN_MINUTES]);
  });

  test('caps durable incident list queries', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await incidentStore.listIncidents({ hours: 9999, limit: 9999 });

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM incident_log'), [720, 500]);
  });

  test('auto-resolves only open incidents for the supplied health keys', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, dedupe_key: 'credit-worker:failed', resolved_at: '2026-09-13T12:00:00.000Z' }] });

    await expect(incidentStore.resolveOpenIncidentsByDedupeKeys([
      'credit-worker:failed',
      'credit-worker:failed',
      '',
    ], 'Worker recovered')).resolves.toMatchObject([{ id: 7 }]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('resolved_at IS NULL'), [
      ['credit-worker:failed'],
      'Worker recovered',
    ]);
  });

  test('acknowledges and resolves only open incidents', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, acknowledged_by: 'admin-id' }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, resolved_at: '2026-09-11T00:00:00.000Z' }] });

    await expect(incidentStore.acknowledgeIncident(7, 'admin-id')).resolves.toMatchObject({ id: 7 });
    await expect(incidentStore.resolveIncident(7, 'admin-id', 'Fixed')).resolves.toMatchObject({ id: 7 });
    expect(mockQuery.mock.calls[0][0]).toContain('resolved_at IS NULL');
    expect(mockQuery.mock.calls[1][1]).toEqual([7, 'Fixed', 'admin-id']);
  });
});

describe('incident investigation trail', () => {
  test('addIncidentNote persists and listIncidentNotes returns them', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, incident_id: 5, author_user_id: 9, note: 'Looking into it', created_at: '2026-10-07' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, incident_id: 5, author_user_id: 9, note: 'Looking into it', created_at: '2026-10-07', first_name: 'A', last_name: 'B' }] });

    const added = await incidentStore.addIncidentNote(5, 9, 'Looking into it');
    expect(added.persisted).toBe(true);
    expect(added.note.note).toBe('Looking into it');

    const notes = await incidentStore.listIncidentNotes(5);
    expect(notes).toHaveLength(1);
    expect(notes[0].note).toBe('Looking into it');
  });

  test('addIncidentNote rejects empty note', async () => {
    const result = await incidentStore.addIncidentNote(5, 9, '   ');
    expect(result.persisted).toBe(false);
  });

  test('watermark round-trip', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ consumer: 'alerts', watermark: '2026-10-07', updated_at: '2026-10-07' }] })
      .mockResolvedValueOnce({ rows: [{ consumer: 'alerts', watermark: '2026-10-07', updated_at: '2026-10-07' }] });

    expect(await incidentStore.getWatermark('alerts')).toBeNull();
    const set = await incidentStore.setWatermark('alerts', '2026-10-07');
    expect(set.consumer).toBe('alerts');
    expect(await incidentStore.getWatermark('alerts')).toBeTruthy();
  });
});
