import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DIRECT_CATALOG_VIEWS,
  directCatalogHref,
  directSkillIdForCategory,
} from './directCatalogNavigation.js';

test('catalog links use separate canonical destinations', () => {
  assert.equal(directCatalogHref('skills', { categorySlug: 'Electrical' }), '/direct/skills?skill=electrical');
  assert.equal(directCatalogHref('services', { categorySlug: 'Electrical' }), '/direct/services?category=electrical');
  assert.equal(directCatalogHref('tools', { categorySlug: 'Electrical' }), '/direct/tools?category=electrical');
});

test('category-to-skill mapping uses stable ids', () => {
  assert.equal(directSkillIdForCategory('home-repair'), 'home-repair');
  assert.equal(directSkillIdForCategory('translated-display-name'), '');
  assert.equal(DIRECT_CATALOG_VIEWS.tools.path, '/direct/tools');
});

test('route contract is registered in the application and landing links use it', () => {
  const appSource = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8');
  const landingSource = fs.readFileSync(path.resolve('src/pages/DirectCatalogLanding.jsx'), 'utf8');
  assert.match(appSource, /path="\/direct\/skills"/);
  assert.match(appSource, /path="\/direct\/services"\s+element=\{<Guarded><DirectCatalogDirectoryPage view="services"/);
  assert.match(appSource, /path="\/direct\/tools"\s+element=\{<Guarded><DirectCatalogDirectoryPage view="tools"/);
  assert.equal((landingSource.match(/directCatalogHref\('skills'/g) || []).length, 1);
  assert.equal((landingSource.match(/directCatalogHref\('services'/g) || []).length, 1);
  assert.equal((landingSource.match(/directCatalogHref\('tools'/g) || []).length, 1);
});
