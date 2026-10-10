const { addAdditionalSecurityHeaders } = require('../middleware/responseSanitizer');

describe('additional security headers', () => {
  test('allows same-origin geolocation for Media while denying unrelated capabilities', () => {
    const headers = {};
    const response = {
      set(name, value) { headers[name] = value; },
      getHeader(name) { return headers[name]; },
    };
    const next = jest.fn();

    addAdditionalSecurityHeaders({ path: '/media', protocol: 'https' }, response, next);

    expect(headers['Permissions-Policy']).toBe('geolocation=(self), microphone=(), camera=(), payment=()');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
