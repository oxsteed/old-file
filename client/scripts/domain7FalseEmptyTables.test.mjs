// Domain 7 #13: credit pages must never show a false-empty table while a
// load is in flight or after a failed load. Settlements, Compliance and every
// licence tab gate their empty text on loading (and on error).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(clientRoot, rel), 'utf8');

const licenceDir = 'src/admin/pages/super/oxsteedCredit/licence';
const licenceSections = fs.readdirSync(path.join(clientRoot, licenceDir))
  .filter((f) => f.endsWith('Section.jsx'))
  .map((f) => `${licenceDir}/${f}`);

// The sanctions-search matches table in ComplianceSection is the one exempt
// call site: it renders only after a search completes (matches !== null), so
// no in-flight fetch can make it show a false empty.
const EXEMPT_TABLE = { file: `${licenceDir}/ComplianceSection.jsx`, rows: 'matches.map' };

function licenceTableTags(source) {
  return [...source.matchAll(/<LicenceTable[\s\S]*?\/>/g)].map((m) => m[0]);
}

test('LicenceTable takes loading and error props and never shows the empty text while loading or on error', () => {
  const src = read(`${licenceDir}/licenceShared.jsx`);
  // Union with Nov 10 #1: LicenceTable also takes an optional onRetry prop,
  // and the loading/error branches only fire while no rows are on screen
  // (rows survive a background reload). The order asserted here, loading
  // then error then empty, is unchanged.
  assert.match(src, /export function LicenceTable\(\{\s*rows, columns, actions, empty, loading, error(?:,\s*onRetry)?\s*\}\)/);
  assert.match(src, /if \(loading/);
  assert.match(src, /if \(error/);
  // The loading branch must come before the empty branch, and the empty
  // branch must only render once neither loading nor error applies.
  const loadingAt = src.indexOf('if (loading');
  const errorAt = src.indexOf('if (error');
  const emptyAt = src.indexOf("t('adminLicence.empty')");
  assert.ok(loadingAt > 0 && errorAt > loadingAt && emptyAt > errorAt,
    'LicenceTable must check loading, then error, then empty, in that order');
  assert.match(src, /role="status"/);
  assert.match(src, /role="alert"/);
});

test('every LicenceTable call site passes its getter loading state', () => {
  for (const rel of licenceSections) {
    const src = read(rel);
    const tags = licenceTableTags(src);
    assert.ok(tags.length > 0, `${rel}: no LicenceTable usage found`);
    for (const tag of tags) {
      if (rel === EXEMPT_TABLE.file && tag.includes(EXEMPT_TABLE.rows)) continue;
      assert.match(tag, /loading=\{[^}]*\.loading\}/, `${rel}: LicenceTable without a loading prop:\n${tag}`);
    }
  }
});

test('every LicenceTable call site passes its getter error state', () => {
  for (const rel of licenceSections) {
    const src = read(rel);
    const tags = licenceTableTags(src);
    for (const tag of tags) {
      if (rel === EXEMPT_TABLE.file && tag.includes(EXEMPT_TABLE.rows)) continue;
      assert.match(tag, /error=\{[^}]*\.error\}/, `${rel}: LicenceTable without an error prop:\n${tag}`);
    }
  }
});

test('Settlements table shows a loading row while loading and an error row on failure, never the empty text', () => {
  const src = read('src/admin/pages/super/oxsteedCredit/SettlementsPage.jsx');
  assert.match(src, /<SettlementControls[\s\S]*?loading=\{loading\}[\s\S]*?error=\{error\}/,
    'SettlementControls must receive the page loading and error state');
  assert.match(src, /function SettlementControls\(\{[\s\S]*?loading,[\s\S]*?error,[\s\S]*?\}\)/,
    'SettlementControls must accept loading and error props');
  const tbody = src.slice(src.indexOf('<tbody className="divide-y'));
  assert.match(tbody, /loading \?/);
  assert.match(tbody, /error \?/);
  // The empty row renders only once loading is false and there is no error.
  assert.match(tbody, /!loading && !error && !settlements\.length/);
});

test('Compliance queue tables show a loading row while loading and an error row on failure, never the empty text', () => {
  const src = read('src/admin/pages/super/oxsteedCredit/CompliancePage.jsx');
  assert.match(src, /<ComplianceQueue[\s\S]*?loading=\{loading\}[\s\S]*?error=\{queueError\}/,
    'ComplianceQueue must receive the page loading flag and queue error');
  assert.match(src, /function ComplianceQueue\(\{\s*queue, busy, decideCompliance,[\s\S]*?loading, error\s*\}\)/,
    'ComplianceQueue must accept loading and error props (plus the per-list pager props from Domain 7 #12)');
  for (const emptyKey of ['adminComplianceNoVerifications', 'adminComplianceNoSanctions', 'adminComplianceNoCases']) {
    const at = src.indexOf(emptyKey);
    assert.ok(at > 0, `missing ${emptyKey}`);
    const before = src.slice(Math.max(0, at - 400), at);
    assert.match(before, /!loading && !error/, `${emptyKey} must be gated on !loading && !error`);
  }
});
