import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const approvedCopy = 'Need help within 60 miles of Springfield, Ohio? Request a quote.';
const directPage = await readFile(new URL('../src/pages/DirectPortalPage.jsx', import.meta.url), 'utf8');
const directController = await readFile(new URL('../../server/controllers/directController.js', import.meta.url), 'utf8');

test('OxSteed Direct presents the approved 60-mile service area', () => {
  assert.ok(directPage.split(approvedCopy).length >= 3, 'Direct landing and quote pages must include the approved copy');
  assert.match(directController, new RegExp(approvedCopy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(directPage, /profile\.travelCities\s*\|\|/);
});
