import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPERIENCE_AREA_KEYS,
  getExperienceArea,
  getExperienceAreaKeys,
  getExperienceGuide,
  getExperienceRole,
  experienceAreaTranslationKey,
  getRememberedExperienceRole,
  rememberExperienceRole,
} from './experienceGuideModel.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('the guide directory exposes every planned area', () => {
  assert.deepEqual(getExperienceAreaKeys(), EXPERIENCE_AREA_KEYS);
  assert.equal(EXPERIENCE_AREA_KEYS.length, 14);
  assert.equal(experienceAreaTranslationKey('restaurant-credit'), 'restaurantCredit');
  assert.equal(experienceAreaTranslationKey('get-started'), 'getStarted');
});

test('signed-out visitors default to customer and can remember a role per area', () => {
  const store = storage();
  assert.equal(getExperienceRole(null, 'food'), 'customer');
  assert.equal(rememberExperienceRole('food', 'restaurant', store), true);
  assert.equal(getRememberedExperienceRole('food', store), 'restaurant');
  assert.equal(getExperienceGuide('food', null, getRememberedExperienceRole('food', store)).role, 'restaurant');
});

test('active account modes select the correct supported story', () => {
  assert.equal(getExperienceRole({ default_mode: 'restaurant_staff' }, 'food'), 'kitchen');
  assert.equal(getExperienceRole({ default_mode: 'restaurant_manager' }, 'food'), 'restaurant');
  assert.equal(getExperienceRole({ default_mode: 'business_manager' }, 'business'), 'business');
  assert.equal(getExperienceRole({ role: 'support_agent' }, 'support'), 'support');
  assert.equal(getExperienceRole({ default_mode: 'helper' }, 'marketplace'), 'helper');
});

test('disabled areas never expose action cards', () => {
  const area = getExperienceArea('rentals');
  const guide = getExperienceGuide('rentals', null);
  assert.equal(area.enabled, false);
  assert.equal(guide.cards.length, 0);
  assert.equal(guide.primary, null);
});

test('enabled guide cards resolve only to existing product destinations', () => {
  const validRoutes = new Set([
    '/restaurants', '/orders', '/restaurant-credit', '/restaurants/merchant', '/help/kitchen', '/support',
    '/help/runner', '/oxsteed-credit', '/direct', '/direct/view-quote', '/direct/support', '/direct/history',
    '/post-job', '/helpers', '/messages', '/jobs', '/dashboard/edit-profile', '/calendar', '/business-hub',
    '/my-bookings', '/delivery', '/logistics', '/support/agent', '/support/agent/workspace', '/consulting-intake', '/join',
  ]);
  for (const areaKey of EXPERIENCE_AREA_KEYS) {
    const area = getExperienceArea(areaKey);
    if (!area.enabled) continue;
    for (const role of Object.keys(area.roles)) {
      const guide = getExperienceGuide(areaKey, null, role);
      for (const card of guide.cards) assert.equal(validRoutes.has(card.to), true, `${areaKey}/${role}/${card.key} -> ${card.to}`);
      assert.equal(validRoutes.has(guide.primary.to), true, `${areaKey}/${role}/primary -> ${guide.primary.to}`);
    }
  }
});
