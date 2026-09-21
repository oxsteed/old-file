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
} = require('../services/guestProfileChatVerification');

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
