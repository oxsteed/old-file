const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('real restaurant checkout renders saved cards and safely switches to a new card', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/pages/food/FoodRestaurantPage.jsx'), 'utf8');
  const start = source.indexOf('const CheckoutCardForm = React.forwardRef(');
  const end = source.indexOf('// CC1: in-checkout restaurant-credit bottom sheet.', start);
  assert.ok(start >= 0 && end > start, 'extract the real checkout component, not a rewritten fixture');
  const result = await build({
    stdin: {
      resolveDir: path.resolve(__dirname, '..'), loader: 'jsx',
      contents: `import React, { useImperativeHandle } from 'react';
        import { createRoot } from 'react-dom/client';
        const useTranslation = () => ({ t: key => key === 'food.restaurant.useNewCard' ? 'Use a new card' : key });
        const useStripe = () => null;
        const useElements = () => null;
        const CardElement = () => <div data-testid="new-card">New card input</div>;
        const ExpressCheckoutElement = () => <div data-testid="express">Express checkout</div>;
        const listSavedPaymentMethods = async () => {
          if (window.rejectSavedMethods) throw new Error('Saved cards unavailable');
          return [{ id: 'pm_fixture', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 }];
        };
        ${source.slice(start, end)}
        class Boundary extends React.Component {
          state = { error: null };
          static getDerivedStateFromError(error) { return { error }; }
          render() { return this.state.error ? <p role="alert">{this.state.error.message}</p> : this.props.children; }
        }
        createRoot(document.getElementById('root')).render(
          <React.StrictMode><Boundary><CheckoutCardForm onExpressConfirm={() => {}} /></Boundary></React.StrictMode>);`,
    },
    bundle: true, write: false, jsx: 'automatic',
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
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => document.querySelectorAll('input[name="saved-card"]').length === 2 || document.querySelector('[role="alert"]'));
    assert.equal(await page.getByRole('alert').count(), 0, 'saved-card loading must not crash checkout');
    const savedCard = page.getByRole('radio', { name: /visa/ });
    const newCard = page.getByRole('radio', { name: 'Use a new card' });
    assert.equal(await newCard.isChecked(), true);
    assert.equal(await page.getByTestId('new-card').count(), 1);
    await savedCard.check();
    assert.equal(await savedCard.isChecked(), true);
    assert.equal(await page.getByTestId('new-card').count(), 0);
    await newCard.check();
    assert.equal(await page.getByTestId('new-card').count(), 1);
    assert.equal(await page.getByTestId('express').count(), 1);
    assert.deepEqual(errors, []);

    // Failed saved-card retrieval is a progressive enhancement, not a checkout outage.
    await page.addInitScript(() => { window.rejectSavedMethods = true; });
    await page.reload();
    await page.getByTestId('new-card').waitFor();
    assert.equal(await page.getByRole('radio').count(), 0);
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
