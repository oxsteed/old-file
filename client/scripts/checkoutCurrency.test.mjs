// Mobile/PWA M19: CheckoutPage hardcoded USD/"$" display while the
// server intent total is authoritative. The intent currency (then the
// session currency, then USD) must drive every amount, and the intent
// currency must reach DirectPaymentRecordModal.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

test('M19: intent currency wins, then session, then USD', async () => {
  const { resolveCheckoutCurrency } = await import('../src/utils/checkoutCurrency.js');
  assert.equal(resolveCheckoutCurrency({ intent: { currency: 'eur' } }), 'EUR');
  assert.equal(resolveCheckoutCurrency({ intent: { currency: 'EUR' }, session: { currency: 'USD' } }), 'EUR');
  assert.equal(resolveCheckoutCurrency({ intent: {}, session: { currency: 'gbp' } }), 'GBP');
  assert.equal(resolveCheckoutCurrency({}), 'USD');
  assert.equal(resolveCheckoutCurrency({ intent: { currency: 'XXX' } }), 'USD', 'unknown codes fall back to USD');
});

test('M19: amounts format in their own currency, not a hardcoded $', async () => {
  const { formatMoney } = await import('../src/shared/money.js');
  assert.match(formatMoney(1250, 'USD'), /\$/);
  assert.match(formatMoney(1250, 'EUR'), /€/, 'a EUR total must show euros, not dollars');
  assert.doesNotMatch(formatMoney(1250, 'EUR'), /\$/);
  assert.equal(formatMoney(1200, 'JPY'), '¥1,200', 'zero-exponent currencies render without decimals');
});

test('M19: CheckoutPage renders the resolved currency and passes it to the modal', () => {
  const src = fs.readFileSync(path.join(root, '../src/pages/CheckoutPage.jsx'), 'utf8');
  assert.match(src, /resolveCheckoutCurrency/, 'page must resolve the currency from intent/session');
  assert.match(src, /formatMoney\(/, 'amounts must render through the shared money formatter');
  assert.doesNotMatch(src, /\$\{\(/, 'no amount may render with a hardcoded $');
  assert.doesNotMatch(src, /currencyCode="USD"/, 'modal must not receive a hardcoded USD');
  assert.match(src, /currencyCode=\{checkoutCurrency\}/, 'modal must receive the resolved intent currency');
});

test('M19: server returns the currency it charged in', () => {
  const src = fs.readFileSync(path.join(root, '../../server/controllers/cartCheckoutController.js'), 'utf8');
  assert.match(src, /currency: 'USD'/, 'checkout responses must carry the currency alongside amounts');
});
