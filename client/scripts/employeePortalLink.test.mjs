import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Money-flows W5: the employee portal route existed but had no in-app
// entry point anywhere, so it was reachable only by typing the URL.
// Contract: the merchant page links it from the in-store screens nav
// (alongside kitchen / queue / kiosk / inventory / runner / support)
// and from the My shift staff home every member gets, the link target
// matches the mounted route, and the label key exists in all five
// locales. Follows the source-contract pattern of
// adminAccessibilityContracts.test.mjs (rendering the full merchant
// page in a unit test is impractical: it mounts live order, finance
// and operations workspaces).
//
// Run from client/: node --test scripts/employeePortalLink.test.mjs

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');

test('merchant page links the employee portal from the in-store screens nav', () => {
  const merchant = read('src/pages/food/FoodMerchantPage.jsx');
  const nav = merchant.match(/fd-order-screen-links[\s\S]*?<\/nav>/);
  assert.ok(nav, 'in-store screens nav exists on the merchant page');
  assert.match(nav[0], /to=\{`\/restaurants\/\$\{restaurant\.id\}\/portal`\}/);
  assert.match(nav[0], /food\.merchant\.openEmployeePortal/);
  // The portal sits with the other screens, not after a permission gate
  // that only managers pass: the nav already carries kitchen/queue.
  assert.match(nav[0], /openKitchen/);
  assert.match(nav[0], /openRunner/);
});

test('My shift staff home links the employee portal for every member', () => {
  const myShift = read('src/pages/food/RestaurantMyShiftPanel.jsx');
  assert.match(myShift, /to=\{`\/restaurants\/\$\{restaurantId\}\/portal`\}/);
  assert.match(myShift, /food\.merchant\.openEmployeePortal/);
});

test('the portal link target matches the mounted route', () => {
  const app = read('src/App.jsx');
  assert.match(app, /path="\/restaurants\/:restaurantId\/portal"/);
});

test('the portal label exists in all five locales', () => {
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(read(`src/locales/${lang}.json`));
    assert.equal(
      typeof catalog?.food?.merchant?.openEmployeePortal,
      'string',
      `food.merchant.openEmployeePortal missing in ${lang}`
    );
    assert.notEqual(catalog.food.merchant.openEmployeePortal.length, 0);
  }
});
