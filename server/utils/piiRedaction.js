'use strict';

/**
 * Security review 2026-11-10 F-05: personal data must not end up in logs or
 * error telemetry, which sit outside the database's privacy and erasure
 * controls. Shared by utils/logger.js and the Sentry scrubber.
 *
 * - Email addresses keep only the domain (`***@example.com`) so delivery
 *   problems per provider stay diagnosable.
 * - Phone numbers in E.164 (+15551234567) or common North American formats
 *   keep only the last two digits.
 * - Long digit runs (15 to 19 digits: card and many account numbers) are
 *   replaced. Shorter runs are left alone because IDs, amounts and epoch
 *   milliseconds look the same.
 * - Keys that always hold financial identifiers are redacted outright.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const E164 = /\+\d[\d\s-]{6,16}\d/g;
const NANP = /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const LONG_DIGITS = /\b\d{15,19}\b/g;

const FINANCIAL_KEYS = new Set([
  'account_number', 'accountnumber', 'bank_account', 'bankaccount', 'bank_account_number',
  'routing_number', 'routingnumber', 'iban', 'swift', 'bic', 'card_number', 'cardnumber',
  'pan', 'cvc', 'cvv', 'ssn', 'tin', 'ein', 'tax_id', 'taxid', 'national_id', 'nationalid',
  'last4_ssn', 'dob', 'date_of_birth',
]);

function maskPhone(match) {
  const digits = match.replace(/\D/g, '');
  return `[phone…${digits.slice(-2)}]`;
}

function redactPiiInString(value) {
  if (typeof value !== 'string' || !value) return value;
  return value
    .replace(EMAIL, (_m, domain) => `***@${domain}`)
    .replace(E164, maskPhone)
    .replace(NANP, maskPhone)
    .replace(LONG_DIGITS, '[number]');
}

function isFinancialKey(key) {
  return FINANCIAL_KEYS.has(String(key || '').toLowerCase());
}

module.exports = { redactPiiInString, isFinancialKey, FINANCIAL_KEYS };
