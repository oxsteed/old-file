'use strict';

// Credit redesign (D-795/D-796): bank-like account identity — a 10-digit
// account number per currency account and an 8-digit member code per
// customer, both minted lazily on first read. Neither is ever 9 digits,
// and neither is ever called a routing number.
const { mockQuery, resetMocks } = require('./setup');
const {
  luhnCheckDigit,
  isValidLuhn,
  generateAccountNumber,
  generateMemberCode,
  getOrCreateAccountNumber,
  getOrCreateMemberCode,
} = require('../services/oxsteedCreditService');

beforeEach(resetMocks);

test('luhn check digit matches the classic vector', () => {
  expect(luhnCheckDigit('7992739871')).toBe('3');
  expect(isValidLuhn('79927398713')).toBe(true);
  expect(isValidLuhn('79927398714')).toBe(false);
  expect(isValidLuhn('7992739871')).toBe(false);
  expect(isValidLuhn('')).toBe(false);
});

test('generated account numbers are 10 digits, OxSteed-prefixed, Luhn-valid', () => {
  for (let index = 0; index < 25; index += 1) {
    const number = generateAccountNumber();
    expect(number).toMatch(/^8\d{9}$/);
    expect(number).toHaveLength(10);
    expect(isValidLuhn(number)).toBe(true);
  }
});

test('generated member codes are 8 digits, never 9, first digit non-zero', () => {
  for (let index = 0; index < 25; index += 1) {
    const code = generateMemberCode();
    expect(code).toMatch(/^[1-9]\d{7}$/);
    expect(code).toHaveLength(8);
  }
});

test('account number is minted once and re-read on later calls', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ account_number: null }] })
    .mockResolvedValueOnce({ rows: [{ account_number: '8123456789' }] })
    .mockResolvedValueOnce({ rows: [{ account_number: '8123456789' }] });

  expect(await getOrCreateAccountNumber(42)).toBe('8123456789');
  expect(await getOrCreateAccountNumber(42)).toBe('8123456789');
  // The mint is a single UPDATE with a Luhn-valid candidate.
  const updateCall = mockQuery.mock.calls[1];
  expect(updateCall[0]).toContain('UPDATE oxsteed_credit_accounts SET account_number');
  expect(isValidLuhn(updateCall[1][1])).toBe(true);
  expect(mockQuery).toHaveBeenCalledTimes(3);
});

test('a concurrent account-number mint converges on the winner', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ account_number: null }] })
    .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }))
    .mockResolvedValueOnce({ rows: [{ account_number: '8123456789' }] });

  expect(await getOrCreateAccountNumber(42)).toBe('8123456789');
});

test('member code is minted once and re-read on later calls', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ member_code: '48219037' }] })
    .mockResolvedValueOnce({ rows: [{ member_code: '48219037' }] });

  expect(await getOrCreateMemberCode('11111111-1111-4111-8111-111111111111')).toBe('48219037');
  expect(await getOrCreateMemberCode('11111111-1111-4111-8111-111111111111')).toBe('48219037');
  const insertCall = mockQuery.mock.calls[1];
  expect(insertCall[0]).toContain('INSERT INTO oxsteed_credit_member_codes');
  expect(insertCall[1][1]).toMatch(/^[1-9]\d{7}$/);
  expect(mockQuery).toHaveBeenCalledTimes(3);
});

test('a concurrent member-code mint converges on the winner', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }))
    .mockResolvedValueOnce({ rows: [{ member_code: '48219037' }] });

  expect(await getOrCreateMemberCode('11111111-1111-4111-8111-111111111111')).toBe('48219037');
});
