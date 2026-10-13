import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('P1-223: helper search typeahead queries /helpers/skills', () => {
  const src = read('components/helperDirectory/SearchBar.tsx');
  assert.match(src, /api\.get\('\/helpers\/skills'/);
  assert.match(src, /remoteSkills/);
});

test('P1-224: restaurant typeahead looks up names server-side', () => {
  const src = read('pages/food/FoodHomePage.jsx');
  assert.match(src, /listFoodRestaurantsPage\(\{ q: term/);
  assert.match(src, /\[\.\.\.remoteSuggest, \.\.\.restaurants\]/);
});

test('P1-237: dead food payment wrapper is removed', () => {
  assert.doesNotMatch(read('api/food.js'), /updateFoodOrderPayment/);
});

test('P1-248: settlements with a payout in flight hide mark-paid/void', () => {
  const src = read('admin/pages/super/oxsteedCredit/SettlementsPage.jsx');
  assert.equal((src.match(/!\['initiated', 'paid'\]\.includes\(settlement\.payoutStatus\)/g) || []).length, 2);
});
