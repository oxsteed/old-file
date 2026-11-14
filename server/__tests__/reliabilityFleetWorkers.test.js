'use strict';

/**
 * Domain 7 #15 — the fleet worker heartbeat has no admin reader.
 *
 * getFleetWorkerHeartbeats() is exported from scheduledWorkerSchedule but
 * no route, controller, or client file imports it. The fix wires it to
 * GET /admin/super/reliability/fleet-workers (same manage_operations
 * grant as the rest of the Reliability workspace) and shows it read-only
 * on the Reliability page.
 *
 * The state is per-process in-memory and resets on restart, so the
 * response says so explicitly instead of presenting it as durable truth.
 */

jest.mock('../workers/scheduledWorkerSchedule', () => ({
  getFleetWorkerHeartbeats: jest.fn(),
}));

const { mockQuery, resetMocks } = require('./setup');
const schedule = require('../workers/scheduledWorkerSchedule');
const { getFleetWorkers } = require('../controllers/reliabilityController');

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.body = payload; return res; });
  return res;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('GET fleet-workers returns the in-memory heartbeat snapshot with the per-process caveat', async () => {
  schedule.getFleetWorkerHeartbeats.mockReturnValue([
    {
      worker: 'incidentNotificationDispatch',
      intervalMs: 60000,
      consecutiveSkips: 0,
      consecutiveFailures: 0,
      lastRunAt: '2026-11-13T19:00:00.000Z',
      lastSuccessAt: '2026-11-13T19:00:00.000Z',
      lastOutcome: 'success',
      streakIncidentOpen: false,
      fenceIncidentOpen: false,
      lockErrorIncidentOpen: false,
    },
  ]);
  const res = mockRes();

  await getFleetWorkers({}, res);

  expect(schedule.getFleetWorkerHeartbeats).toHaveBeenCalledTimes(1);
  expect(res.statusCode).toBe(200);
  expect(res.body.workers).toHaveLength(1);
  expect(res.body.workers[0].worker).toBe('incidentNotificationDispatch');
  expect(res.body.perProcess).toBe(true);
  expect(typeof res.body.note).toBe('string');
  expect(res.body.note).toMatch(/per-process/i);
  expect(res.body.note).toMatch(/restart/i);
});

test('GET fleet-workers returns an empty list when no worker has ticked in this process', async () => {
  schedule.getFleetWorkerHeartbeats.mockReturnValue([]);
  const res = mockRes();

  await getFleetWorkers({}, res);

  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ workers: [], perProcess: true });
});
