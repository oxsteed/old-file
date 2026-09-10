'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/businessSupportSettingsController');
const supportEmployerService = require('../services/supportEmployerService');

function responseDouble() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  resetMocks();
  jest.spyOn(supportEmployerService, 'userCanManageBusiness').mockResolvedValue(true);
});

afterEach(() => jest.restoreAllMocks());

test('rejects malformed SLA values before database writes', async () => {
  const res = responseDouble();

  await controller.setSLATarget({
    user: { id: 'manager-1', role: 'manager' },
    params: { businessId: 42 },
    body: { priority: 'urgent', firstResponseTargetMinutes: 'not-a-number', resolutionTargetHours: 0 },
  }, res);

  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validation failed' }));
  expect(mockQuery).not.toHaveBeenCalled();
});

test('normalizes and bounds valid SLA values', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
  const res = responseDouble();

  await controller.setSLATarget({
    user: { id: 'manager-1', role: 'manager' },
    params: { businessId: 42 },
    body: { priority: ' URGENT ', firstResponseTargetMinutes: '15', resolutionTargetHours: '24' },
  }, res);

  expect(mockQuery.mock.calls[0][1]).toEqual([42, 'urgent', 15, 24]);
  expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 1 } });
});

test('rejects oversized routing-rule text and non-object payloads', async () => {
  const res = responseDouble();

  await controller.createRoutingRule({
    user: { id: 'manager-1', role: 'manager' },
    params: { businessId: 42 },
    body: {
      ruleName: 'x'.repeat(151),
      ruleType: 'manual',
      condition: ['not', 'an', 'object'],
      action: { assign: 'queue' },
    },
  }, res);

  expect(res.status).toHaveBeenCalledWith(400);
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rejects invalid statistics windows before database reads', async () => {
  const res = responseDouble();

  await controller.getSupportStatistics({
    user: { id: 'manager-1', role: 'manager' },
    params: { businessId: 42 },
    query: { days: '366' },
  }, res);

  expect(res.status).toHaveBeenCalledWith(400);
  expect(mockQuery).not.toHaveBeenCalled();
});
