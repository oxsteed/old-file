import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Money-flows W6: three notification types shipped with no preference
// toggle in the UI. Background-jobs audit #51 already closed the gap
// (toggles in NotificationPreferences.jsx, DB columns in migration
// 20261110005800, the server allow-list in notificationController.js,
// and the prefAllows aliases in notificationService.js); the
// toggle-blocks-the-notification behavior is covered server-side by
// the #51 tests in server/__tests__/notificationPreferenceWiring.test.js.
// This contract test guards the UI half, which had no test: the three
// types must stay present as toggles in the preferences UI, with a
// label in all five locales.
//
// Run from client/: node --test scripts/restaurantNotificationToggles.test.mjs

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');

// The three W6 types and the UI toggle key each one is gated by.
const TOGGLES = [
  ['staff_time_entry_system_closed', 'in_app_staff_time_entry_system_closed'],
  ['restaurant_temperature_breach', 'in_app_restaurant_temperature_breach'],
  ['restaurant_scheduled_report', 'in_app_restaurant_scheduled_report'],
];

test('the three restaurant alert types appear as toggles in the preferences UI', () => {
  const prefs = read('src/components/NotificationPreferences.jsx');
  for (const [type, key] of TOGGLES) {
    assert.match(prefs, new RegExp(`notifications\\.prefs\\.${key}`), `${type} has a label entry`);
    assert.ok(prefs.includes(`'${key}'`), `${type} toggle key is listed`);
  }
  // All three sit in the restaurant section, not lost among the
  // marketplace toggles.
  const restaurantSection = prefs.match(/key: 'restaurant'[\s\S]*?keys: \[([\s\S]*?)\]/);
  assert.ok(restaurantSection, 'restaurant preferences section exists');
  for (const [, key] of TOGGLES) {
    assert.ok(restaurantSection[1].includes(`'${key}'`), `${key} is in the restaurant section`);
  }
});

test('each toggle label exists in all five locales', () => {
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(read(`src/locales/${lang}.json`));
    for (const [, key] of TOGGLES) {
      assert.equal(
        typeof catalog?.notifications?.prefs?.[key],
        'string',
        `notifications.prefs.${key} missing in ${lang}`
      );
    }
  }
});
