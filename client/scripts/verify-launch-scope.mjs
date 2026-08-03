import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  LAUNCH_BUSINESS_WORKSPACE_TABS,
  LAUNCH_SELF_SELECTABLE_MODES,
  LAUNCH_SWITCHER_MODES,
  LAUNCH_VISIBILITY,
  launchRouteForMode,
} from '../src/utils/launchScope.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

assert.deepEqual(
  LAUNCH_SELF_SELECTABLE_MODES,
  ['customer', 'helper', 'business_owner'],
  'Only launch modes may be offered during signup',
);
assert.deepEqual(
  [...LAUNCH_SWITCHER_MODES],
  ['customer', 'helper', 'business_owner'],
  'Only launch modes may appear in the mode switcher',
);
assert.equal(launchRouteForMode('business_owner'), '/restaurants/merchant');
assert.equal(launchRouteForMode('investor'), '/dashboard');
assert.equal(launchRouteForMode('logistics'), '/dashboard');

for (const [flag, visible] of Object.entries(LAUNCH_VISIBILITY)) {
  assert.equal(visible, false, `${flag} must remain hidden for launch`);
}

assert.deepEqual(
  [...LAUNCH_BUSINESS_WORKSPACE_TABS],
  [
    'overview',
    'profile',
    'clients',
    'services',
    'gallery',
    'policies',
    'faqs',
    'skills',
    'messages',
    'calendar',
    'invoices',
    'team',
  ],
);

const [jobPublicPage, foodHomePage, navbar, helperDashboard] = await Promise.all([
  read('src/pages/JobPublicPage.tsx'),
  read('src/pages/food/FoodHomePage.jsx'),
  read('src/components/Navbar.jsx'),
  read('src/pages/HelperDashboard.jsx'),
]);

assert.doesNotMatch(jobPublicPage, /to="\/discover"/, 'Jobs must not link to Discover Everything');
assert.match(foodHomePage, /LAUNCH_VISIBILITY\.restaurantMerchantPublicEntry/);
assert.match(navbar, /LAUNCH_VISIBILITY\.supportWorkspaceEntry/);
assert.match(helperDashboard, /SHOW_LEGACY_HELPER_LIFE_TABS && <HelperOffersCard \/>/);

console.log('Launch-scope policy verified.');
