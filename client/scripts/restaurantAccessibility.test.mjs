import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pageSource = await readFile(new URL('../src/pages/food/FoodHomePage.jsx', import.meta.url), 'utf8');
const suggestSource = await readFile(new URL('../src/components/SuggestDropdown.jsx', import.meta.url), 'utf8');

test('keeps the Restaurants discovery controls keyboard and screen-reader addressable', () => {
  // The discovery search runs through the shared SuggestDropdown combobox;
  // the page must pass it a localized accessible label.
  assert.match(pageSource, /<SuggestDropdown[\s\S]*?ariaLabel=\{t\('/);
  // The shared component keeps the type="search" + aria-label contract on
  // its input, with combobox/listbox/option roles for the popup.
  assert.match(suggestSource, /type="search"[\s\S]*?aria-label=\{ariaLabel/);
  assert.match(suggestSource, /role="combobox"/);
  assert.match(suggestSource, /role="listbox"/);
  assert.match(pageSource, /aria-pressed=\{isActive\}/);
  assert.match(pageSource, /aria-expanded=\{showMap\}/);
  assert.match(pageSource, /className="fd-discovery-toolbar" aria-label=\{t\(/);
  assert.match(pageSource, /className="fd-discovery-summary" aria-live="polite"/);
  assert.match(pageSource, /className="fd-discovery-load-error" role="alert"/);
  assert.match(pageSource, /disabled=\{loadingMore\}/);
});
