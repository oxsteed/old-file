'use strict';

// Credit redesign checkpoint 3 (D-798/D-799/D-800/D-804): closed-loop
// 16-digit OxSteed cards — number generation, security-code hashing,
// spend-limit enforcement, and the one-time-credential formatting rules.
// Pure helpers and mocked-pool behavior; the HTTP flow lives in
// creditRedesign.db.test.js.
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { mockQuery, resetMocks } = require('./setup');
const cardService = require('../services/oxsteedCreditCardService');
const { isValidLuhn } = require('../services/oxsteedCreditService');

beforeEach(resetMocks);

test('generated card numbers are 16 digits, OxSteed-prefixed, Luhn-valid, unique', () => {
  const seen = new Set();
  for (let index = 0; index < 50; index += 1) {
    const number = cardService.generateCardNumber();
    expect(number).toMatch(/^9700\d{12}$/);
    expect(number).toHaveLength(16);
    expect(isValidLuhn(number)).toBe(true);
    expect(cardService.isClosedLoopCardNumber(number)).toBe(true);
    expect(seen.has(number)).toBe(false);
    seen.add(number);
  }
  expect(cardService.isClosedLoopCardNumber('9700123456789012')).toBe(false);
  expect(cardService.isClosedLoopCardNumber('4111111111111111')).toBe(false);
  expect(cardService.isClosedLoopCardNumber('970012345678901')).toBe(false);
});

test('generated security codes are 3 digits, never a leading zero', () => {
  for (let index = 0; index < 25; index += 1) {
    expect(cardService.generateSecurityCode()).toMatch(/^[1-9]\d{2}$/);
  }
});

test('security codes hash with scrypt and verify only the right code', async () => {
  const { hash, salt } = await cardService.hashSecurityCode('482');
  expect(hash).toMatch(/^\$scrypt\$/);
  expect(salt).toMatch(/^[a-f0-9]{32}$/);
  expect(await cardService.verifySecurityCode(hash, '482')).toBe(true);
  expect(await cardService.verifySecurityCode(hash, '483')).toBe(false);
});

test('minting a card credential returns the number and code once, hashed and encrypted', async () => {
  const { decrypt } = require('../utils/encryption');
  const minted = await cardService.mintCardCredential();
  expect(minted.number).toMatch(/^9700\d{12}$/);
  expect(isValidLuhn(minted.number)).toBe(true);
  expect(minted.securityCode).toMatch(/^[1-9]\d{2}$/);
  expect(minted.credentialHash).toBe(cardService.sha256Hex(minted.number));
  expect(minted.credentialLast4).toBe(minted.number.slice(-4));
  expect(decrypt(minted.credentialEncrypted)).toBe(minted.number);
  expect(await cardService.verifySecurityCode(minted.securityCodeHash, minted.securityCode)).toBe(true);
});

test('formatting a card never exposes hashes, encrypted numbers, or salts', () => {
  const formatted = cardService.formatCard({
    id: 7,
    customer_id: '11111111-1111-4111-8111-111111111111',
    account_id: 42,
    card_type: 'virtual',
    status: 'active',
    fulfillment_status: 'not_applicable',
    credential_hash: 'deadbeef',
    credential_last4: '9012',
    credential_encrypted: 'iv:tag:ciphertext',
    security_code_hash: '$scrypt$deadbeef',
    security_code_salt: 'aabbccdd',
    daily_limit_cents: 5000,
    merchant_type_limits: { pickup: 3000 },
    pin_hash: 'deadbeef',
  });
  expect(formatted.credentialLast4).toBe('9012');
  expect(formatted.hasRevealableNumber).toBe(true);
  expect(formatted.hasSecurityCode).toBe(true);
  expect(formatted.dailyLimitCents).toBe(5000);
  expect(formatted.merchantTypeLimits).toEqual({ pickup: 3000 });
  const exposed = JSON.stringify(formatted);
  expect(exposed).not.toContain('deadbeef');
  expect(exposed).not.toContain('ciphertext');
  expect(exposed).not.toContain('aabbccdd');
});

test('formatting a legacy card reports no revealable number', () => {
  const formatted = cardService.formatCard({
    id: 8,
    customer_id: '11111111-1111-4111-8111-111111111111',
    account_id: 42,
    card_type: 'virtual',
    status: 'active',
    fulfillment_status: 'not_applicable',
    credential_hash: 'deadbeef',
    credential_last4: 'AB12',
    credential_encrypted: null,
    security_code_hash: null,
    daily_limit_cents: null,
    merchant_type_limits: null,
  });
  expect(formatted.hasRevealableNumber).toBe(false);
  expect(formatted.hasSecurityCode).toBe(false);
  expect(formatted.dailyLimitCents).toBe(null);
  expect(formatted.merchantTypeLimits).toBe(null);
});

const cardWithLimits = (overrides = {}) => ({
  id: 7,
  daily_limit_cents: 5000,
  merchant_type_limits: { pickup: 3000 },
  ...overrides,
});

test('spend limits pass when nothing is set, without touching the DB', async () => {
  await cardService.assertCardSpendLimits(
    { query: mockQuery },
    { id: 7, daily_limit_cents: null, merchant_type_limits: null },
    { amountCents: 100000, orderType: 'pickup' },
  );
  expect(mockQuery).not.toHaveBeenCalled();
});

test('the daily limit refuses a spend that would cross it', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ total_cents: 4000, type_cents: 1000 }] });
  await expect(cardService.assertCardSpendLimits(
    { query: mockQuery },
    cardWithLimits(),
    { amountCents: 2000, orderType: 'pickup' },
  )).rejects.toMatchObject({ code: 'credit_card_daily_limit_exceeded', status: 409 });
  // The check is one aggregate query over today's posted card spends.
  expect(mockQuery.mock.calls[0][0]).toContain("metadata->>'cardId'");
  expect(mockQuery.mock.calls[0][1]).toEqual(['7', 'pickup']);
});

test('the daily limit allows a spend that stays inside it', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ total_cents: 4000, type_cents: 1000 }] });
  await cardService.assertCardSpendLimits(
    { query: mockQuery },
    cardWithLimits(),
    { amountCents: 1000, orderType: 'pickup' },
  );
});

test('a merchant-type limit refuses only its own order type', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ total_cents: 1000, type_cents: 2500 }] });
  await expect(cardService.assertCardSpendLimits(
    { query: mockQuery },
    cardWithLimits(),
    { amountCents: 1000, orderType: 'pickup' },
  )).rejects.toMatchObject({ code: 'credit_card_merchant_type_limit_exceeded', status: 409 });

  mockQuery.mockResolvedValueOnce({ rows: [{ total_cents: 1000, type_cents: 0 }] });
  await cardService.assertCardSpendLimits(
    { query: mockQuery },
    cardWithLimits(),
    { amountCents: 1000, orderType: 'delivery' },
  );
});

test('cash-outs count toward the daily limit but not a merchant-type limit', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ total_cents: 4500, type_cents: 0 }] });
  await expect(cardService.assertCardSpendLimits(
    { query: mockQuery },
    cardWithLimits(),
    { amountCents: 1000 },
  )).rejects.toMatchObject({ code: 'credit_card_daily_limit_exceeded', status: 409 });
});
