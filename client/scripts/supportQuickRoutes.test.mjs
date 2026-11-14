import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  new URL('../src/admin/pages/SupportTickets.jsx', import.meta.url),
  'utf8',
);

// Domain 1 audit 2026-11-10 finding 19: SUPPORT_TOOLS defines the full
// support-tool list but both quick-routes panels sliced it to 6.
test('support inbox quick routes render the full SUPPORT_TOOLS list at both sites', () => {
  assert.doesNotMatch(
    source,
    /SUPPORT_TOOLS\.slice\(/,
    'no quick-routes panel may slice SUPPORT_TOOLS',
  );
  const tools = [...source.matchAll(/to: '\/admin\/support\/[^']+'/g)];
  assert.ok(tools.length >= 14, `expected all support tools, found ${tools.length}`);
  assert.equal(
    new Set(tools.map(([to]) => to)).size,
    tools.length,
    'support tool destinations must be unique',
  );
  // One shared render keeps the two panels from drifting apart again.
  assert.match(source, /function SupportToolLinks\(/);
  const uses = [...source.matchAll(/<SupportToolLinks /g)];
  assert.equal(uses.length, 2, 'shared quick-routes render must be used at both sites');
  const shared = source.slice(source.indexOf('function SupportToolLinks('));
  assert.match(shared, /SUPPORT_TOOLS\.map\(/, 'shared render must map the full list');
});
