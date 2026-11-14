// Domain 7 #24: eligible partners truncate at 50 with no way to see the
// rest, and audit events slice at 20 with no total. Add a load-more for
// partners (the endpoint supports offset paging) and an expander for audit
// events that shows the fetched total.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(
  path.join(clientRoot, 'src/admin/pages/super/OxsteedCreditCustomerDetail.jsx'), 'utf8');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(clientRoot, rel), 'utf8'));

test('eligible partners have a load-more that pages by the server offset', () => {
  assert.match(src, /const loadMorePartners = async \(\) => \{/);
  assert.match(src, /offset: eligiblePartnerPagination\.nextOffset/);
  assert.match(src, /eligiblePartners: \[\.\.\.\(current\.eligiblePartners \|\| \[\]\), \.\.\.\(response\.data\?\.partners \|\| \[\]\)\]/);
  assert.match(src, /eligiblePartnerPagination: response\.data\?\.pagination/);
});

test('the load-more button renders only while more partners exist, with a loading state', () => {
  assert.match(src, /\{eligiblePartnerPagination\?\.hasMore && <div/);
  assert.match(src, /onClick=\{loadMorePartners\}/);
  assert.match(src, /loadingMorePartners \? t\('adminLoading'\) : t\('adminLoadMorePartners'\)/);
});

test('audit events expand past the first 20 with a total', () => {
  assert.match(src, /const \[showAllAuditEvents, setShowAllAuditEvents\] = useState\(false\)/);
  assert.match(src, /auditEvents\.slice\(0, showAllAuditEvents \? undefined : 20\)/);
  assert.match(src, /t\('adminShowAllAuditEvents', \{ count: auditEvents\.length \}\)/);
  assert.match(src, /t\('adminShowFewerAuditEvents'\)/);
});

test('the audit expander keys exist in all five credit catalogs with count parity', () => {
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = readJson(`src/i18n/locales/${lang}/credit.json`);
    const showAll = catalog.adminShowAllAuditEvents;
    assert.ok(typeof showAll === 'string' && showAll.length > 0, `${lang}: missing adminShowAllAuditEvents`);
    assert.match(showAll, /\{\{count\}\}/, `${lang}: adminShowAllAuditEvents must interpolate {{count}}`);
    assert.ok(typeof catalog.adminShowFewerAuditEvents === 'string' && catalog.adminShowFewerAuditEvents.length > 0,
      `${lang}: missing adminShowFewerAuditEvents`);
  }
});

test('the eligible-partners endpoint really supports offset paging', () => {
  const server = fs.readFileSync(
    path.resolve(clientRoot, '../server/controllers/oxsteedCreditController.js'), 'utf8');
  const fn = server.slice(server.indexOf('async function getAdminCustomerEligiblePartners'));
  assert.match(fn, /offset: req\.query\.offset/);
  assert.match(fn, /includePagination: true/);
});
