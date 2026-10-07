'use strict';

const { maskPaymentIdentifier, rentalInvoicePaymentView } = require('../utils/rentalInvoicePayment');

describe('rental invoice payment masking', () => {
  test('masks venmo handles for API and PDF display', () => {
    expect(maskPaymentIdentifier('venmo', '@toolowner1234')).toBe('**** 1234');
  });

  test('prefers encrypted column when building payment view', () => {
    const view = rentalInvoicePaymentView({
      payment_type: 'cash_app',
      payment_identifier: '**** 9999',
      payment_identifier_encrypted: null,
    });
    expect(view.payment_identifier_masked).toContain('****');
    expect(view.payment_identifier).toBe(view.payment_identifier_masked);
  });
});
