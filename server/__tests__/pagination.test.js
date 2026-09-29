'use strict';

const { parseBoundedPagination } = require('../utils/pagination');

describe('parseBoundedPagination', () => {
  test('uses defaults for missing and malformed values', () => {
    expect(parseBoundedPagination({})).toEqual({ page: 1, limit: 25, offset: 0 });
    expect(parseBoundedPagination({ page: 'nope', limit: '-5' })).toEqual({ page: 1, limit: 25, offset: 0 });
  });

  test('clamps page and limit to configured bounds', () => {
    expect(parseBoundedPagination({ page: '999999999', limit: '9999' }, { maxPage: 1000, maxLimit: 50 }))
      .toEqual({ page: 1000, limit: 50, offset: 49950 });
  });

  test('never produces a negative offset', () => {
    const result = parseBoundedPagination({ page: '0', limit: '0' });
    expect(result.page).toBeGreaterThan(0);
    expect(result.limit).toBeGreaterThan(0);
    expect(result.offset).toBeGreaterThanOrEqual(0);
  });
});
