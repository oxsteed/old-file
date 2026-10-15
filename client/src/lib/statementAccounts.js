// Presentation only. Access is determined by the server, never roles or names.
export const STATEMENT_RECORDS = {
  oxsteedCredit: { product: 'oxsteed', root: '/oxsteed-credit', personal: true },
  restaurantCredit: { product: 'restaurant', root: '/restaurant-credit', personal: true },
  helperEarnings: { product: 'helper_earnings', root: '/helper-earnings' },
  restaurantSettlement: { product: 'restaurant_settlement', root: '/restaurant-settlement' },
  business: { product: 'business', root: '/business' },
};

export function buildStatementAccounts(products = {}) {
  const accounts = new Map();
  for (const [recordKey, config] of Object.entries(STATEMENT_RECORDS)) {
    const entry = products?.[recordKey];
    if (!entry?.hasAccount || entry.loadError || !Array.isArray(entry.scopes)) continue;
    for (const scope of entry.scopes) {
      if (!scope?.scopeKey) continue;
      let key;
      if (recordKey === 'oxsteedCredit') key = 'personal:oxsteed';
      else if (recordKey === 'restaurantCredit' && scope.restaurantId) key = `personal:restaurant:${scope.restaurantId}`;
      else if (recordKey === 'helperEarnings') key = 'work:helper';
      else if (recordKey === 'business' && scope.businessId) key = `work:business:${scope.businessId}`;
      else if (recordKey === 'restaurantSettlement' && scope.restaurantId) {
        key = scope.businessId ? `work:business:${scope.businessId}` : `work:restaurant:${scope.restaurantId}`;
      } else continue;
      if (!accounts.has(key)) accounts.set(key, {
        key, group: config.personal ? 'personal' : 'work',
        labelKey: recordKey === 'oxsteedCredit' ? 'oxsteedAccount' : recordKey === 'helperEarnings' ? 'helperAccount' : null,
        label: scope.label, records: [],
      });
      const account = accounts.get(key);
      // A business can own several restaurant locations; use its name and ID.
      if (recordKey === 'business') account.label = scope.label;
      let record = account.records.find(item => item.key === recordKey);
      if (!record) {
        record = { key: recordKey, ...config, scopes: [] };
        account.records.push(record);
      }
      if (!record.scopes.some(item => item.scopeKey === scope.scopeKey)) record.scopes.push(scope);
    }
  }
  return [...accounts.values()];
}

export function statementScopeAccountId(record, scope, userId) {
  if (record.personal) return scope.accountId;
  if (record.product === 'business') return scope.businessId;
  if (record.product === 'restaurant_settlement') return scope.restaurantId;
  if (record.product === 'helper_earnings') return userId;
  return undefined;
}

export function statementAccountPath(record, scope, userId, archive = false) {
  const params = new URLSearchParams();
  if (archive || !record.personal) {
    const accountId = statementScopeAccountId(record, scope, userId);
    if (accountId) params.set('accountId', accountId);
    if (scope.currency) params.set('currency', scope.currency);
  } else {
    if (scope.currency) params.set('currencyCode', scope.currency);
    if (scope.restaurantId) params.set('restaurantId', scope.restaurantId);
  }
  return `${record.root}/statements${archive && record.personal ? '/archive' : ''}${params.size ? `?${params}` : ''}`;
}
