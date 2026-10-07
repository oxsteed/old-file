'use strict';

const { mockQuery, resetMocks } = require('./setup');
const adminConsulting = require('../controllers/adminConsultingController');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => resetMocks());

describe('consulting invoice consistency', () => {
  test('listInvoices coalesces customer_email from invoice row or user join', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 1,
        invoice_number: 'CONS-1',
        client_email: 'client@example.com',
        client_name: 'Client Co',
      }],
    });
    const res = mockRes();
    await adminConsulting.listInvoices({}, res);
    expect(mockQuery.mock.calls[0][0]).toMatch(/COALESCE\(ci\.customer_email, u\.email\)/);
    expect(res.json).toHaveBeenCalledWith([{
      id: 1,
      invoice_number: 'CONS-1',
      client_email: 'client@example.com',
      client_name: 'Client Co',
    }]);
  });
});
