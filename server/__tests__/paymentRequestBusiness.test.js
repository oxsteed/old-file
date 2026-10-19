'use strict';
// Decision 9: client-sent business id on main-app payment requests must match
// the server-derived business.
const { verifyPaymentRequestBusiness, derivePaymentRequestBusinessIds } = require('../services/paymentRequestBusiness');

const PAYEE = '00000000-0000-4000-8000-000000000101';
const BOOKING = '00000000-0000-4000-8000-0000000000b1';

function conn(map) {
  return { query: jest.fn(async (sql) => {
    if (sql.includes('FROM booking_requests')) return { rows: map.booking ? [{ business_id: map.booking }] : [] };
    if (sql.includes('FROM business_services')) return { rows: map.service ? [{ business_id: map.service }] : [] };
    return { rows: (map.payee || []).map(id => ({ id })) };
  }) };
}

test('no business id sent: accepted, nothing derived', async () => {
  const c = conn({});
  expect(await verifyPaymentRequestBusiness(undefined, { sourceType: 'other', payeeId: PAYEE }, c)).toEqual({ ok: true, businessId: null });
  expect(c.query).not.toHaveBeenCalled();
});

test('source record decides the business when it names one', async () => {
  const c = conn({ booking: 7, payee: [9] });
  expect(await verifyPaymentRequestBusiness('7', { sourceType: 'service_booking', sourceId: BOOKING, payeeId: PAYEE }, c)).toEqual({ ok: true, businessId: 7 });
  // The payee's own business is not accepted when the booking names another.
  expect(await verifyPaymentRequestBusiness(9, { sourceType: 'service_booking', sourceId: BOOKING, payeeId: PAYEE }, c)).toEqual({ ok: false, code: 'business_mismatch' });
  expect(await derivePaymentRequestBusinessIds({ sourceType: 'business_service', sourceId: '12', payeeId: PAYEE }, conn({ service: 3 }))).toEqual(['3']);
});

test('otherwise the payee must own or belong to the business', async () => {
  const c = conn({ payee: [4, 5] });
  expect(await verifyPaymentRequestBusiness(5, { sourceType: 'other', payeeId: PAYEE }, c)).toEqual({ ok: true, businessId: 5 });
  expect(await verifyPaymentRequestBusiness(6, { sourceType: 'other', payeeId: PAYEE }, c)).toEqual({ ok: false, code: 'business_mismatch' });
  // Unverifiable (no payee) and malformed ids fail closed.
  expect(await verifyPaymentRequestBusiness(5, { sourceType: 'other', payeeId: null }, c)).toEqual({ ok: false, code: 'business_mismatch' });
  expect(await verifyPaymentRequestBusiness('5 OR 1=1', { sourceType: 'other', payeeId: PAYEE }, c)).toEqual({ ok: false, code: 'business_invalid' });
});

test('the controller rejects a mismatch before recording anything', async () => {
  jest.resetModules();
  jest.doMock('../services/paymentRequestBusiness', () => ({ verifyPaymentRequestBusiness: jest.fn(async () => ({ ok: false, code: 'business_mismatch' })) }));
  const contracts = require('../models/mainAppContractsModel');
  const create = jest.spyOn(contracts, 'createPaymentRequest').mockResolvedValue({});
  const ctrl = require('../controllers/mainAppController');
  const res = { status: jest.fn(function status() { return this; }), json: jest.fn() };
  await ctrl.createPaymentRequest({ user: { id: PAYEE }, body: { amountCents: 500, businessId: 9 }, get: () => null }, res, (e) => { throw e; });
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json.mock.calls[0][0].error.code).toBe('business_mismatch');
  expect(create).not.toHaveBeenCalled();
});
