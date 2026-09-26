'use strict';

const metricsService = require('../services/metricsService');

describe('metrics alert details', () => {
  beforeEach(() => metricsService.reset());
  afterAll(() => metricsService.reset());

  test('includes status and endpoint breakdowns for high HTTP error rates', () => {
    metricsService.incrementCounter('http.requests', 2000, { method: 'GET', path: '/api/menu' });
    metricsService.incrementCounter('http.errors', 180, { status: 404 });
    metricsService.incrementCounter('http.errors', 20, { status: 500 });
    metricsService.incrementCounter('http.responses', 180, {
      method: 'GET', path: '/api/v1/node-load-method/customMCP', status: 404,
    });
    metricsService.incrementCounter('http.responses', 20, {
      method: 'GET', path: '/api/orders/42', status: 500,
    });

    const [alert] = metricsService.checkAlerts();

    expect(alert).toMatchObject({ type: 'HIGH_ERROR_RATE' });
    expect(alert.details).toMatchObject({
      measurement: 'since_process_start',
      totalRequests: 2000,
      totalErrors: 200,
      thresholdPercent: 5,
    });
    expect(alert.details.errorsByStatus).toEqual(expect.arrayContaining([
      { tags: { status: 404 }, count: 180 },
      { tags: { status: 500 }, count: 20 },
    ]));
    expect(alert.details.topErrorEndpoints).toEqual(expect.arrayContaining([
      { endpoint: 'GET /api/v1/node-load-method/customMCP 404', count: 180 },
      { endpoint: 'GET /api/orders/:id 500', count: 20 },
    ]));
  });
});
