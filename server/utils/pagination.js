'use strict';

/**
 * Parse user-controlled pagination values once, with safe defaults and hard
 * upper bounds. Keeping this in one place prevents individual admin endpoints
 * from accidentally accepting negative offsets, NaN, or unbounded page sizes.
 */
function parseBoundedPagination(query = {}, options = {}) {
  const defaultPage = Number.isInteger(options.defaultPage) && options.defaultPage > 0
    ? options.defaultPage
    : 1;
  const defaultLimit = Number.isInteger(options.defaultLimit) && options.defaultLimit > 0
    ? options.defaultLimit
    : 25;
  const maxPage = Number.isInteger(options.maxPage) && options.maxPage > 0
    ? options.maxPage
    : 1_000_000;
  const maxLimit = Number.isInteger(options.maxLimit) && options.maxLimit > 0
    ? options.maxLimit
    : 100;

  const parsedPage = Number.parseInt(String(query.page ?? defaultPage), 10);
  const parsedLimit = Number.parseInt(String(query.limit ?? defaultLimit), 10);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0
    ? Math.min(parsedPage, maxPage)
    : defaultPage;
  const limit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, maxLimit)
    : defaultLimit;

  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { parseBoundedPagination };
