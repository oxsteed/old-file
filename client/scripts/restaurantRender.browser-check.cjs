// Exercise the real page across async loading, search, and restaurant changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

const fixture = {
  restaurant: { id: 2, display_name: 'Hook-safe Kitchen', currency_code: 'USD', fulfillment_modes: ['pickup'] },
  menu: [
    { id: 1, name: 'Mains', items: [{ id: 11, name: 'Rice bowl', price_cents: 1200 }] },
    { id: 2, name: 'Sides', items: [{ id: 12, name: 'RICE BOWL', price_cents: 600 }] },
  ],
  uncategorizedItems: [{ id: 13, name: 'Lemonade', price_cents: 400 }],
};

test('restaurant survives loading, deduplicates dish suggestions, and recovers from not found', async () => {
  const mocks = {
    'react-i18next': `const t = (key, options = {}) => options.defaultValue || key;
      export const useTranslation = () => ({ t, i18n: { resolvedLanguage: 'en' } });`,
    '../../context/AuthContext': `export const useAuth = () => ({ user: null });`,
    '../../api/food': `export const getFoodRestaurant = id => new Promise((resolve, reject) => {
        window.restaurantRequests[id] = { resolve, reject };
      });
      export const listFoodPromotions = async () => [];
      export const listMyFoodOrders = async () => [];
      export const getMyFoodRestaurantWallet = async () => null;
      export const formatFoodMoney = cents => '$' + (Number(cents || 0) / 100).toFixed(2);
      const noWrite = () => { throw new Error('Unexpected API write in render test'); };
      export const placeFoodOrder = noWrite, quoteFoodOrder = noWrite,
        uploadFoodAsset = noWrite, sendFoodRestaurantMessage = noWrite,
        createFoodCardPaymentIntent = noWrite, createRestaurantTopupIntent = noWrite,
        getRestaurantTopup = noWrite, getRestaurantTopupEligibility = noWrite,
        issueRestaurantTopupStepupChallenge = noWrite;`,
    '../../api/oxsteedCredit': `export const getOxsteedCreditAccount = async () => null;
      export const getOxsteedCreditEligibility = async () => null;
      export const listOxsteedCreditEligiblePartners = async () => [];`,
    './useLiveFoodOrder': `export const useLiveFoodOrder = () => ({ order: null });`,
    './components/RestaurantMediaFeed': `export default () => null;`,
    '../../components/Navbar': `export default () => null;`,
    '../../components/Footer': `export default () => null;`,
    '../../components/PageMeta': `export default () => null;`,
    '../../components/AddressAutocomplete': `export default () => null;`,
  };
  const result = await build({
    stdin: {
      contents: `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
        import Page from './src/pages/food/FoodRestaurantPage.jsx';
        window.restaurantRequests = {};
        class Boundary extends React.Component {
          state = { error: null };
          static getDerivedStateFromError(error) { return { error }; }
          componentDidCatch(error) { window.renderFailure = error.message; }
          render() { return this.state.error ? <p role="alert">{this.state.error.message}</p> : this.props.children; }
        }
        createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter>
          <nav><Link to="/restaurants/r/missing?tab=menu">Missing fixture</Link>
            <Link to="/restaurants/r/2?tab=menu">Valid fixture</Link></nav>
          <Boundary><Routes><Route path="/restaurants/r/:restaurantId" element={<Page />} /></Routes></Boundary>
        </BrowserRouter></React.StrictMode>);`,
      resolveDir: path.resolve(__dirname, '..'), loader: 'jsx',
    },
    bundle: true, write: false, jsx: 'automatic',
    loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'restaurant-render-dependencies', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => mocks[args.path]
        ? { path: args.path, namespace: 'restaurant-test' } : undefined);
      plugin.onLoad({ filter: /.*/, namespace: 'restaurant-test' }, args => ({ contents: mocks[args.path], loader: 'jsx' }));
    }}],
  });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(result.outputFiles[0].contents);
    } else res.end('<div id="root"></div><script type="module" src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => {
      errors.push(error.message);
      console.error('Restaurant fixture page error:', error.message);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/restaurants/r/2?tab=menu`);
    await page.getByText('food.restaurant.loadingMenu', { exact: true }).waitFor();
    await page.waitForFunction(() => window.restaurantRequests['2']);
    await page.evaluate(data => window.restaurantRequests['2'].resolve(data), fixture);
    await page.waitForFunction(() => document.querySelector('h1') || window.renderFailure);
    assert.equal(await page.evaluate(() => window.renderFailure), undefined, 'async loading must not change hook order');
    await page.getByRole('heading', { name: 'Hook-safe Kitchen' }).waitFor();
    const search = page.getByRole('combobox', { name: 'food.restaurant.searchMenu' });
    await search.fill('rice');
    await page.getByRole('option').waitFor();
    assert.equal(await page.getByRole('option').count(), 1, 'same dish name across sections must be deduplicated');
    await page.getByRole('option').getByRole('button').click();
    await page.waitForFunction(() => document.querySelector('[role="combobox"]').value === 'Rice bowl');
    assert.equal(await search.inputValue(), 'Rice bowl');
    await search.fill('lemon');
    await page.getByRole('option', { name: /Lemonade/ }).waitFor();
    await search.fill('');

    await page.getByRole('link', { name: 'Missing fixture', exact: true }).click();
    await page.getByText('food.restaurant.loadingMenu', { exact: true }).waitFor();
    await page.waitForFunction(() => window.restaurantRequests.missing);
    await page.evaluate(() => window.restaurantRequests.missing.reject(new Error('Not found')));
    await page.getByText('food.restaurant.notFoundTitle', { exact: true }).waitFor();
    await page.evaluate(() => { delete window.restaurantRequests['2']; });
    await page.getByRole('link', { name: 'Valid fixture', exact: true }).click();
    await page.getByText('food.restaurant.loadingMenu', { exact: true }).waitFor();
    await page.waitForFunction(() => window.restaurantRequests['2']);
    await page.evaluate(data => window.restaurantRequests['2'].resolve(data), fixture);
    await page.getByRole('heading', { name: 'Hook-safe Kitchen' }).waitFor();
    assert.deepEqual(errors, []);
    assert.equal(await page.getByRole('alert').count(), 0);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
