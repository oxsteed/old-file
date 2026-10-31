'use strict';

/**
 * auditQ2T35CompletionCohort.test.js — Audit queue Q2, T35-F01.
 *
 * Original defect (Oct 2 audit): the super-admin completion rate combined
 * period completions with lifetime cancellations, so a seven-day card could
 * deteriorate solely because the platform had accumulated old cancellations.
 *
 * The fix: job_completion_rate_pct counts one cohort — decided (completed or
 * cancelled), non-deleted jobs created in the selected window — for both the
 * numerator and the denominator. This test locks that invariant:
 *  - the metric is a single query whose WHERE window applies to every
 *    aggregate (no separate all-time cancellation count);
 *  - the dashboard helper returns the same-window numbers;
 *  - the all-time variant is a different query and is never what the
 *    windowed helper runs.
 */

const {
  DEFINITIONS,
  operationalMetricSql,
  jobCompletionRate,
  jobCompletionRateAllTime,
} = require('../analytics/operationalMetrics');

const WINDOW = 'j.created_at >= NOW()-$1::interval AND j.created_at < NOW()';

describe('T35-F01 completion-rate cohort', () => {
  test('the rate query counts completions and cancellations over the same window', () => {
    const { text } = operationalMetricSql('job_completion_rate_pct', '7 days');

    // One query, one cohort: a single FROM jobs and a single window
    // predicate that the WHERE clause applies to all aggregates.
    expect(text.match(/FROM jobs j/g)).toHaveLength(1);
    expect(text).toContain(WINDOW);
    expect(text).not.toMatch(/SELECT COUNT\(\*\) FROM jobs/);
    // Denominator is the decided set (completed + cancelled), not a
    // completed-only count plus a separately-sourced cancellation count.
    expect(text).toContain("COUNT(*) FILTER (WHERE j.status IN ('completed','cancelled'))");
    expect(text).toContain("COUNT(*) FILTER (WHERE j.status='completed')");
    expect(text).toContain('j.deleted_at IS NULL');
  });

  test('jobCompletionRate returns the same-window numbers', async () => {
    const seen = [];
    const db = {
      query: jest.fn(async (text, params) => {
        seen.push([text, params]);
        return { rows: [{ completion_rate_pct: 70, completed: 7, decided: 10 }] };
      }),
    };

    const rate = await jobCompletionRate(db, '7 days');

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(seen[0][1]).toEqual(['7 days']);
    expect(rate).toEqual({ completion_rate_pct: 70, completed: 7, decided: 10 });
  });

  test('the all-time variant is a different query without the window', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ completion_rate_pct: 55, completed: 11, decided: 20 }] })) };

    const allTime = await jobCompletionRateAllTime(db);
    const windowedText = DEFINITIONS.job_completion_rate_pct.text;

    expect(db.query.mock.calls[0][0]).not.toContain(WINDOW);
    expect(allTime).toEqual({ completion_rate_pct: 55, completed: 11, decided: 20 });
    // The only difference between the two queries is the window predicate.
    expect(db.query.mock.calls[0][0].replace('j.created_at < NOW()', WINDOW)).toBe(windowedText);
  });
});
