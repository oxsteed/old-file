'use strict';

// Background-jobs audit #46 (Group 2): the screen sync job raises an
// incident when the display transport fails on consecutive sweeps,
// and resolves it when a sweep publishes cleanly again. All mocked:
// no real database, no real socket service.

jest.mock('../services/restaurantScreenSync', () => ({
  publishBatch: jest.fn(),
}));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn(async () => ({ persisted: true })),
  resolveOpenIncidentsByDedupeKeys: jest.fn(async () => []),
}));
jest.mock('../utils/notifyWakeup', () => ({
  subscribe: jest.fn(() => jest.fn()),
}));

const { publishBatch } = require('../services/restaurantScreenSync');
const incidentStore = require('../services/incidentStore');
const {
  startRestaurantScreenSync,
  TRANSPORT_FAILURE_INCIDENT_AFTER,
  TRANSPORT_INCIDENT_DEDUPE_KEY,
} = require('../jobs/restaurantScreenSync');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  jest.clearAllMocks();
});

async function runSweeps(handle, count) {
  for (let i = 0; i < count; i += 1) {
    handle.run();
    await sleep(30);
  }
}

describe('Background-jobs audit #46: screen transport outage surfaces as an incident', () => {
  test('a single failed sweep records no incident', async () => {
    publishBatch.mockResolvedValue({ published: 0, failed: [{ restaurantId: 8, error: 'Restaurant display transport is unavailable' }] });
    const handle = startRestaurantScreenSync();
    try {
      await runSweeps(handle, 1);
      expect(incidentStore.recordIncident).not.toHaveBeenCalled();
      expect(incidentStore.resolveOpenIncidentsByDedupeKeys).not.toHaveBeenCalled();
    } finally {
      await handle.stop();
    }
  });

  test('the incident fires on the third consecutive failed sweep', async () => {
    expect(TRANSPORT_FAILURE_INCIDENT_AFTER).toBe(3);
    publishBatch.mockResolvedValue({ published: 0, failed: [{ restaurantId: 8, error: 'Restaurant display transport is unavailable' }] });
    const handle = startRestaurantScreenSync();
    try {
      await runSweeps(handle, 2);
      expect(incidentStore.recordIncident).not.toHaveBeenCalled();
      await runSweeps(handle, 1);
      expect(incidentStore.recordIncident).toHaveBeenCalledTimes(1);
      expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
        type: 'restaurant_screen_transport_unavailable',
        severity: 'warning',
        dedupeKey: TRANSPORT_INCIDENT_DEDUPE_KEY,
      }));
      const details = incidentStore.recordIncident.mock.calls[0][0].details;
      expect(details.consecutiveSweeps).toBe(3);
      expect(details.failedRestaurants).toEqual([8]);
    } finally {
      await handle.stop();
    }
  });

  test('a clean sweep after the outage resolves the incident, and the next clean sweep resolves nothing', async () => {
    publishBatch.mockResolvedValue({ published: 0, failed: [{ restaurantId: 8, error: 'Restaurant display transport is unavailable' }] });
    const handle = startRestaurantScreenSync();
    try {
      await runSweeps(handle, 3);
      expect(incidentStore.recordIncident).toHaveBeenCalledTimes(1);
      publishBatch.mockResolvedValue({ published: 2, failed: [] });
      await runSweeps(handle, 1);
      expect(incidentStore.resolveOpenIncidentsByDedupeKeys).toHaveBeenCalledTimes(1);
      expect(incidentStore.resolveOpenIncidentsByDedupeKeys).toHaveBeenCalledWith(
        [TRANSPORT_INCIDENT_DEDUPE_KEY],
        expect.stringContaining('recovered'),
      );
      await runSweeps(handle, 1);
      expect(incidentStore.resolveOpenIncidentsByDedupeKeys).toHaveBeenCalledTimes(1);
    } finally {
      await handle.stop();
    }
  });
});
