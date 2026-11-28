// statementFreshness.js — pure client helpers for Slice 5e, item 721 (D-746, D-747).
//
// The server reports dataset freshness per product/scope ({ state,
// latestPeriod, expectedPeriod }); these helpers cover the two places the
// client derives freshness itself:
// - dataAsOfDate: an interim report's dataset is live activity, so its
//   freshness is the latest posted transaction date (or the period end when
//   nothing posted yet). Monthly documents are frozen at period end and need
//   no as-of line; the page shows one only for interim reports.
// - formatPeriodMonth: 'YYYY-MM' -> a localized "October 2026" for the
//   freshness copy. No i18n key: month names come from Intl.

// Latest posted date in the statement ('YYYY-MM-DD'), or the period end
// when the report has no transactions. Null when there is no statement.
export function dataAsOfDate(statement) {
  if (!statement) return null;
  const dates = (statement.transactions || [])
    .map((entry) => entry?.date)
    .filter((value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))
    .map((value) => value.slice(0, 10))
    .sort();
  if (dates.length) return dates[dates.length - 1];
  const to = statement.period?.to;
  return typeof to === 'string' && /^\d{4}-\d{2}-\d{2}/.test(to) ? to.slice(0, 10) : null;
}

// 'YYYY-MM' -> "October 2026" in the UI language (UTC, so the month never
// shifts with the viewer's timezone). Falls back to the raw value.
export function formatPeriodMonth(period, language = 'en') {
  if (typeof period !== 'string' || !/^\d{4}-\d{2}$/.test(period)) return period || '';
  const [year, month] = period.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(year, month - 1, 1)));
  } catch {
    return period;
  }
}
