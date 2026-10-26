'use strict';
const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/incidentStore', () => ({ recordIncident: jest.fn().mockResolvedValue({ persisted: true }) }));
const incident = require('../services/incidentStore');
const erasure = require('../jobs/growthErasure');
const schedule = require('../growth/workerSchedule');
test('disabled collection still schedules privacy erasure and missing stores raise a durable incident', async () => {
  resetMocks();
  const previous = process.env.GROWTH_CLICKHOUSE_URL;
  delete process.env.GROWTH_CLICKHOUSE_URL;
  try {
    expect(schedule.entries({}).some(([name]) => name === 'growthErasure')).toBe(true);
    mockQuery.mockResolvedValue({ rows: [{ pending: 3 }] });
    expect(await erasure.run()).toMatchObject({ pending: 3, reason: 'clickhouse_unconfigured' });
    expect(incident.recordIncident).toHaveBeenCalledWith(expect.objectContaining({ type: 'growth_erasure_unavailable', details: { pending: 3 } }));
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes("status='complete'"))).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.GROWTH_CLICKHOUSE_URL; else process.env.GROWTH_CLICKHOUSE_URL = previous;
  }
});
