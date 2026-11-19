import test from 'node:test';
import assert from 'node:assert/strict';
import {
  investAccessFromProjection,
  investNavLinks,
  investorWorkspaceSections,
  formatInvestCents,
  fundingProgress,
  provenanceLabelKey,
  opportunityStatusLabel,
  reviewQueueTabLabel,
  documentVisibilityLabel,
  applicationStatusLabel,
  amendmentStatusLabel,
  updateStatusLabel,
  parseAmountToCents,
  commitReviewMissingRows,
  commitmentReferenceCents,
} from './invest.js';

const t = (key) => key;

test('invest access comes from the projection only, never role or mode', () => {
  assert.deepEqual(investAccessFromProjection(null), {
    investEnabled: false, investCommitmentsEnabled: false, investPilot: false, canParticipate: false,
  });
  assert.deepEqual(investAccessFromProjection({}), {
    investEnabled: false, investCommitmentsEnabled: false, investPilot: false, canParticipate: false,
  });
  // investor.reporting alone grants nothing for participation.
  const reportingOnly = investAccessFromProjection({
    invest: { investEnabled: true, investCommitmentsEnabled: false, investPilot: false },
    access: { personal: ['investor.reporting'] },
  });
  assert.equal(reportingOnly.investEnabled, true);
  assert.equal(reportingOnly.canParticipate, false);
  // A legacy investor mode value is not read at all.
  const legacyMode = investAccessFromProjection({
    invest: { investEnabled: true, investCommitmentsEnabled: true, investPilot: false },
    access: { personal: ['investor.participate'] },
  });
  assert.equal(legacyMode.canParticipate, true);
  assert.equal(legacyMode.investCommitmentsEnabled, true);
});

test('invest access reads the useAccessProjection snapshot shape too (Track 4)', () => {
  // Live, pages and the navbar hold the hook snapshot
  // { access: <projection>, flags: <client flags> }, where the projection
  // carries `.invest` and `.personal`. Reading only `projection.invest`
  // made investEnabled always false live, so every invest page rendered
  // "not available" and no invest nav link ever appeared.
  const snapshot = {
    access: {
      personal: ['investor.participate'],
      invest: { investEnabled: true, investCommitmentsEnabled: false, investPilot: false },
    },
    flags: { investEnabled: true, investCommitmentsEnabled: false, investPilot: false },
  };
  const fromSnapshot = investAccessFromProjection(snapshot);
  assert.equal(fromSnapshot.investEnabled, true);
  assert.equal(fromSnapshot.investCommitmentsEnabled, false);
  assert.equal(fromSnapshot.canParticipate, true);
  // The raw GET /api/me/access response has the same nesting.
  const raw = {
    accountId: '1',
    access: snapshot.access,
    flags: snapshot.flags,
  };
  assert.equal(investAccessFromProjection(raw).investEnabled, true);
  // The projection on its own also works.
  assert.equal(investAccessFromProjection(snapshot.access).investEnabled, true);
  assert.equal(investAccessFromProjection(snapshot.access).canParticipate, true);
});

test('amendment and update status labels resolve through static keys only (Track 4)', () => {
  assert.equal(amendmentStatusLabel('proposed', t), 'invest.entity.manage.amendments.status.proposed');
  assert.equal(amendmentStatusLabel('effective', t), 'invest.entity.manage.amendments.status.effective');
  assert.equal(amendmentStatusLabel('unknown', t), 'invest.entity.manage.amendments.status.draft');
  assert.equal(updateStatusLabel('overdue', t), 'invest.entity.manage.updates.status.overdue');
  assert.equal(updateStatusLabel('published', t), 'invest.entity.manage.updates.status.published');
  assert.equal(updateStatusLabel('unknown', t), 'invest.entity.manage.updates.status.draft');
});

test('invest nav links appear only when the projection flag is on, and never remove customer links', () => {
  assert.deepEqual(investNavLinks(null), []);
  assert.deepEqual(investNavLinks({ invest: { investEnabled: false } }), []);
  assert.deepEqual(investNavLinks({ invest: { investEnabled: true } }).map((l) => [l.id, l.to]), [
    ['investments', '/investments'],
  ]);
  // Role and mode do not change the links.
  const withRole = investNavLinks({ invest: { investEnabled: true }, access: { personal: [] } });
  assert.equal(withRole.length, 1);
});

