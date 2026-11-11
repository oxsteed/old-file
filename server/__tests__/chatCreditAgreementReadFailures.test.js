'use strict';

const controller = require('../controllers/chatOxsteedCreditPaymentController');

test('fails closed when the partner agreement lookup is unavailable', async () => {
  const client = {
    query: jest.fn().mockRejectedValue(new Error('database unavailable')),
  };

  await expect(controller._loadPartnerAllowedOrderTypes('partner-1', client))
    .rejects.toMatchObject({ status: 503, code: 'credit_agreement_unavailable' });
});

test('keeps an empty agreement allow-list as the explicit unrestricted value', async () => {
  const client = {
    query: jest.fn().mockResolvedValue({ rows: [{ allowed_order_types: [] }] }),
  };

  await expect(controller._loadPartnerAllowedOrderTypes('partner-1', client)).resolves.toEqual([]);
});
