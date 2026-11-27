import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SYNONYM_GROUPS, expandSearchTerms, normalizeQuery } from '../src/utils/discoverTermExpansion.js';
import { searchItems, typoScore, levenshteinBounded } from '../src/utils/paletteSearch.js';

const item = (id, extra = {}) => ({
  id, path: `/${id}`, label: id, keywords: id, group: 'pages', ...extra,
});

// Palette item 5 (D-725): the client's synonym groups must stay identical
// to the server's, because the server is the source of truth for ranking.
test('parity: client SYNONYM_GROUPS match server discoverController.js', async () => {
  const server = await readFile(
    new URL('../../server/controllers/discoverController.js', import.meta.url),
    'utf8',
  );
  const match = server.match(/const SYNONYM_GROUPS = (\[[\s\S]*?\n\]);/);
  assert.ok(match, 'server SYNONYM_GROUPS literal not found');
  // The server literal has a trailing comma after the last group, which
  // JSON does not allow; strip it before parsing.
  const serverGroups = JSON.parse(match[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  assert.deepEqual(SYNONYM_GROUPS, serverGroups);
});

test('expandSearchTerms mirrors the server algorithm', () => {
  assert.deepEqual(expandSearchTerms('plumber'), ['plumber', 'plumbing', 'pipes', 'drain']);
  assert.ok(expandSearchTerms('hvac').includes('air conditioning'));
  assert.ok(expandSearchTerms('hvac').includes('furnace'));
  assert.deepEqual(expandSearchTerms(''), []);
  assert.deepEqual(expandSearchTerms('xyzqq'), ['xyzqq']);
  assert.equal(normalizeQuery('  a   b  '), 'a b');
  assert.ok(expandSearchTerms('plumber').length <= 12);
});

test('levenshteinBounded bails out past the bound', () => {
  assert.equal(levenshteinBounded('plumber', 'plumber', 2), 0);
  assert.equal(levenshteinBounded('plubmer', 'plumber', 2), 2);
  assert.equal(levenshteinBounded('plubmer', 'plumber', 1), 2);
  assert.equal(levenshteinBounded('xyz', 'plumber', 2), 3);
});

test('typoScore catches transposed or wrong letters, rejects far-off words', () => {
  assert.ok(typoScore('plubmer', 'Plumber plumbing') >= 0);
  assert.ok(typoScore('weldnig', 'Welding metalwork') >= 0);
  assert.equal(typoScore('xyzqq', 'Plumber plumbing'), -1);
  // A prefix is the subsequence score's job, not the typo score's:
  // 'plum' is 3 edits from 'plumber', past the 1-edit bound for short words.
  assert.equal(typoScore('plum', 'Plumber plumbing'), -1);
});

test('searchItems finds a transposed typo the subsequence score misses', () => {
  const items = [item('page:plumber', { label: 'Plumber', keywords: 'plumbing pipes' })];
  assert.deepEqual(searchItems(items, 'plubmer').map((i) => i.id), ['page:plumber']);
  assert.deepEqual(searchItems(items, 'xyzqq'), []);
});

test('searchItems surfaces a synonym hit below a direct hit', () => {
  const items = [
    item('page:housekeeping', { label: 'Housekeeping', keywords: 'cleaning maid' }),
    item('page:cleaning', { label: 'Cleaning', keywords: 'clean maid' }),
  ];
  const ranked = searchItems(items, 'maid');
  assert.equal(ranked.length, 2);
  // Both match directly here; the synonym path is exercised below.
  const synonymOnly = [
    item('page:housekeeping', { label: 'Housekeeping', keywords: '' }),
    item('page:maid-service', { label: 'Maid service', keywords: '' }),
  ];
  const rankedSynonym = searchItems(synonymOnly, 'maid');
  assert.deepEqual(rankedSynonym.map((i) => i.id), ['page:maid-service', 'page:housekeeping']);
});

test('searchItems surfaces a trade synonym with no shared word', () => {
  const items = [item('page:drain', { label: 'Drain cleaning', keywords: '' })];
  assert.deepEqual(searchItems(items, 'plumber').map((i) => i.id), ['page:drain']);
});
