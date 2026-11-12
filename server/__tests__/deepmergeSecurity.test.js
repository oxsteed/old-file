const deepmerge = require('deepmerge');

describe('vendored deepmerge security guard', () => {
  test('does not copy prototype-related keys from untrusted objects', () => {
    const source = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}'
    );

    const merged = deepmerge({}, source);

    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(merged, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(merged, 'constructor')).toBe(false);
  });
});
