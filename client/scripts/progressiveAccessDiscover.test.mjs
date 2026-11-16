import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'src/pages/DiscoverPage.jsx'), 'utf8');

test('discover requests ignore late responses after a location or query change', () => {
  assert.match(source, /const requestGeneration = useRef\(0\)/);
  assert.match(source, /const generation = \+\+requestGeneration\.current/);
  assert.match(source, /if \(generation !== requestGeneration\.current\) return;/);
  assert.match(source, /if \(generation === requestGeneration\.current\) setLoading\(false\)/);
  assert.match(source, /if \(generation === requestGeneration\.current\) setPopularLoading\(false\)/);
});

test('discover links preserve explicit location and result scope', () => {
  assert.match(source, /\(term, nextRadius = radius\)/);
  assert.match(source, /params\.set\('lat', lat\)/);
  assert.match(source, /params\.set\('lng', lng\)/);
  assert.match(source, /params\.set\('city', city\)/);
  assert.match(source, /params\.set\('state', state\)/);
  assert.match(source, /to=\{buildDiscoverHref\(term\)\}/);
  assert.match(source, /to=\{buildDiscoverHref\(a\.query, a\.radius_miles\)\}/);
});
