'use strict';

// pgStringArray: node-pg returns custom-enum arrays (logistics_user_role[])
// as raw Postgres array literals. An empty '{}' literal must normalize to
// [], not to a truthy 2-char string that blocks every buyer.
const { pgStringArray } = require('../utils/pgArray');

describe('pgStringArray', () => {
  test('passes real arrays through', () => {
    expect(pgStringArray(['a', 'b'])).toEqual(['a', 'b']);
    expect(pgStringArray([])).toEqual([]);
  });

  test('empty literal means no restriction', () => {
    expect(pgStringArray('{}')).toEqual([]);
  });

  test('parses populated literals', () => {
    expect(pgStringArray('{individual_buyer}')).toEqual(['individual_buyer']);
    expect(pgStringArray('{individual_buyer,business_buyer}')).toEqual([
      'individual_buyer',
      'business_buyer',
    ]);
  });

  test('handles quoted elements with commas', () => {
    expect(pgStringArray('{"a,b",c}')).toEqual(['a,b', 'c']);
  });

  test('null, undefined and non-strings become []', () => {
    expect(pgStringArray(null)).toEqual([]);
    expect(pgStringArray(undefined)).toEqual([]);
    expect(pgStringArray(42)).toEqual([]);
    expect(pgStringArray('not-an-array')).toEqual([]);
  });
});
