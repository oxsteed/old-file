'use strict';

// Money-flows audit D1: background-observation failures were silent on
// the web side. They must warn, without ever logging the private
// readiness URL or a response body.
jest.mock('../utils/logger', () => ({
  ...jest.requireActual('../utils/logger'),
  warn: jest.fn(),
}));

const logger = require('../utils/logger');
const runtimeState = require('../services/runtimeState');
const { DelegatedWorkers } = require('../bootstrap/delegatedWorkers');

beforeEach(() => {
  runtimeState.reset();
  logger.warn.mockClear();
});

test('observation failure and ready-to-not-ready transition warn without the URL', async () => {
  let healthy = true;
  const fetchImpl = jest.fn(async () => {
    if (!healthy) throw new Error('Synthetic private dependency unavailable');
    return { ok: true, json: async () => ({ status: 'ready', checks: { workers: { ok: true } } }) };
  });
  const workers = new DelegatedWorkers({ url: 'http://app:5000/ready', fetchImpl });
  try {
    await workers.start();
    expect(runtimeState.snapshot().workersReady).toBe(true);
    logger.warn.mockClear();
    healthy = false;
    await workers.observe();
    expect(runtimeState.snapshot().workersReady).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
    for (const call of logger.warn.mock.calls) {
      expect(call.join(' ')).not.toMatch('app:5000');
    }
  } finally {
    await workers.stop();
  }
});