test('Investor workspace keeps reports, opportunities, and contributions independently scoped', () => {
  const projection = {
    flags: { accessProjection: true, investEnabled: true, investCommitmentsEnabled: false },
    access: {
      personal: ['customer', 'investor.reporting'],
      investorAudience: { audienceKey: 'entity', datasets: ['overview'] },
    },
  };
  const sections = investorWorkspaceSections(projection);
  assert.deepEqual(sections.map(({ id, to, available }) => [id, to, available]), [
    ['reports', '/investments', true],
    ['opportunities', '/invest', true],
    ['contributions', '/invest/apply', false],
  ]);

  const participant = investorWorkspaceSections({
    ...projection,
    access: { personal: ['customer', 'investor.participate'] },
    flags: { accessProjection: true, investEnabled: true, investCommitmentsEnabled: false },
  });
  assert.equal(participant[0].available, false);
  assert.equal(participant[1].available, true);
  assert.equal(participant[2].to, '/invest/my-investments');
  assert.equal(participant[2].readOnly, true);
});

test('funding progress labels reserved commitments as pending, never as completed funding', () => {
  const progress = fundingProgress(100000, 25000, 10000);
  assert.equal(progress.percent, 35);
  assert.equal(progress.reservedCents, 25000);
  assert.equal(progress.completedCents, 10000);
  assert.equal(fundingProgress(0, 5000, 0).percent, 0);
});

test('amount parsing accepts dollars and cents only', () => {
  assert.equal(parseAmountToCents('250'), 25000);
  assert.equal(parseAmountToCents('250.50'), 25050);
  assert.equal(parseAmountToCents('0'), null);
  assert.equal(parseAmountToCents('-5'), null);
  assert.equal(parseAmountToCents('12.345'), null);
  assert.equal(parseAmountToCents('abc'), null);
  assert.equal(parseAmountToCents(''), null);
});

test('commit review completeness checker requires every §4 row', () => {
  const complete = {
    amountCents: 25000,
    currencyCode: 'USD',
    valuationRule: 'Revenue share.',
    fees: [],
    feesTotalCents: 0,
    feesNote: 'No investor fees are charged.',
    rightsSummary: 'Rights are governed by agreement version 1.',
    agreementVersion: { id: 'v1', versionNumber: 1, contentHash: 'abc' },
    status: 'pending',
    statusNote: 'Pending, not completed.',
    cancellationTerms: 'Cancellable while reserved.',
    riskAcknowledged: true,
    riskNote: 'Possible loss.',
  };
  assert.deepEqual(commitReviewMissingRows(complete), []);
  assert.deepEqual(commitReviewMissingRows({ ...complete, status: 'completed' }), ['status']);
  assert.deepEqual(commitReviewMissingRows({ ...complete, fees: undefined }), ['fees']);
  assert.deepEqual(commitReviewMissingRows({ ...complete, agreementVersion: { id: 'v1', versionNumber: 1 } }), ['agreementVersion']);
  assert.deepEqual(commitReviewMissingRows({ ...complete, riskAcknowledged: false }), ['riskAcknowledged']);
  assert.deepEqual(commitReviewMissingRows(null), ['review']);
});

test('monetary reference value uses the Credit reference rate in force', () => {
  assert.equal(commitmentReferenceCents(25000, 1), 25000);
  assert.equal(commitmentReferenceCents(25000, 0.5), 12500);
  assert.equal(commitmentReferenceCents(25000, null), null);
});

test('status, visibility, and provenance labels resolve through static keys', () => {
  assert.equal(opportunityStatusLabel('published', t), 'invest.common.status.published');
  assert.equal(opportunityStatusLabel('under_review', t), 'invest.common.status.underReview');
  assert.equal(opportunityStatusLabel('unsuccessful', t), 'invest.common.status.unsuccessful');
  assert.equal(reviewQueueTabLabel('amendments', t), 'invest.review.tabs.amendments');
  assert.equal(reviewQueueTabLabel('closing', t), 'invest.review.tabs.closing');
  assert.equal(documentVisibilityLabel('committed', t), 'invest.detail.documents.visibility.committed');
  assert.equal(applicationStatusLabel('needs_information', t), 'invest.application.status.needsInformation');
  assert.equal(provenanceLabelKey('checked'), 'invest.detail.provenance.checked');
  assert.equal(provenanceLabelKey('entity_provided'), 'invest.detail.provenance.entityProvided');
  assert.equal(formatInvestCents(25000, 'USD'), '$250.00');
});
