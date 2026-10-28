'use strict';

// Exercise the real entry point and post-listen startup. Synthetic transport /
// dependency boundaries prevent any external connections or durable writes.
jest.mock('../instrument', () => ({}));
jest.mock('../bootstrap/backgroundWorkers', () => { throw new Error('Web entry imported the job-consumer registry'); });
jest.mock('../bootstrap/auxiliaryWorkers', () => { throw new Error('Web entry imported auxiliary consumers'); });
jest.mock('../bootstrap/realtime', () => ({ createRealtimeServer: () => ({ ready: async () => true, close: async () => undefined }) }));
jest.mock('../services/readinessService', () => ({ checkReadiness: async () => ({ checks: { database: { ok: true }, workers: { ok: false } } }) }));
jest.mock('../services/incidentAlertService', () => ({}));
// The shared route-test setup stubs this controller down to its trial helper.
// Entry startup needs its real handler exports, with the same mocked DB.
jest.unmock('../controllers/templateController');

test('the web entry serves HTTP without starting export, auxiliary or cron consumers', async () => {
  const previous = Object.fromEntries(['PORT', 'REDIS_URL', 'OXSTEED_RUNTIME_ROLE', 'BACKGROUND_READINESS_URL'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { PORT: '0', REDIS_URL: 'redis://synthetic', OXSTEED_RUNTIME_ROLE: 'web', BACKGROUND_READINESS_URL: 'http://app:5000/ready' });
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ status: 'ready', checks: { workers: { ok: true } } }) });
  const schedule = jest.spyOn(require('node-cron'), 'schedule').mockImplementation(() => { throw new Error('Web entry started a cron consumer'); });
  const exports = require('../services/statementExportJobService');
  const exportStart = jest.spyOn(exports, 'start').mockImplementation(() => { throw new Error('Web entry started the export consumer'); });
  let entry;
  try {
    entry = require('../index');
    entry.runtime.drain = async () => undefined;
    await entry.startServer();
    expect(entry.httpServer.listening).toBe(true);
    expect(schedule).not.toHaveBeenCalled();
    expect(exportStart).not.toHaveBeenCalled();
    expect(entry.runtime.workers.handles).toHaveLength(1); // local read-only limit cache refresh
    expect(require('../services/runtimeState').snapshot()).toMatchObject({ acceptingTraffic: true, workersReady: true, workerMode: 'delegated' });
  } finally {
    await entry?.runtime.shutdown('test');
    fetchMock.mockRestore(); schedule.mockRestore(); exportStart.mockRestore();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
