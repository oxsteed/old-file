import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatSharedCartTotal,
  sharedCartHref,
  sharedCartCardData,
} from '../src/components/messaging/sharedCartCard.js';

const ATT = {
  type: 'shared_cart',
  url: '/shared-cart/abc123',
  share_token: 'abc123',
  cart_name: 'Parts for Toilet replacement',
  item_count: 5,
  total_cents: 2599,
  currency: 'USD',
};

test('messenger imports the JSX card explicitly rather than the similarly named helper', () => {
  const thread = readFileSync(new URL('../src/components/messaging/ConversationThread.jsx', import.meta.url), 'utf8');
  assert.match(thread, /import SharedCartCard from '\.\/SharedCartCard\.jsx'/);
});

test('card title comes from the attachment cart_name', () => {
  const card = sharedCartCardData(ATT, '{{count}} items');
  assert.equal(card.name, 'Parts for Toilet replacement');
});

test('card item count interpolates the {{count}} template', () => {
  const card = sharedCartCardData(ATT, '{{count}} items');
  assert.equal(card.items, '5 items');
});

test('card item count handles a missing item_count as 0', () => {
  const card = sharedCartCardData({ ...ATT, item_count: undefined }, '{{count}} items');
  assert.equal(card.items, '0 items');
});

test('card total formats cents with the attachment currency', () => {
  assert.equal(formatSharedCartTotal(2599, 'USD'), '$25.99');
  const eur = formatSharedCartTotal(2599, 'EUR');
  assert.match(eur, /25[.,]99/);
});

test('card total falls back to $ when the currency is invalid', () => {
  assert.equal(formatSharedCartTotal(100, 'XX'), '$1.00');
  assert.equal(formatSharedCartTotal(null, null), '$0.00');
});

test('card link uses share_token when present', () => {
  const card = sharedCartCardData(ATT, '{{count}} items');
  assert.equal(card.href, '/shared-cart/abc123');
  assert.equal(sharedCartHref(ATT), '/shared-cart/abc123');
});

test('card link falls back to parsing the attachment url', () => {
  const card = sharedCartCardData({ ...ATT, share_token: undefined }, '{{count}} items');
  assert.equal(card.href, '/shared-cart/abc123');
});

test('card data has no user-visible em dashes', () => {
  const card = sharedCartCardData(ATT, '{{count}} items');
  for (const value of Object.values(card)) {
    assert.ok(!String(value).includes('—'), `em dash found in: ${value}`);
  }
});
