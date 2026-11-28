'use strict';

/**
 * statementFreshness.js — dataset freshness for the statement report views
 * (Slice 5e, item 721).
 *
 * A report view should say how fresh the dataset behind it is. Statement
 * issuance is automatic and monthly: the hourly scheduler issues a document
 * for the latest closed calendar month once the issuance grace has elapsed
 * (statementIssuanceService). So freshness is well-defined without any new
 * table or stamp: compare the latest issued document's month against the
 * latest closed month, on the issuance gate's own clock.
 *
 * States:
 * - `none`    — no document issued yet for the scope (a new account, or the
 *               rail off). Not a warning; the empty states already cover it.
 * - `current` — the latest document covers the latest closed month.
 * - `pending` — the latest document is older than the latest closed month
 *               but the issuance grace has NOT elapsed yet; the scheduler
 *               still has time, so the expected document is "preparing",
 *               not missing.
 * - `stale`   — the latest document is older than the latest closed month
 *               AND the grace has elapsed; the expected document should
 *               exist and does not.
 *
 * The grace is measured by `issuanceGraceElapsed` itself, so the freshness
 * state can never disagree with the issuance gate: a period the scheduler
 * still considers within grace is `pending`, never `stale`.
 */

const {
  latestClosedMonthPeriod,
  issuanceGraceElapsed,
} = require('./statementIssuanceService');

function assessDatasetFreshness(latestPeriod, now = new Date()) {  const expected = latestClosedMonthPeriod(now);
  const expectedPeriod = expected.to.slice(0, 7);
  // Callers pass 'YYYY-MM', a full date string, or a pg Date; normalize to
  // the month either way. A Date's String() form ("Tue Sep 30 ...") would
  // slice to nonsense, so Dates go through toISOString first.
  const latest = latestPeriod instanceof Date
    ? latestPeriod.toISOString().slice(0, 7)
    : latestPeriod
      ? String(latestPeriod).slice(0, 7)
      : null;
  if (!latest) {
    return { state: 'none', latestPeriod: null, expectedPeriod };
  }
  if (latest >= expectedPeriod) {
    return { state: 'current', latestPeriod: latest, expectedPeriod };
  }
  if (issuanceGraceElapsed(expected.to, now)) {
    return { state: 'stale', latestPeriod: latest, expectedPeriod };
  }
  return { state: 'pending', latestPeriod: latest, expectedPeriod };
}

/**
 * findMissingMonths(months) — the months strictly between the earliest and
 * latest issued month that have no document, in order (Slice 5e, item 722).
 *
 * The range starts at the FIRST issued document, never at account opening:
 * months before the first issuance are not expected (the account may not
 * have existed then), and months after the latest issued month are the
 * freshness (stale/pending) question, not a gap. Issuance is automatic and
 * monthly, so a hole inside the issued range means a document that should
 * exist does not. Accepts 'YYYY-MM' strings, full date strings, or pg
 * Dates (DATE_TRUNC results). A scope with fewer than two issued months,
 * or with no holes, returns [].
 */
function findMissingMonths(months) {
  const present = new Set();
  for (const value of months || []) {
    const month = value instanceof Date
      ? value.toISOString().slice(0, 7)
      : typeof value === 'string' && /^\d{4}-\d{2}/.test(value)
        ? value.slice(0, 7)
        : null;
    if (month) present.add(month);
  }
  if (present.size < 2) return [];
  const sorted = [...present].sort();
  const last = sorted[sorted.length - 1];
  const missing = [];
  let [year, month] = sorted[0].split('-').map(Number);
  for (;;) {
    month += 1;
    if (month === 13) { month = 1; year += 1; }
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (key === last) break;
    if (!present.has(key)) missing.push(key);
  }
  return missing;
}

module.exports = { assessDatasetFreshness, findMissingMonths };
