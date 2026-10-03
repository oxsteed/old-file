import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const quickLinksSource = fs.readFileSync(new URL('../src/components/DashboardQuickLinks.jsx', import.meta.url), 'utf8');
const creditPageSource = fs.readFileSync(new URL('../src/pages/food/OxsteedCreditPage.jsx', import.meta.url), 'utf8');
const sectionSource = fs.readFileSync(new URL('../src/pages/food/WalletRestaurantWallets.jsx', import.meta.url), 'utf8');

const GUARDED = '<Guarded><ProtectedRoute><RouteErrorBoundary><OxsteedCreditPage /></RouteErrorBoundary></ProtectedRoute></Guarded>';

test('/wallet route renders the Wallet page with the same guards as /oxsteed-credit', () => {
  assert.match(appSource, new RegExp(`path="/wallet"\\s+element=\\{${GUARDED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`));
  assert.match(appSource, new RegExp(`path="/oxsteed-credit"\\s+element=\\{${GUARDED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`));
});

test('dashboard Wallet quick link points at /wallet', () => {
  assert.match(quickLinksSource, /const WALLET_LINK = link\('\/wallet'/);
});

test('restaurant wallets section fetches independently via its own effect', () => {
  assert.match(sectionSource, /listMyFoodRestaurantWallets/);
  assert.match(sectionSource, /useEffect\(\(\) => \{\s*\n?\s*load\(\);/);
  assert.match(sectionSource, /const \[loading, setLoading\] = useState\(true\)/);
  assert.match(sectionSource, /const \[error, setError\] = useState\(null\)/);
});

test('restaurant section renders outside the OxSteed Credit loading branch', () => {
  const sectionIndex = creditPageSource.indexOf('<WalletRestaurantWallets />');
  assert.ok(sectionIndex !== -1, 'OxsteedCreditPage must render <WalletRestaurantWallets />');
  const loadingTernary = creditPageSource.indexOf('{loading ?');
  assert.ok(loadingTernary !== -1, 'expected the OxSteed loading ternary');
  assert.ok(sectionIndex < loadingTernary, 'restaurant section must render before (outside) the OxSteed loading branch');
});

test('page is retitled Wallet, not OxSteed Credit balance', () => {
  assert.match(creditPageSource, /<h1>\{t\('walletTitle'\)\}<\/h1>/);
  assert.match(creditPageSource, /title=\{t\('walletTitle'\)\}/);
});

test('no ledgers are merged: section never combines balances across wallets', () => {
  assert.doesNotMatch(sectionSource, /\.reduce\(/);
  assert.doesNotMatch(sectionSource, /totalBalance|combinedBalance|grandTotal/i);
});

test('all five credit catalogs carry the new wallet keys', () => {
  const keys = [
    'walletTitle', 'walletDescription', 'oxsteedCreditSectionTitle',
    'restaurantWalletsTitle', 'restaurantWalletsCopy', 'restaurantWalletsLoading',
    'restaurantWalletsError', 'restaurantWalletsEmpty', 'restaurantWalletsEmptyCopy',
    'viewRestaurantWallet',
  ];
  for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(fs.readFileSync(new URL(`../src/i18n/locales/${locale}/credit.json`, import.meta.url), 'utf8'));
    for (const key of keys) {
      assert.ok(typeof catalog[key] === 'string' && catalog[key].length > 0, `${locale} credit.json missing ${key}`);
      assert.doesNotMatch(catalog[key], /—/, `${locale} ${key} must not contain an em dash`);
    }
  }
});
