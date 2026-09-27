import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getHowItWorksStory,
  getStoryRoleForUser,
  HOW_IT_WORKS_STORAGE_KEY,
  isHowItWorksRole,
  readRememberedStoryRole,
  rememberStoryRole,
  selectHowItWorksStory,
} from './howItWorksRoleModel.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('signed-out visitors default to customer and remember a valid role', () => {
  const store = storage();
  assert.equal(selectHowItWorksStory(null, null).role, 'customer');
  assert.equal(selectHowItWorksStory(null, null).source, 'default');
  assert.equal(rememberStoryRole('helper', store), true);
  assert.equal(store.getItem(HOW_IT_WORKS_STORAGE_KEY), 'helper');
  assert.equal(readRememberedStoryRole(store), 'helper');
  assert.equal(selectHowItWorksStory(null, readRememberedStoryRole(store)).role, 'helper');
  assert.equal(rememberStoryRole('not-a-role', store), false);
  assert.equal(isHowItWorksRole('business'), true);
  assert.equal(isHowItWorksRole('tool-owner'), false);
});

test('active launch modes select the correct public story', () => {
  assert.equal(getStoryRoleForUser({ default_mode: 'customer', role: 'customer' }), 'customer');
  assert.equal(getStoryRoleForUser({ default_mode: 'helper', role: 'helper' }), 'helper');
  for (const mode of ['business_owner', 'business_manager', 'business_representative', 'business_employee', 'business_support_agent']) {
    assert.equal(getStoryRoleForUser({ default_mode: mode, role: mode }), 'business', mode);
  }
  assert.equal(getStoryRoleForUser({ role: 'support_agent' }), 'business');
  assert.equal(selectHowItWorksStory({ default_mode: 'helper' }, 'business').source, 'active_mode');
  assert.equal(selectHowItWorksStory({ default_mode: 'helper' }, 'business').role, 'helper');
});

test('stories expose only current permitted destinations', () => {
  const disabledRoutes = ['/tool-rentals', '/products', '/consulting', '/templates', '/planned-needs'];
  for (const role of ['customer', 'helper', 'business']) {
    const story = getHowItWorksStory(null, role);
    const routes = [story.primary.to, story.secondary.to, ...story.cards.map((card) => card.to)];
    assert.equal(story.steps.length, 3);
    for (const route of routes) assert.equal(disabledRoutes.includes(route), false, `${role} exposed ${route}`);
  }
  const supportStory = getHowItWorksStory({ default_mode: 'business_support_agent' }, 'business');
  assert.equal(supportStory.primary.to, '/support/agent');
  assert.ok(supportStory.cards.some((card) => card.to === '/support/agent'));
});

