'use strict';

// P3-11-F15: booking_request_audit_log, invoice_audit_log and
// calendar_audit_log had writers but zero readers. These tests pin the new
// admin readers: filter application, bounded pagination, and fail-closed
// error handling.

const { mockQuery, resetMocks } = require('./setup');

const auditController = require('../controllers/auditController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  resetMocks();
  mockQuery.mockImplementation(async (sql) => {
    if (/COUNT\(\*\)/.test(String(sql))) return { rows: [{ total: 2 }] };
    return { rows: [{ id: 1 }, { id: 2 }] };
  });
});

test('booking-request audit reader applies filters with bounded pagination', async () => {
  const res = mockRes();
  await auditController.listBookingRequestAuditLog(
    { query: { booking_request_id: 'br-1', action: 'accepted', limit: '5' } },
    res
  );
  expect(res.json).toHaveBeenCalledWith({ logs: [{ id: 1 }, { id: 2 }], total: 2, limit: 5, offset: 0 });
  const listCall = mockQuery.mock.calls.find(([sql]) => /FROM booking_request_audit_log/.test(String(sql)) && !/COUNT/.test(String(sql)));
  expect(listCall).toBeDefined();
  expect(listCall[0]).toContain('booking_request_id = $1');
  expect(listCall[0]).toContain('action = $2');
  expect(listCall[1]).toEqual(['br-1', 'accepted', 5, 0]);
});

test('pagination limit is capped at 500', async () => {
  const res = mockRes();
  await auditController.listInvoiceAuditLog({ query: { limit: '99999' } }, res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ limit: 500 }));
});

test('calendar audit reader filters by user, appointment and action', async () => {
  const res = mockRes();
  await auditController.listCalendarAuditLog(
    { query: { user_id: 'u-1', appointment_id: '7', action: 'created' } },
    res
  );
  const listCall = mockQuery.mock.calls.find(([sql]) => /FROM calendar_audit_log/.test(String(sql)) && !/COUNT/.test(String(sql)));
  expect(listCall[1].slice(0, 3)).toEqual(['u-1', '7', 'created']);
});

test('reader fails closed with a 500 when the database errors', async () => {
  mockQuery.mockRejectedValueOnce(new Error('db down'));
  const res = mockRes();
  await auditController.listInvoiceAuditLog({ query: {} }, res);
  expect(res.status).toHaveBeenCalledWith(500);
});
