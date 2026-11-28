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

function assessDatasetFreshness(latestPeriod, now = new Date()) {
  const expected = latestClosedMonthPeriod(now);
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

module.exports = { assessDatasetFreshness };
