import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('public and admin entries use cache-versioned bootstrap recovery', () => {
  for (const relativePath of ['src/main.jsx', 'src/admin/main.jsx']) {
    const source = read(relativePath);
    assert.match(source, /registerServiceWorker/);
    assert.match(source, /recoverFromBootstrapFailure/);
    assert.doesNotMatch(source, /i18nReady\.then\([^\n]+\)\.catch\(render/);
  }
});

test('bootstrap failures never render an uninitialized admin shell', () => {
  const source = read('src/admin/main.jsx');
  assert.match(source, /i18nReady\.then\(\(\) => \{/);
  assert.match(source, /renderAdminBootstrapFailure/);
  assert.match(source, /window\.location\.reload\(\)/);
});

test('service worker uses a network-first static asset strategy', () => {
  const source = read('public/sw.js');
  assert.match(source, /network-first/);
  assert.match(source, /event\.respondWith\(networkFirst\(request, STATIC_CACHE\)\)/);
});

test('admin English fallback reassembles split shards instead of a monolithic catalog', () => {
  const i18nSource = read('src/i18n/index.js');
  const adminSource = read('src/admin/main.jsx');
  assert.match(i18nSource, /export function initializeEnglishFallback/);
  const fallbackFn = i18nSource.slice(i18nSource.indexOf('export function initializeEnglishFallback'));
  for (const shard of ['en-0', 'en-1', 'en-2']) {
    assert.match(fallbackFn, new RegExp(`locales/generated/${shard}\\.json`));
  }
  assert.doesNotMatch(i18nSource, /locales\/en\.json/);
  assert.match(fallbackFn, /English fallback resources unavailable/);
  assert.match(adminSource, /initializeEnglishFallback/);
  assert.match(adminSource, /renderAdminBootstrapFailure/);
});
