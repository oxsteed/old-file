// statementTrends.js — pure helper for Slice 5e, item 725 (D-751).
//
// The trends endpoint compares whole calendar months (current vs previous),
// so the comparison month is derived from the applied statement's period:
// when from/to fall in one calendar month, that month; otherwise the month
// containing `to` (a custom range compares its ending month). The trends
// section names both compared periods in its summary, so the ending-month
// rule is never misleading. Returns undefined when the period is missing or
// malformed, in which case PeriodTrends keeps its existing default (the
// current UTC month).

export function trendPeriodForStatement(period) {
  if (!period || typeof period.from !== 'string' || typeof period.to !== 'string') return undefined;
  const fromMonth = period.from.slice(0, 7);
  const toMonth = period.to.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(fromMonth) || !/^\d{4}-\d{2}$/.test(toMonth)) return undefined;
  return fromMonth === toMonth ? fromMonth : toMonth;
}
