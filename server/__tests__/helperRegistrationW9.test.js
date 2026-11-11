'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/helperRegistrationController');

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => resetMocks());

test('saves the W-9 record and completion flags together', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });
  const res = response();

  await controller.saveW9({
    user: { id: 'user-1' },
    body: {
      legalName: 'Ava Agent',
      businessName: 'Ava Services',
      taxClassification: 'individual',
      tin: '123456789',
      address: '1 Main St',
      signatureData: 'signed',
      certify: true,
    },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test' },
  }, res);

  expect(res.json).toHaveBeenCalledWith({ message: 'W9 saved successfully' });
  expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO w9_records/);
  expect(mockQuery.mock.calls[1][0]).toMatch(/UPDATE users/);
});
