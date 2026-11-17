import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (rel) => readFile(new URL(rel, root), 'utf8');

const PAGES = [
  'src/pages/invest/InvestDirectoryPage.jsx',
  'src/pages/invest/InvestOpportunityPage.jsx',
  'src/pages/invest/InvestApplicationPage.jsx',
  'src/pages/invest/InvestCommitPage.jsx',
  'src/pages/invest/InvestMyInvestmentsPage.jsx',
];

test('invest routes are registered in App.jsx', async () => {
  const app = await read('src/App.jsx');
  for (const route of ['/invest"', '/invest/opportunities/:id"', '/invest/opportunities/:id/commit"', '/invest/apply"', '/invest/my-investments"']) {
    assert.match(app, new RegExp(`path="${route.replace(/"/g, '')}"`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), route);
  }
  for (const page of ['InvestDirectoryPage', 'InvestOpportunityPage', 'InvestApplicationPage', 'InvestCommitPage', 'InvestMyInvestmentsPage']) {
    assert.match(app, new RegExp(`import\\('./pages/invest/${page}'\\)`), page);
  }
});

test('commit button copy is exactly "Confirm investment commitment" and no page says "Buy now"', async () => {
  const en = JSON.parse(await read('src/locales/en.json'));
  assert.equal(en.invest.commit.confirmButton, 'Confirm investment commitment');
  for (const page of PAGES) {
    const src = await read(page);
    assert.doesNotMatch(src, /Buy now/i, page);
  }
  assert.doesNotMatch(JSON.stringify(en.invest), /Buy now/i);
});

test('directory uses neutral sort only and never ranks or scores', async () => {
  const src = await read('src/pages/invest/InvestDirectoryPage.jsx');
  assert.match(src, /publication_date/);
  assert.match(src, /closing_date/);
  assert.doesNotMatch(src, /\.score|score:|rank:/, 'no score or rank field');
  assert.doesNotMatch(src, /best investment/i);
  // Progress is computed from the API's reserved (pending) and completed
  // totals; the "pending commitments" wording itself lives in the locale
  // catalog (invest.directory.card.committed).
  assert.match(src, /opportunity\.reservedCents/);
  assert.match(src, /opportunity\.completedCents/);
  assert.match(src, /invest\.directory\.card\.committed/);
});

test('detail renders provenance and the verification note, and never promises a return', async () => {
  const src = await read('src/pages/invest/InvestOpportunityPage.jsx');
  assert.match(src, /provenanceLabelKey/);
  assert.match(src, /verification\.note/);
  assert.match(src, /verification\.verifiedItems/);
  assert.doesNotMatch(src, /guaranteed return/i);
  assert.match(src, /riskNotice/);
});

test('application keeps its five sections separate and never redirects the applicant away', async () => {
  const src = await read('src/pages/invest/InvestApplicationPage.jsx');
  for (const key of [
    'invest.application.sections.identity.title',
    'invest.application.sections.eligibility.title',
    'invest.application.sections.requirements.title',
    'invest.application.sections.documents.title',
    'invest.application.sections.agreement.title',
  ]) {
    assert.ok(src.includes(key), key);
  }
  assert.doesNotMatch(src, /useNavigate|navigate\(|window\.location/);
  assert.match(src, /noBlockNotice/);
  assert.match(src, /acceptAgreement/);
});

test('commit review screen shows every required row before confirmation', async () => {
  const src = await read('src/pages/invest/InvestCommitPage.jsx');
  for (const marker of [
    'invest.commit.review.amount',
    'invest.commit.review.valuationRule',
    'invest.commit.review.fees',
    'invest.commit.review.rights',
    'invest.commit.review.statusNote',
    'invest.commit.review.cancellationTerms',
    'invest.commit.review.riskNote',
    'invest.commit.review.agreementVersion',
    'commitReviewMissingRows',
    'invest.commit.gateOff',
  ]) {
    assert.ok(src.includes(marker), marker);
  }
  assert.match(src, /fees: \[\]/, 'empty fee list, never an invented fee');
});

test('my investments has every section and never shows a market value', async () => {
  const src = await read('src/pages/invest/InvestMyInvestmentsPage.jsx');
  for (const key of [
    'invest.my.pending.title',
    'invest.my.completed.title',
    'invest.my.cancelled.title',
    'invest.my.applications.title',
    'invest.my.updates.title',
    'invest.my.distributions.title',
    'invest.my.agreements.title',
    'invest.my.support.title',
  ]) {
    assert.ok(src.includes(key), key);
  }
  assert.doesNotMatch(src, /marketValue|totalValue|portfolioValue/i);
  assert.match(src, /suspendedNotice/);
  assert.match(src, /restrictedRead/);
});

test('invest pages render from the projection only: no role or mode checks, no defaultValue fallbacks', async () => {
  for (const file of [...PAGES, 'src/utils/invest.js', 'src/utils/navbarNavigation.js', 'src/api/invest.js']) {
    const raw = await read(file);
    // Comments may name the forbidden sources to say they are not used;
    // only code is checked.
    const src = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /default_mode/, file);
    assert.doesNotMatch(src, /user\?\.role|user\.role|\.role ===/, file);
    assert.doesNotMatch(src, /defaultValue/, file);
  }
});

test('invest locale strings have no em dashes and the API client only calls documented /api/invest routes', async () => {
  const en = JSON.parse(await read('src/locales/en.json'));
  assert.doesNotMatch(JSON.stringify(en.invest), /—/);
  const api = await read('src/api/invest.js');
  const calls = [...api.matchAll(/api\.(?:get|post|patch)\((?:'|`|")([^'"`]+)/g)].map((m) => m[1]);
  assert.ok(calls.length > 0);
  assert.ok(calls.every((path) => path.startsWith('/invest/')), calls.join(', '));
  assert.ok(calls.some((path) => path.includes('/commitments')), 'commit route present');
  assert.ok(calls.some((path) => path === '/invest/me'), 'my investments route present');
});
