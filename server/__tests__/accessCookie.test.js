'use strict';

const {
  readAccessCookie,
  isCookieAuthOriginAllowed,
  resolveSocketAccessToken,
} = require('../utils/accessCookie');

describe('accessCookie helpers', () => {
  test('readAccessCookie returns null for malformed percent-encoding', () => {
    expect(readAccessCookie('oxsteed_access=%E0')).toBeNull();
    expect(readAccessCookie('session=abc; oxsteed_access=%ZZ')).toBeNull();
  });

  test('readAccessCookie decodes a valid access cookie', () => {
    const token = 'eyJ.test.token';
    expect(readAccessCookie(`oxsteed_access=${encodeURIComponent(token)}`)).toBe(token);
  });

  test('resolveSocketAccessToken rejects cookie auth from disallowed origins', () => {
    const socket = {
      handshake: {
        auth: {},
        headers: {
          cookie: 'oxsteed_access=abc123',
          origin: 'https://evil.example',
        },
      },
    };
    const result = resolveSocketAccessToken(socket, {
      allowedOrigins: ['https://oxsteed.com'],
    });
    expect(result.token).toBeNull();
    expect(result.rejected).toBe('origin_not_allowed');
  });

  test('resolveSocketAccessToken honours cookie from an allowed origin', () => {
    const socket = {
      handshake: {
        auth: {},
        headers: {
          cookie: 'oxsteed_access=allowed-token',
          origin: 'https://oxsteed.com',
        },
      },
    };
    const result = resolveSocketAccessToken(socket, {
      allowedOrigins: ['https://oxsteed.com'],
    });
    expect(result.token).toBe('allowed-token');
    expect(result.source).toBe('cookie');
  });

  test('isCookieAuthOriginAllowed allows missing Origin', () => {
    expect(isCookieAuthOriginAllowed(undefined, ['https://oxsteed.com'])).toBe(true);
  });
});
