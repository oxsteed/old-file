'use strict';

const { decrypt } = require('./encryption');

function maskPaymentIdentifier(type, identifier) {
  if (!identifier || identifier.length < 4) return '****';
  const lastFour = identifier.slice(-4);
  switch (String(type || '').toLowerCase()) {
    case 'cash_app':
    case 'venmo':
      return `**** ${lastFour}`;
    case 'bank_transfer':
      if (identifier.length <= 8) return '****';
      return `${identifier.slice(0, 2)}${'*'.repeat(Math.max(0, identifier.length - 6))}${identifier.slice(-4)}`;
    default:
      return `**** ${lastFour}`;
  }
}

function decryptStoredPaymentIdentifier(invoiceRow) {
  if (!invoiceRow) return null;
  if (invoiceRow.payment_identifier_encrypted) {
    try {
      return decrypt(invoiceRow.payment_identifier_encrypted);
    } catch {
      return null;
    }
  }
  const plain = invoiceRow.payment_identifier;
  if (!plain || String(plain).startsWith('****')) return null;
  return plain;
}

function rentalInvoicePaymentView(invoiceRow) {
  const type = invoiceRow.payment_type;
  const full = decryptStoredPaymentIdentifier(invoiceRow);
  const masked = full
    ? maskPaymentIdentifier(type, full)
    : maskPaymentIdentifier(type, invoiceRow.payment_identifier || '');
  return {
    payment_type: type,
    payment_identifier_masked: masked,
    payment_identifier: masked,
  };
}

module.exports = {
  maskPaymentIdentifier,
  decryptStoredPaymentIdentifier,
  rentalInvoicePaymentView,
};
