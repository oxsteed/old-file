import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (rel) => readFile(new URL(rel, root), 'utf8');

const PAGES = [
  'src/pages/InvestmentsWorkspacePage.jsx',
  'src/pages/invest/InvestDirectoryPage.jsx',
  'src/pages/invest/InvestOpportunityPage.jsx',
  'src/pages/invest/InvestApplicationPage.jsx',
  'src/pages/invest/InvestCommitPage.jsx',
  'src/pages/invest/InvestMyInvestmentsPage.jsx',
  'src/pages/invest/InvestEntityRaisePage.jsx',
  'src/pages/invest/InvestEntityRaisesPage.jsx',
  'src/pages/invest/InvestEntityManagePage.jsx',
  'src/pages/invest/InvestEntityRaiseEditPage.jsx',
];

test('invest routes are registered in App.jsx', async () => {
  const app = await read('src/App.jsx');
  for (const route of ['/investments"', '/invest"', '/invest/opportunities/:id"', '/invest/opportunities/:id/commit"', '/invest/apply"', '/invest/my-investments"']) {
    assert.match(app, new RegExp(`path="${route.replace(/"/g, '')}"`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), route);
  }
  for (const page of ['InvestmentsWorkspacePage', 'InvestDirectoryPage', 'InvestOpportunityPage', 'InvestApplicationPage', 'InvestCommitPage', 'InvestMyInvestmentsPage']) {
    const importPattern = page === 'InvestmentsWorkspacePage'
      ? `import\\('./pages/${page}'\\)`
      : `import\\('./pages/invest/${page}'\\)`;
    assert.match(app, new RegExp(importPattern), page);
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
  const calls = [...api.matchAll(/api\.(?:get|post|put|patch)\((?:'|`|")([^'"`]+)/g)].map((m) => m[1]);
  assert.ok(calls.length > 0);
  assert.ok(calls.every((path) => path.startsWith('/invest/')), calls.join(', '));
  assert.ok(calls.some((path) => path.includes('/commitments')), 'commit route present');
  assert.ok(calls.some((path) => path === '/invest/me'), 'my investments route present');
});

// ── Track 4: entity fundraising + reviewer UI ─────────────────────────────

const TRACK4_PAGES = [
  ...PAGES.slice(5),
  'src/admin/pages/InvestReviewQueue.jsx',
];

const TRACK4_ENTITY_KEYS = [
  'invest.entity.raise.title',
  'invest.entity.raise.authority.label',
  'invest.entity.raise.documentsNotice',
  'invest.entity.raise.submitReviewNote',
  'invest.entity.raise.created.title',
  'invest.entity.raise.preview.title',
  'invest.entity.raises.title',
  'invest.entity.raises.card.manage',
  'invest.entity.manage.questions.title',
  'invest.entity.manage.updates.title',
  'invest.entity.manage.updates.overdue',
  'invest.entity.manage.amendments.title',
  'invest.entity.manage.amendments.proposedState',
  'invest.entity.manage.agreements.title',
  'invest.entity.manage.obligations.title',
];

test('Track 4: entity routes are registered in App.jsx and the business hub links to them', async () => {
  const app = await read('src/App.jsx');
  for (const route of ['/invest/entity/raise"', '/invest/entity/raises"', '/invest/entity/raises/:id"']) {
    assert.match(app, new RegExp(`path="${route.replace(/"/g, '')}"`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), route);
  }
  for (const page of ['InvestEntityRaisePage', 'InvestEntityRaisesPage', 'InvestEntityManagePage']) {
    assert.match(app, new RegExp(`import\\('./pages/invest/${page}'\\)`), page);
  }
  const hub = await read('src/pages/BusinessHubPage.jsx');
  assert.match(hub, /invest\/entity\/raises\?businessId=/);
  assert.match(hub, /investAccessFromProjection/);
  assert.match(hub, /businessHub\.raiseCapital/);
  assert.match(hub, /investAccess\.investEnabled/);
});

test('Track 4: raise form collects every application section and submission never publishes', async () => {
  const src = await read('src/pages/invest/InvestEntityRaisePage.jsx');
  for (const key of [
    'invest.entity.raise.authority.label',
    'invest.entity.raise.form.title.label',
    'invest.entity.raise.form.purpose.label',
    'invest.entity.raise.form.target.label',
    'invest.entity.raise.form.minimum.label',
    'invest.entity.raise.form.deadline.label',
    'invest.entity.raise.form.valuation.label',
    'invest.entity.raise.form.useOfProceeds.label',
    'invest.entity.raise.form.legal.label',
    'invest.entity.raise.form.financials.label',
    'invest.entity.raise.form.ownership.label',
    'invest.entity.raise.form.risks.label',
    'invest.entity.raise.form.relatedParties.label',
    'invest.entity.raise.form.agreement.label',
  ]) {
    assert.ok(src.includes(key), key);
  }
  assert.match(src, /documentsNotice/);
  assert.match(src, /getOpportunityPreview/);
  assert.match(src, /submitOpportunityForReview/);
  assert.match(src, /submitReviewNote/);
  assert.match(src, /createOpportunity/);
  assert.match(src, /createAgreementVersion/);
  assert.doesNotMatch(src, /publishOpportunity/);
  // Drafts are private: the create call never publishes.
  assert.doesNotMatch(src, /submit-for-review.*publish|publish.*submit-for-review/);
});

test('Track 4: manage page answers questions, publishes updates, and runs amendments', async () => {
  const src = await read('src/pages/invest/InvestEntityManagePage.jsx');
  for (const marker of [
    'answerQuestion',
    'invest.entity.manage.questions.answerButton',
    'createUpdate',
    'publishUpdate',
    'invest.entity.manage.updates.overdue',
    'updateStatusLabel',
    'createAmendment',
    'proposeAmendment',
    'invest.entity.manage.amendments.proposedState',
    'reconfirmationDeadlineAt',
    'noticeSentAt',
    'createAgreementVersion',
    'listAgreementVersions',
    'invest.entity.manage.obligations.title',
    'invest.entity.manage.status.conditionsApproved',
  ]) {
    assert.ok(src.includes(marker), marker);
  }
  // Missed updates show as OVERDUE, never disappear: the overdue label
  // and the overdue copy are both rendered from the API status.
  assert.match(src, /status === 'overdue'/);
  assert.doesNotMatch(src, /filter\(.*status !== 'overdue'/);
});

test('Track 4: review queue covers all four queues with stale-version and self-approval surfacing', async () => {
  const src = await read('src/admin/pages/InvestReviewQueue.jsx');
  for (const marker of [
    'getReviewQueue',
    'reviewApplication',
    'reviewOpportunity',
    'publishOpportunity',
    'approveClosingConditions',
    'recordClosingApproval',
    'closeOpportunity',
    'releaseProceeds',
    'recordDistribution',
    'invest.review.errors.versionConflict',
    'invest.review.errors.selfApproval',
    'invest.review.errors.proceedsBlocked',
    'invest.review.closing.gateOff',
    'invest.review.closing.separateApprovers',
    'reviewQueueTabLabel',
    'investAccessFromProjection',
  ]) {
    assert.ok(src.includes(marker), marker);
  }
  // Live-commitment gate: close, proceeds, and distribution actions are
  // disabled while the gate is off, never rendered as working buttons.
  assert.match(src, /disabled=\{busy \|\| !gateOn\}/);
  assert.match(src, /!access\.investCommitmentsEnabled/);
  // Every queue tab comes from the server's capability-scoped response.
  assert.match(src, /queue\?\.queues/);
  assert.match(src, /invest_review_not_permitted/);
  // Proceeds rows carry the proceeds id; the detail key is the
  // opportunity id, so the detail fetch must use row.opportunityId.
  assert.match(src, /type === 'proceeds' \? row\.opportunityId : row\.id/);
});

test('Track 4: admin invest review route is in the manifest, AdminApp, nav, and server allowlist', async () => {
  const manifest = await read('src/admin/adminRouteManifest.js');
  assert.match(manifest, /investReviewQueue: defineRoute\('\/admin\/invest\/review-queue'\)/);
  const app = await read('src/admin/AdminApp.jsx');
  assert.match(app, /adminRoute\('investReviewQueue'\)\.relative/);
  assert.match(app, /review_invest_participation/);
  assert.match(app, /review_invest_opportunity_publish/);
  assert.match(app, /review_invest_close/);
  assert.match(app, /review_invest_release_proceeds/);
  assert.match(app, /import\('\.\/pages\/InvestReviewQueue'\)/);
  const layout = await read('src/admin/layouts/AdminLayout.jsx');
  assert.match(layout, /routePath\('investReviewQueue'\)/);
  assert.match(layout, /adminNav\.investReviewQueue/);
  const allowlist = await read('../server/utils/adminSpaRoutes.js');
  assert.ok(allowlist.includes("'/admin/invest/review-queue'"), 'allowlist entry');
});

test('Track 4: entity and review API calls only use documented /api/invest routes', async () => {
  const api = await read('src/api/invest.js');
  for (const path of [
    '/invest/opportunities',
    '/invest/opportunities/${id}/submit-for-review',
    '/invest/opportunities/${id}/preview',
    '/invest/opportunities/${opportunityId}/agreement-versions',
    '/invest/opportunities/${opportunityId}/questions/${questionId}/answer',
    '/invest/opportunities/${opportunityId}/updates',
    '/invest/opportunities/${opportunityId}/amendments',
    '/invest/review-queue',
    '/invest/applications/${id}/review',
    '/invest/opportunities/${id}/review',
    '/invest/opportunities/${id}/publish',
    '/invest/opportunities/${id}/closing-conditions/approve',
    '/invest/opportunities/${id}/closing-approvals',
    '/invest/opportunities/${id}/close',
    '/invest/opportunities/${id}/release-proceeds',
    '/invest/opportunities/${opportunityId}/distributions',
  ]) {
    assert.ok(api.includes(path), path);
  }
  assert.match(api, /scope: 'mine'/);
  // Track 5: the draft-edit form saves through the documented PUT route.
  assert.match(api, /api\.put\(`\/invest\/opportunities\/\$\{id\}`/);
});

test('Track 4: entity and review locale keys exist in all five locales with no em dashes', async () => {
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(await read(`src/locales/${lang}.json`));
    for (const key of TRACK4_ENTITY_KEYS) {
      const parts = key.split('.');
      let node = catalog;
      for (const part of parts) node = node?.[part];
      assert.equal(typeof node, 'string', `${lang} ${key}`);
    }
    assert.equal(typeof catalog.invest.review.title, 'string', `${lang} review title`);
    assert.equal(typeof catalog.businessHub.raiseCapital, 'string', `${lang} raise capital`);
    assert.equal(typeof catalog.adminNav.investReviewQueue, 'string', `${lang} admin nav`);
    assert.doesNotMatch(JSON.stringify(catalog.invest.entity), /—/, `${lang} entity em dash`);
    assert.doesNotMatch(JSON.stringify(catalog.invest.review), /—/, `${lang} review em dash`);
  }
});

test('Track 4: entity and review pages render from the projection only', async () => {
  for (const file of [...TRACK4_PAGES, 'src/utils/invest.js']) {
    const raw = await read(file);
    const src = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /default_mode/, file);
    assert.doesNotMatch(src, /user\?\.role|user\.role|\.role ===/, file);
    assert.doesNotMatch(src, /defaultValue/, file);
  }
  const util = await read('src/utils/invest.js');
  assert.match(util, /amendmentStatusLabel/);
  assert.match(util, /updateStatusLabel/);
  assert.match(util, /reviewQueueTabLabel/);
  assert.match(util, /opportunityDetailFieldLabel/);
});

// ── Track 5: draft-edit form ─────────────────────────────────────────────
// A draft opportunity could previously only be fixed through the PUT API;
// the edit form reuses the raise-page fields, saves through that endpoint
// with the opportunity's expectedVersion, shows the investor preview after
// save, and repeats the "submission does not publish" notice. Agreement
// text is not edited here (versions are created from the manage page), and
// there is no reviewer effective/reject step for amendments: the API
// offers draft-to-proposed only, and the controlled process is notice
// plus reconfirmation.

const TRACK5_EDIT_KEYS = [
  'invest.entity.edit.title',
  'invest.entity.edit.intro',
  'invest.entity.edit.draftNotice',
  'invest.entity.edit.save',
  'invest.entity.edit.saving',
  'invest.entity.edit.saved.title',
  'invest.entity.edit.saved.copy',
  'invest.entity.edit.notEditable.copy',
  'invest.entity.edit.error.loadFailed',
  'invest.entity.edit.error.saveFailed',
  'invest.entity.edit.error.amendmentRequired',
  'invest.entity.raises.card.edit',
];

test('Track 5: draft-edit route is registered in App.jsx', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /path="\/invest\/entity\/raises\/:id\/edit"/);
  assert.match(app, /import\('\.\/pages\/invest\/InvestEntityRaiseEditPage'\)/);
});

test('Track 5: edit form reuses the raise fields, saves via PUT with expectedVersion, previews after save', async () => {
  const src = await read('src/pages/invest/InvestEntityRaiseEditPage.jsx');
  for (const marker of [
    'getOpportunity',
    'updateOpportunity',
    'getOpportunityPreview',
    'submitOpportunityForReview',
    'invest.entity.raise.submitReviewNote',
    'invest.entity.raise.preview.title',
    'invest.entity.edit.title',
    'invest.entity.edit.save',
    'invest.entity.edit.saved.title',
    'expectedVersion',
    'invest_opportunity_amendment_required',
    'invest.entity.edit.error.amendmentRequired',
  ]) {
    assert.ok(src.includes(marker), marker);
  }
  // Raise-page fields are reused, not duplicated: the same label keys.
  for (const key of [
    'invest.entity.raise.form.title.label',
    'invest.entity.raise.form.purpose.label',
    'invest.entity.raise.form.target.label',
    'invest.entity.raise.form.minimum.label',
    'invest.entity.raise.form.deadline.label',
    'invest.entity.raise.form.valuation.label',
    'invest.entity.raise.form.useOfProceeds.label',
    'invest.entity.raise.form.legal.label',
    'invest.entity.raise.form.financials.label',
    'invest.entity.raise.form.ownership.label',
    'invest.entity.raise.form.risks.label',
    'invest.entity.raise.form.relatedParties.label',
  ]) {
    assert.ok(src.includes(key), key);
  }
  // Only drafts can be edited here; non-drafts show the amendment notice.
  assert.match(src, /opportunity\.status === 'draft'/);
  assert.match(src, /invest\.entity\.edit\.notEditable\.copy/);
  // Saving never publishes and never touches agreement versions here.
  assert.doesNotMatch(src, /publishOpportunity/);
  assert.doesNotMatch(src, /createAgreementVersion/);
  // The API client sends the PUT with the version the page rendered.
  const api = await read('src/api/invest.js');
  assert.match(api, /export async function updateOpportunity/);
  assert.match(api, /expectedVersion/);
});

test('Track 5: manage and raises pages link to the edit form for drafts only', async () => {
  const manage = await read('src/pages/invest/InvestEntityManagePage.jsx');
  assert.match(manage, /\/invest\/entity\/raises\/\$\{opportunity\.id\}\/edit/);
  assert.match(manage, /opportunity\.status === 'draft' \? \(\n[\s\S]*?invest\.entity\.raises\.card\.edit/);
  const raises = await read('src/pages/invest/InvestEntityRaisesPage.jsx');
  assert.match(raises, /\/invest\/entity\/raises\/\$\{opportunity\.id\}\/edit/);
  assert.match(raises, /opportunity\.status === 'draft'/);
});

test('Track 5: draft-edit locale keys exist in all five locales with no em dashes', async () => {
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(await read(`src/locales/${lang}.json`));
    for (const key of TRACK5_EDIT_KEYS) {
      const parts = key.split('.');
      let node = catalog;
      for (const part of parts) node = node?.[part];
      assert.equal(typeof node, 'string', `${lang} ${key}`);
    }
    assert.doesNotMatch(JSON.stringify(catalog.invest.entity.edit), /—/, `${lang} edit em dash`);
  }
});

const TRACK6_KEYS = [
  'invest.common.status.unsuccessful',
  'invest.review.tabs.amendments',
  'invest.review.amendments.changes',
  'invest.review.amendments.reconfirmationTitle',
  'invest.review.amendments.reconfirmation',
  'invest.review.amendments.reconfirmationNone',
  'invest.review.amendments.deadline',
  'invest.review.amendments.note',
  'invest.review.amendments.makeEffective',
  'invest.review.amendments.reject',
  'invest.review.amendments.effectiveNote',
  'invest.review.failClose.title',
  'invest.review.failClose.copy',
  'invest.review.failClose.reason',
  'invest.review.failClose.button',
  'invest.review.failClose.note',
  'invest.entity.manage.amendments.effectiveState',
  'invest.entity.manage.amendments.rejectedState',
  'invest.entity.manage.agreements.current',
];

test('Track 6: review queue decides amendments and fail-closes; entity page shows amendment outcomes', async () => {
  const queue = await read('src/admin/pages/InvestReviewQueue.jsx');
  for (const marker of [
    'reviewAmendment',
    'failCloseOpportunity',
    'AmendmentDetail',
    'invest.review.amendments.makeEffective',
    'invest.review.amendments.reject',
    'invest.review.amendments.reconfirmation',
    'invest.review.failClose.button',
    'invest.review.failClose.title',
    'amendmentStatusLabel',
    "type === 'amendments'",
  ]) {
    assert.ok(queue.includes(marker), marker);
  }
  const api = await read('src/api/invest.js');
  for (const fn of [
    'export async function reviewAmendment',
    'export async function failCloseOpportunity',
    'export async function recordPartnerEscrowConfirmation',
  ]) {
    assert.ok(api.includes(fn), fn);
  }
  for (const path of [
    '/invest/opportunities/${opportunityId}/fail-close',
    '/invest/commitments/${commitmentId}/escrow-confirmation',
  ]) {
    assert.ok(api.includes(path), path);
  }
  // reviewAmendment builds the effective/reject suffix from its decision
  // argument; both suffixes must be present in the one call.
  assert.match(api, /\/invest\/amendments\/\$\{amendmentId\}\/\$\{decision === 'effective' \? 'effective' : 'reject'\}/);
  const manage = await read('src/pages/invest/InvestEntityManagePage.jsx');
  for (const marker of [
    'invest.entity.manage.amendments.effectiveState',
    'invest.entity.manage.amendments.rejectedState',
    'invest.entity.manage.agreements.current',
    'opportunity.currentAgreementVersionId',
  ]) {
    assert.ok(manage.includes(marker), marker);
  }
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(await read(`src/locales/${lang}.json`));
    for (const key of TRACK6_KEYS) {
      const parts = key.split('.');
      let node = catalog;
      for (const part of parts) node = node?.[part];
      assert.equal(typeof node, 'string', `${lang} ${key}`);
    }
    assert.doesNotMatch(JSON.stringify(catalog.invest.review.amendments), /—/, `${lang} amendments em dash`);
    assert.doesNotMatch(JSON.stringify(catalog.invest.review.failClose), /—/, `${lang} fail-close em dash`);
  }
});

// G-34: investor reporting has one canonical destination, /investments.
// Persona nav, the workspace sections, and Applications "use now" must all
// point there; /investor/dashboard is a legacy login landing, never a
// reporting destination.
test('investor reporting has one canonical destination: /investments', async () => {
  const { investorWorkspaceSections } = await import('../src/utils/invest.js');
  const reporting = { access: { personal: ['customer', 'investor.reporting'], investorAudience: { audienceKey: 'entity', datasets: ['overview'] } } };
  const reports = investorWorkspaceSections(reporting).find((section) => section.id === 'reports');
  assert.equal(reports.to, '/investments');
  assert.equal(reports.available, true);
  const noReporting = investorWorkspaceSections({ access: { personal: ['customer'] } });
  assert.equal(noReporting.find((section) => section.id === 'reports').to, '/settings/applications');
  const applications = await read('src/pages/Settings/ApplicationsPage.jsx');
  assert.match(applications, /'investor\.reporting': '\/investments'/);
  assert.doesNotMatch(applications, /'investor\.reporting': '\/investor\/dashboard'/);
  const nav = await read('src/utils/personaNavigation.js');
  assert.match(nav, /'investor-reporting': \[\{ id: 'persona-investments', to: '\/investments'/);
});
