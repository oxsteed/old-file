'use strict';

const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('progressive access cart and checkout boundary (WP-040)', () => {
  test('checkout revalidates active availability before pricing or payment', () => {
    const source = read('controllers/cartCheckoutController.js');
    expect(source).toMatch(/mp\.is_active, mp\.is_available/);
    expect(source).toMatch(/cart_item_unavailable/);
    expect(source).toMatch(/item\.is_active !== true \|\| item\.is_available !== true/);
  });

  test('payment context is bound to the checkout route and buyer cart', () => {
    const source = read('controllers/cartCheckoutController.js');
    expect(source).toMatch(/Cart ID does not match the checkout route/);
    expect(source).toMatch(/cart_id::text = \$3::text/);
    expect(source).toMatch(/customer_id = \$2/);
  });

  test('named shared carts do not disclose contents to unrelated link holders', () => {
    const source = read('controllers/sharedCartsController.js');
    expect(source).toMatch(/if \(!mayActOnSharedCart\(sharedCart, req\.user\?\.id\)\)/);
    expect(source).toMatch(/shared_cart_customer_mismatch/);
    expect(source).toMatch(/mp\.is_active = TRUE AND mp\.is_available = TRUE/);
  });

  test('shared-cart approval retries are serialized and replay the existing approval', () => {
    const source = read('controllers/sharedCartsController.js');
    expect(source).toMatch(/marketplace-cart-approval:/);
    expect(source).toMatch(/pg_advisory_xact_lock/);
    expect(source).toMatch(/status === 'approved'/);
    expect(source).toMatch(/replayed: true/);
  });

  test('cart and shared-cart writes bind product publication state at insertion time', () => {
    const carts = read('controllers/shoppingCartsController.js');
    const shared = read('controllers/sharedCartsController.js');
    expect(carts).toMatch(/is_active = TRUE AND is_available = TRUE/);
    expect(shared).toMatch(/mp\.is_active = TRUE AND mp\.is_available = TRUE/);
  });
});
