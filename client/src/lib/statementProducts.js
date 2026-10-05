export const STATEMENT_PRODUCTS = Object.freeze({
  oxsteed: { root: '/oxsteed-credit', label: 'oxsteedProduct', settlement: false },
  restaurant: { root: '/restaurant-credit', label: 'restaurantProduct', settlement: false },
  restaurant_settlement: { root: '/restaurant-settlement', label: 'restaurantSettlement', settlement: true },
  helper_earnings: { root: '/helper-earnings', label: 'helperEarnings', settlement: true },
  business: { root: '/business', label: 'business', settlement: true },
});

export function statementAccessiblePath(item) {
  const query = new URLSearchParams({ product: item.product, currencyCode: item.currency });
  if (item.period?.from) query.set('from', item.period.from);
  if (item.period?.to) query.set('to', item.period.to);
  if (item.accountId != null) query.set('accountId', String(item.accountId));
  if (item.kind === 'amendment') query.set('version', 'amendment');
  return `/statements/${encodeURIComponent(item.id)}/accessible?${query}`;
}
