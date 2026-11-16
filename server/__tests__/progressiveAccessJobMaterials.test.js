'use strict';

const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('progressive access job-materials boundary (WP-041)', () => {
  test('job-linked material carts bind the job to an actual party', () => {
    const source = read('services/jobKitService.js');
    expect(source).toMatch(/client_id = \$2 OR assigned_helper_id = \$2 OR broker_id = \$2/);
    expect(source).toMatch(/deleted_at IS NULL/);
    expect(source).toMatch(/job_not_found/);
  });

  test('job-material product resolution only uses published catalog rows', () => {
    const source = read('services/jobKitService.js');
    expect(source).toMatch(/is_active = TRUE/);
    expect(source).toMatch(/is_available = TRUE/);
    expect(source).toMatch(/kit_products_unpriced/);
  });

  test('the route remains authenticated and does not trust caller-supplied prices', () => {
    const route = read('routes/jobKits.js');
    const source = read('services/jobKitService.js');
    expect(route).toMatch(/router\.use\(authenticate\)/);
    expect(source).toMatch(/ALWAYS re-read from marketplace_products/);
    expect(source).toMatch(/product\.price_cents/);
  });
});
