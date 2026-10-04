import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const quickLinksSource = fs.readFileSync(new URL('../src/components/DashboardQuickLinks.jsx', import.meta.url), 'utf8');
const walletPageSource = fs.readFileSync(new URL('../src/pages/food/WalletPage.jsx', import.meta.url), 'utf8');
const creditPageSource = fs.readFileSync(new URL('../src/pages/food/OxsteedCreditPage.jsx', import.meta.url), 'utf8');
const sectionSource = fs.readFileSync(new URL('../src/pages/food/WalletRestaurantWallets.jsx', import.meta.url), 'utf8');

const GUARDED = (page) => `<Guarded><ProtectedRoute><RouteErrorBoundary><${page} /></RouteErrorBoundary></ProtectedRoute></Guarded>`;

test('/wallet renders the Wallet overview page with the standard guards', () => {
  assert.match(appSource, new RegExp(`path="/wallet"\\s+element=\\{${GUARDED('WalletPage').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`));
});

test('/oxsteed-credit renders the dedicated OxSteed Credit page with the standard guards', () => {
  assert.match(appSource, new RegExp(`path="/oxsteed-credit"\\s+element=\\{${GUARDED('OxsteedCreditPage').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`));
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

test('Wallet overview renders the restaurant section', () => {
  const sectionIndex = walletPageSource.indexOf('<WalletRestaurantWallets');
  assert.ok(sectionIndex !== -1, 'WalletPage must render <WalletRestaurantWallets />');
});

test('OxSteed Credit page does not embed the restaurant wallets section', () => {
  assert.ok(!creditPageSource.includes('<WalletRestaurantWallets'), 'OxsteedCreditPage must not reference WalletRestaurantWallets');
});

test('Wallet page is titled Wallet, credit page is titled OxSteed Credit', () => {
  assert.match(walletPageSource, /<h1>\{t\('walletTitle'\)\}<\/h1>/);
  assert.match(walletPageSource, /title=\{t\('walletTitle'\)\}/);
  assert.match(creditPageSource, /<h1>\{t\('creditTitle'\)\}<\/h1>/);
  assert.match(creditPageSource, /title=\{t\('creditTitle'\)\}/);
});

test('Wallet overview links to the dedicated OxSteed Credit page', () => {
  assert.match(walletPageSource, /to="\/oxsteed-credit"/);
  assert.match(walletPageSource, /t\('manageOxsteedCredit'\)/);
});
