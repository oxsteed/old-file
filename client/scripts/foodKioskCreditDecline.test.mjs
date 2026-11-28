import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/food/FoodKioskPage.jsx', import.meta.url), 'utf8');
const locales = ['en', 'es', 'fr', 'ht', 'ar'].map((lang) => ({
  lang,
  screens: JSON.parse(fs.readFileSync(new URL(`../src/i18n/locales/${lang}/common.json`, import.meta.url), 'utf8')).screens,
}));

// G13-A4 (D-759): the kiosk must not assert Credit covers the full order
// when it has no balance read, and an insufficient-funds decline must name
// the shortfall instead of blaming card/PIN.
test('kiosk no longer hardcodes a $0.00 remainder or full-coverage copy', () => {
  assert.equal(page.includes('creditRemainderCovered'), false);
  assert.equal(page.includes('formatFoodMoney(0, currency)'), false);
  assert.equal(page.includes('creditBalanceCheckedAtPayment'), true);
});

test('insufficient-funds declines name the shortfall from the server error fields', () => {
  assert.equal(page.includes('credit_insufficient_funds'), true);
  assert.equal(page.includes('creditInsufficientFunds'), true);
  assert.equal(page.includes('creditInsufficientFundsUnknown'), true);
  // Shortfall is requested minus available; a missing/invalid pair falls
  // back to the amount-less message rather than inventing a number.
  assert.equal(page.includes('requestedCents'), true);
  assert.equal(page.includes('availableBalanceCents'), true);
  assert.match(page, /requested > available \? requested - available : null/);
});

test('the three kiosk decline keys exist in all five locales and the false-coverage keys are gone', () => {
  for (const { lang, screens } of locales) {
    assert.equal(typeof screens.creditBalanceCheckedAtPayment, 'string', lang);
    assert.equal(typeof screens.creditInsufficientFunds, 'string', lang);
    assert.match(screens.creditInsufficientFunds, /\{\{shortfall\}\}/, lang);
    assert.equal(typeof screens.creditInsufficientFundsUnknown, 'string', lang);
    assert.equal(screens.creditRemainder, undefined, lang);
    assert.equal(screens.creditRemainderCovered, undefined, lang);
  }
});
