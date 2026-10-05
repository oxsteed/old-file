'use strict';

// Regression test for OXSTEED-BACKEND-32:
// GET /api/chat/quotes/guest-history crashed with
// "column hp.display_name does not exist" because helper_profiles has no
// display_name column. The helper quote queries had the same bug plus a
// hp.average_rating reference (the column is avg_rating).

jest.mock('../db', () => ({ query: jest.fn() }));

const db = require('../db');

const VALID_HELPER_PROFILE_COLUMNS = new Set([
  'id', 'user_id', 'tier',
  'bio_short', 'bio_long', 'profile_photo_url',
  'service_city', 'service_state', 'service_zip', 'service_radius_miles',
  'service_lat', 'service_lng', 'service_location',
  'hourly_rate_min', 'hourly_rate_max', 'flat_rate_available', 'contact_for_pricing',
  'avg_rating', 'total_reviews', 'completed_jobs_count', 'response_time_hours',
  'is_background_checked', 'is_identity_verified', 'is_insured', 'is_licensed',
  'insurance_details', 'license_details',
  'availability_json', 'is_available_now',
  'stripe_account_id', 'stripe_charges_enabled', 'stripe_payouts_enabled',
  'stripe_onboarded_at',
]);

function extractHpColumns(sql) {
  const cols = [];
  const re = /\bhp\.([a-z_]+)/g;
  let m;
  while ((m = re.exec(sql)) !== null) cols.push(m[1]);
  return cols;
}

function collectSqlFromModule(path) {
  const fs = require('fs');
  return fs.readFileSync(path, 'utf8');
}

test('chatQuotesController guest-history query references only real helper_profiles columns', () => {
  const src = collectSqlFromModule(require.resolve('../controllers/chatQuotesController.js'));
  // Find the listGuestHistory query block.
  const start = src.indexOf('exports.listGuestHistory');
  const block = src.slice(start, start + 2000);
  for (const col of extractHpColumns(block)) {
    expect(VALID_HELPER_PROFILE_COLUMNS.has(col)).toBe(true);
  }
  expect(block).not.toContain('hp.display_name');
});

test('helperQuotes routes reference only real helper_profiles columns', () => {
  const src = collectSqlFromModule(require.resolve('../routes/helperQuotes.js'));
  for (const col of extractHpColumns(src)) {
    expect(VALID_HELPER_PROFILE_COLUMNS.has(col)).toBe(true);
  }
  expect(src).not.toContain('hp.display_name');
  expect(src).not.toContain('hp.average_rating');
});
