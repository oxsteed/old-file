import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pageSource = await readFile(new URL('../src/pages/food/FoodHomePage.jsx', import.meta.url), 'utf8');

test('keeps the Restaurants discovery controls keyboard and screen-reader addressable', () => {
  assert.match(pageSource, /type="search"[\s\S]*aria-label=\{t\('/);
  assert.match(pageSource, /aria-pressed=\{isActive\}/);
  assert.match(pageSource, /aria-expanded=\{showMap\}/);
  assert.match(pageSource, /className="fd-discovery-toolbar" aria-label=\{t\(/);
  assert.match(pageSource, /className="fd-discovery-summary" aria-live="polite"/);
  assert.match(pageSource, /className="fd-discovery-load-error" role="alert"/);
  assert.match(pageSource, /disabled=\{loadingMore\}/);
});
