'use strict';
const { AppError } = require('../middleware/errorHandler');

exports.reviewPage = query => {
  const requested = Number(query.limit);
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 500) : 200;
  if (!query.cursor) return { limit, cursor: null };
  try {
    if (typeof query.cursor !== 'string' || query.cursor.length > 1000) throw new Error('Invalid cursor');
    const cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
    if (!cursor || typeof cursor.ts !== 'string' || cursor.ts.length > 64 || !Number.isFinite(Date.parse(cursor.ts))
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id)) throw new Error('Invalid cursor');
    return { limit, cursor };
  } catch {
    throw new AppError('Invalid review queue cursor', 400, 'invalid_review_cursor');
  }
};

exports.reviewPageResult = (rows, limit) => {
  const visible = rows.slice(0, limit);
  const has_more = rows.length > limit;
  const last = visible.at(-1);
  // PostgreSQL text retains microseconds; JavaScript Date only retains millis.
  const next_cursor = has_more && last ? Buffer.from(JSON.stringify({
    ts: last.cursor_timestamp, id: last.id,
  })).toString('base64url') : null;
  return { rows: visible.map(({ cursor_timestamp, ...row }) => row), has_more, next_cursor };
};
