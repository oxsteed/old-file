'use strict';

/**
 * E04 — Bounded pagination helper.
 *
 * Every list endpoint must bound its result set so no unbounded query can
 * exhaust the pool. This helper parses limit/offset (or page) query params
 * into clamped integers: the limit never exceeds maxLimit, offsets are never
 * negative, and garbage input falls back to safe defaults instead of
 * throwing or becoming unbounded.
 *
 * Usage:
 *   const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
 *   const { rows } = await pool.query('SELECT ... LIMIT $1 OFFSET $2', [limit, offset]);
 */

function toNonNegativeInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function parsePagination(query = {}, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const safeMax = Math.max(1, Math.floor(Number(maxLimit) || 200));
  const safeDefault = Math.min(safeMax, Math.max(1, Math.floor(Number(defaultLimit) || 50)));

  let limit = toNonNegativeInt(query.limit, safeDefault);
  if (limit === 0) limit = safeDefault;
  limit = Math.min(limit, safeMax);

  let offset;
  if (query.page !== undefined && query.page !== null && query.page !== '') {
    const page = Math.max(1, toNonNegativeInt(query.page, 1) || 1);
    offset = (page - 1) * limit;
  } else {
    offset = toNonNegativeInt(query.offset, 0);
  }

  return { limit, offset };
}

module.exports = { parsePagination };
