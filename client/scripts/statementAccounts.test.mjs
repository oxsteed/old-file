import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildStatementAccounts, statementAccountPath, statementScopeAccountId } from '../src/lib/statementAccounts.js';

const product = scopes => ({ hasAccount: true, scopes });

test('only actual accounts appear; unavailable, setup and failed products are hidden', () => {
  assert.deepEqual(buildStatementAccounts(), []);
  assert.deepEqual(buildStatementAccounts({
    oxsteedCredit: { hasAccount: false, setupState: 'setup_needed', scopes: [] },
    helperEarnings: { hasAccount: false, scopes: [] },
    business: { hasAccount: true, loadError: true, scopes: [{ scopeKey: 'b', businessId: '1' }] },
  }), []);
  const accounts = buildStatementAccounts({ oxsteedCredit: product([{ scopeKey: 'ox:USD', currency: 'USD' }]) });
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].group, 'personal');
});

test('restaurant and business records join by business ID; personal wallets and identical names remain separate', () => {
  const accounts = buildStatementAccounts({
    restaurantCredit: product([{ scopeKey: 'wallet:9', restaurantId: '9', label: 'Bistro' }]),
    restaurantSettlement: product([
      { scopeKey: 'settlement:9', restaurantId: '9', businessId: '42', label: 'Bistro' },
      { scopeKey: 'settlement:10', restaurantId: '10', businessId: '42', label: 'Second location' },
    ]),
    business: product([
      { scopeKey: 'business:42', businessId: '42', label: 'Bistro' },
      { scopeKey: 'business:43', businessId: '43', label: 'Bistro' },
    ]),
  });
  assert.equal(accounts.length, 3);
  const merchant = accounts.find(item => item.key === 'work:business:42');
  assert.deepEqual(merchant.records.map(item => item.product), ['restaurant_settlement', 'business']);
  assert.equal(merchant.records[0].scopes.length, 2);
  assert.equal(accounts.find(item => item.key === 'personal:restaurant:9').records[0].product, 'restaurant');
});

test('currencies remain distinct scopes without aggregated balances; helpers need no issued document', () => {
  const scopes = [{ scopeKey: 'ox:USD', currency: 'USD' }, { scopeKey: 'ox:EUR', currency: 'EUR' }];
  const accounts = buildStatementAccounts({ oxsteedCredit: product(scopes), helperEarnings: product([{ scopeKey: 'helper:pending', currency: null }]) });
  assert.equal(accounts.length, 2);
  assert.deepEqual(accounts[0].records[0].scopes, scopes);
  assert.equal(accounts[1].key, 'work:helper');
  assert.equal(accounts[0].balance, undefined);
});

test('full page routes retain account and currency for every financial product', () => {
  const products = {
    oxsteedCredit: product([{ scopeKey: 'ox:USD', accountId: '17', currency: 'USD' }]),
    restaurantCredit: product([{ scopeKey: 'wallet:9', accountId: '18', restaurantId: '9', currency: 'USD' }]),
    helperEarnings: product([{ scopeKey: 'helper:USD', currency: 'USD' }]),
    restaurantSettlement: product([{ scopeKey: 'settlement:9', restaurantId: '9', businessId: '42', currency: 'USD' }]),
    business: product([{ scopeKey: 'business:42', businessId: '42', currency: 'USD' }]),
  };
  const records = buildStatementAccounts(products).flatMap(item => item.records);
  for (const record of records) {
    const scope = record.scopes[0];
    const url = new URL(statementAccountPath(record, scope, 'helper-id'), 'https://example.test');
    assert.equal(url.searchParams.get(record.personal ? 'currencyCode' : 'currency'), 'USD');
    if (!record.personal) assert.equal(url.searchParams.get('accountId'), statementScopeAccountId(record, scope, 'helper-id'));
    const archive = new URL(statementAccountPath(record, scope, 'helper-id', true), 'https://example.test');
    assert.equal(archive.searchParams.get('currency'), 'USD');
    assert.equal(archive.searchParams.get('accountId'), statementScopeAccountId(record, scope, 'helper-id'));
  }
});

test('account flow labels resolve in the active namespace with legacy parity in all five languages', () => {
  const keys = ['accountsTitle', 'personalTitle', 'personalDescription', 'workTitle', 'workDescription',
    'accountFlowDescription', 'separateAccountsNote', 'oxsteedAccount', 'helperAccount', 'record_oxsteed',
    'record_restaurant', 'record_restaurant_settlement', 'record_helper_earnings', 'record_business', 'changeAccount',
    'openFullPage', 'recordType', 'accountCurrency', 'statementView', 'periodActivity', 'searchAllRecords',
    'noAccountsYet', 'partialLoadError', 'accountUnavailable'];
  for (const language of ['en', 'es', 'fr', 'ht', 'ar']) {
    const active = JSON.parse(fs.readFileSync(new URL(`../src/i18n/locales/${language}/credit.json`, import.meta.url))).statements.center;
    const legacy = JSON.parse(fs.readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url))).statementCenter;
    for (const key of keys) {
      assert.ok(active[key], `${language}: ${key}`);
      assert.equal(active[key], legacy[key], `${language}: ${key}`);
    }
  }
});
