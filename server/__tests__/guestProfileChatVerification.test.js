'use strict';

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../utils/email', () => ({ sendOTPEmail: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const {
  hash,
  hashesMatch,
  isValidEmail,
  normalizeEmail,
  maskEmail,
  tokenMatchesProfile,
  canEnterLiveMode,
  startGuestVerification,
  verifyGuestCode,
} = require('../services/guestProfileChatVerification');

const pool = require('../db');
const { sendOTPEmail } = require('../utils/email');

describe('guest profile verification lifecycle', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([null, 42])('creates and verifies a guest session for business %s', async (businessId) => {
    let storedHash;
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql, params) => {
        if (sql.includes('INSERT INTO guest_profile_chat_inbound')) {
          // Reproduce the production check_deadline_during_waiting constraint.
          if (!sql.includes('helper_response_deadline')) {
            throw Object.assign(new Error('guest_profile_chat_inbound deadline constraint'), { code: '23514' });
          }
          expect(params[4]).toBe('15');
          return { rows: [{ id: 'session-1' }] };
        }
        if (sql.includes('INSERT INTO guest_profile_chat_verifications')) storedHash = params[2];
        if (sql.includes('SELECT id, helper_id')) return { rows: [{ id: 'session-1', helper_id: 'helper-1', business_id: businessId }] };
        if (sql.includes('SELECT id, code_hash')) return { rows: [{ id: 'otp-1', code_hash: storedHash }] };
        return { rows: [] };
      }),
    };
    pool.connect.mockResolvedValue(client);
    pool.query.mockImplementation(async (sql) => ({ rows: [sql.includes('FROM businesses')
      ? { user_id: 'helper-1' } : { allow_guest_contact: true }] }));
    const started = await startGuestVerification({
      helperId: 'helper-1', businessId, guestName: 'Guest', guestEmail: ' Guest@Example.com ',
    });
    const [email, code] = sendOTPEmail.mock.calls[0];
    expect(email).toBe('guest@example.com');
    expect(code).toMatch(/^\d{6}$/);
    const verified = await verifyGuestCode({ sessionId: started.sessionId, guestEmail: email, code });
    expect(verified).toMatchObject({ sessionId: 'session-1', helperId: 'helper-1', businessId });
    expect(verified.guestToken).toMatch(/^[a-f0-9]{64}$/);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("THEN NOW() + INTERVAL '5 minutes'"), expect.any(Array));
    expect(client.release).toHaveBeenCalledTimes(2);
  });
});

describe('guestProfileChatVerification helpers', () => {
  test('hashesMatch accepts equal sha256 digests', () => {
    expect(hashesMatch(hash('123456'), hash('123456'))).toBe(true);
    expect(hashesMatch(hash('123456'), hash('000000'))).toBe(false);
  });

  test('normalizeEmail + isValidEmail', () => {
    expect(normalizeEmail('  Ada@OxSteed.COM ')).toBe('ada@oxsteed.com');
    expect(isValidEmail('ada@oxsteed.com')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
  });

  test('maskEmail hides local part', () => {
    expect(maskEmail('ada@oxsteed.com')).toMatch(/^ad\*\*\*@oxsteed\.com$/);
  });

  test('tokenMatchesProfile binds helper and business', () => {
    const session = { helper_id: 'h1', business_id: 42 };
    expect(tokenMatchesProfile(session, { helperId: 'h1', businessId: 42 })).toBe(true);
    expect(tokenMatchesProfile(session, { helperId: 'h2', businessId: 42 })).toBe(false);
    expect(tokenMatchesProfile(session, { helperId: 'h1', businessId: 99 })).toBe(false);
    expect(tokenMatchesProfile({ helper_id: 'h1', business_id: null }, { helperId: 'h1' })).toBe(true);
    expect(tokenMatchesProfile({ helper_id: 'h1', business_id: null }, { helperId: 'h1', businessId: 1 })).toBe(false);
  });

  test('canEnterLiveMode requires helper/business destination + online + auth or verified guest', () => {
    expect(canEnterLiveMode({ destination: 'oxsteed', providerOnline: true, userId: 'u1' })).toBe(false);
    expect(canEnterLiveMode({ destination: 'helper', providerOnline: false, userId: 'u1' })).toBe(false);
    expect(canEnterLiveMode({ destination: 'helper', providerOnline: true, userId: 'u1' })).toBe(true);
    expect(canEnterLiveMode({ destination: 'business', providerOnline: true, userId: 'u1' })).toBe(true);
    expect(canEnterLiveMode({
      destination: 'helper',
      providerOnline: true,
      verifiedGuest: { id: 's1', guest_verified_at: new Date() },
    })).toBe(true);
    expect(canEnterLiveMode({
      destination: 'business',
      providerOnline: true,
      verifiedGuest: { id: 's1', guest_verified_at: new Date() },
    })).toBe(true);
    expect(canEnterLiveMode({ destination: 'helper', providerOnline: true })).toBe(false);
  });
});
