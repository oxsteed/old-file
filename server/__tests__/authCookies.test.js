'use strict';

const {
  setSessionCookies,
  setAccessTokenCookie,
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} = require('../utils/authCookies');

function mockRes() {
  const cookies = [];
  return {
    cookies,
    cookie(name, value, opts) {
      cookies.push({ name, value, opts });
    },
  };
}

describe('authCookies session issuance', () => {
  test('setSessionCookies sets access and refresh cookies', () => {
    const res = mockRes();
    setSessionCookies(res, {
      accessToken: 'access.jwt',
      refreshToken: 'refresh.jwt',
    }, { rememberMe: true });
    expect(res.cookies).toHaveLength(2);
    expect(res.cookies.map((c) => c.name)).toEqual([ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME]);
    expect(res.cookies[0].opts.httpOnly).toBe(true);
    expect(res.cookies[1].opts.httpOnly).toBe(true);
  });

  test('setAccessTokenCookie sets only the access cookie', () => {
    const res = mockRes();
    setAccessTokenCookie(res, 'only-access');
    expect(res.cookies).toHaveLength(1);
    expect(res.cookies[0].name).toBe(ACCESS_COOKIE_NAME);
    expect(res.cookies[0].value).toBe('only-access');
  });
});
