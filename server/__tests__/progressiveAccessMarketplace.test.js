'use strict';

const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('progressive access marketplace catalog boundary (WP-039)', () => {
  test('business product publication is approval-aware while catalog writes stay scoped', () => {
    const source = read('routes/businessProducts.js');
    expect(source).toMatch(/requireBusinessAccess\(\{ minRole: 'manager' \}\)/);
    expect(source).toMatch(/businessEnforcement\(\)/);
    expect(source).toMatch(/checkPublish/);
    expect(source).toMatch(/sendError\(res, 403,[\s\S]*'access_required'/);
  });

  test('helper product mutations still require the helper capability', () => {
    const source = read('routes/helperProducts.js');
    expect(source).toMatch(/router\.post\('\/', authenticate, requireHelperCapability/);
    expect(source).toMatch(/router\.patch\('\/:id', authenticate, requireHelperCapability/);
    expect(source).toMatch(/router\.delete\('\/:id', authenticate, requireHelperCapability/);
  });

  test('public marketplace reads hide inactive or unavailable products', () => {
    const source = read('controllers/marketplaceProductsController.js');
    expect(source).toMatch(/mp\.is_active = TRUE\s+AND mp\.is_available = TRUE/);
    expect(source).toMatch(/WHERE mp\.id = \$1[\s\S]*mp\.is_active = TRUE[\s\S]*mp\.is_available = TRUE/);
  });
});
