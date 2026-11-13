import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  new URL(
    '../src/admin/pages/super/oxsteedCredit/licence/ComplianceSection.jsx',
    import.meta.url,
  ),
  'utf8',
);

// Domain 1 audit 2026-11-10 finding 8 (remainder): the custom-sanctions-list
// fetch failure was silently swallowed because custom.error was missing from
// the Notices error chain. The LicenceTable error half is covered by the
// Mobile/PWA and Domain 7 branches; this test pins the Notices chain only.
test('ComplianceSection surfaces the custom sanctions fetch failure in Notices', () => {
  assert.match(
    source,
    /const custom = useLicenceGet\('\/sanctions\/custom'\)/,
    'custom sanctions list must still be fetched',
  );
  const notices = source.match(/<Notices[^/]*\/>/s);
  assert.ok(notices, 'ComplianceSection must render <Notices>');
  assert.match(
    notices[0],
    /custom\.error/,
    'Notices error chain must include custom.error',
  );
  assert.match(
    notices[0],
    /action\.error \|\| sources\.error \|\| custom\.error \|\| safeguarding\.error \|\| kyc\.error \|\| sar\.error/,
    'Notices error chain must keep every source error in order',
  );
});
