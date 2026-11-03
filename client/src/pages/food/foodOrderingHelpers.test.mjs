import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeliveryAddress,
  buildReorderLines,
  formatTrackedMoney,
  itemHasRequiredModifierGroup,
  trackedItemDisplay,
} from './foodOrderingHelpers.js';

test('delivery address carries autocomplete coordinates and the customer city, never defaults', () => {
  const address = buildDeliveryAddress({
    line1: '12 Main St',
    line2: 'Apt 4',
    city: 'Springfield',
    state: 'OH',
    zip: '45501',
    country: 'US',
    instructions: 'Leave at door',
    lat: 39.92,
    lng: -83.81,
  });
  assert.equal(address.line1, '12 Main St');
  assert.equal(address.city, 'Springfield');
  assert.equal(address.zip, '45501');
  assert.equal(address.instructions, 'Leave at door');
  assert.equal(address.lat, 39.92);
  assert.equal(address.lng, -83.81);
});

test('delivery address without coordinates keeps nulls so the server error surfaces instead of a guess', () => {
  const address = buildDeliveryAddress({ line1: '12 Main St', city: 'Springfield' });
  assert.equal(address.lat, null);
  assert.equal(address.lng, null);
  assert.equal(address.line2, undefined);
});

test('quick-add routes to the modal for required modifier groups only', () => {
  assert.equal(itemHasRequiredModifierGroup({
    modifierGroups: [{ id: 1, isRequired: true, options: [] }],
  }), true);
  assert.equal(itemHasRequiredModifierGroup({
    modifierGroups: [{ id: 1, isRequired: false, options: [] }],
  }), false);
  assert.equal(itemHasRequiredModifierGroup({ modifierGroups: [] }), false);
  assert.equal(itemHasRequiredModifierGroup({}), false);
});

test('reorder carries modifiers and notes, prices them from the current menu, and reports dropped ones', () => {
  const menuItem = {
    id: 7,
    name: 'Burger',
    price_cents: 1000,
    canOrder: true,
    modifierGroups: [{
      id: 1,
      options: [
        { id: 11, name: 'Extra cheese', priceDeltaCents: 150 },
        { id: 12, name: 'Bacon', priceDeltaCents: 200 },
      ],
    }],
  };
  const menuById = new Map([['7', menuItem]]);
  const { lines, skipped, dropped } = buildReorderLines([{
    menuItemId: 7,
    quantity: 2,
    modifierIds: [11, 99],
    modifierNames: ['Extra cheese', 'Truffle'],
    specialInstructions: 'No onions',
  }], menuById);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].modifierIds, [11]);
  assert.deepEqual(lines[0].modifierNames, ['Extra cheese']);
  assert.equal(lines[0].notes, 'No onions');
  assert.equal(lines[0].unitCents, 1150);
  assert.equal(lines[0].qty, 2);
  assert.equal(skipped, 0);
  assert.deepEqual(dropped, ['Truffle']);
});

test('reorder skips unavailable items instead of adding them', () => {
  const menuById = new Map([['7', { id: 7, canOrder: false }]]);
  const { lines, skipped } = buildReorderLines([{ menuItemId: 7, quantity: 1 }], menuById);
  assert.equal(lines.length, 0);
  assert.equal(skipped, 1);
});

test('tracking receipt reads itemName and lineTotalCents, never name or price_cents', () => {
  const shown = trackedItemDisplay({ itemName: 'Burger', quantity: 2, lineTotalCents: 2300 });
  assert.equal(shown.name, 'Burger');
  assert.equal(shown.lineTotalCents, 2300);
  // A row with neither new field renders blank and zero, not NaN.
  const empty = trackedItemDisplay({ quantity: 2 });
  assert.equal(empty.name, '');
  assert.equal(empty.lineTotalCents, 0);
});

test('tracking totals format with the server currency, not a hardcoded dollar sign', () => {
  assert.match(formatTrackedMoney(2300, 'EUR', 'en-US'), /€/);
  assert.match(formatTrackedMoney(2300, 'USD', 'en-US'), /\$/);
});
