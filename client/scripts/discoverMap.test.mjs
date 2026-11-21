import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(dir, '..', 'src', 'pages', 'DiscoverPage.jsx'), 'utf8');
const locales = ['en', 'es', 'fr', 'ht', 'ar'].map((locale) =>
  JSON.parse(readFileSync(path.join(dir, '..', 'src', 'locales', `${locale}.json`), 'utf8')),
);

// Group 1, item 2: map search on Discover. The map engine stays out of the
// main chunk until the customer opens the map, pins come only from rows
// that carry coordinates, and every pin links to the list row's destination.
test('Discover lazy-loads the map instead of bundling MapLibre into the page', () => {
  assert.match(src, /lazy\(\(\) => import\('\.\.\/components\/AwsLocationMap'\)\)/);
  assert.doesNotMatch(src, /import AwsLocationMap from/);
  assert.match(src, /<Suspense[^>]*>/);
  assert.match(src, /<AwsLocationMap/);
});

test('map pins come only from rows with coordinates and link to the list destination', () => {
  assert.match(src, /filter\(\(r\) => r\.lat != null && r\.lng != null\)/);
  assert.match(src, /map\(\(r\) => \(\{\s*lat: r\.lat,\s*lng: r\.lng,\s*display_name: r\.title,\s*href: r\.url\s*\}\)\)/);
});

test('the map toggle and the empty note use localized strings', () => {
  assert.match(src, /discover\.showMap/);
  assert.match(src, /discover\.hideMap/);
  assert.match(src, /discover\.mapEmpty/);
  for (const locale of locales) {
    assert.equal(typeof locale.discover.showMap, 'string');
    assert.equal(typeof locale.discover.hideMap, 'string');
    assert.equal(typeof locale.discover.mapEmpty, 'string');
  }
});

test('the map toggle is tracked for growth instrumentation', () => {
  assert.match(src, /data-track="ui\.1fbc0342b4\.4"/);
});
