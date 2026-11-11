'use strict';

const payroll = require('../services/restaurantPayrollService');

test('carry-forward source read failures do not silently omit late payroll inputs', async () => {
  const databaseError = new Error('database connection lost');
  const runner = { query: jest.fn().mockRejectedValue(databaseError) };

  await expect(payroll.buildCarryForwardItems(runner, {
    restaurant: { id: 7, business_id: 11, currency_code: 'USD' },
    targetPeriodFrom: '2026-11-23',
    targetPeriodTo: '2026-11-29',
    currency: 'USD',
    wagesByUser: new Map(),
  })).rejects.toThrow('database connection lost');
});

