import test from 'node:test';
import assert from 'node:assert/strict';
import {
  investAccessFromProjection,
  investNavLinks,
  formatInvestCents,
  fundingProgress,
  provenanceLabelKey,
  opportunityStatusLabel,
  documentVisibilityLabel,
  applicationStatusLabel,
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

test('invest nav links appear only when the projection flag is on, and never remove customer links', () => {
  assert.deepEqual(investNavLinks(null), []);
  assert.deepEqual(investNavLinks({ invest: { investEnabled: false } }), []);
  assert.deepEqual(investNavLinks({ invest: { investEnabled: true } }).map((l) => [l.id, l.to]), [
    ['exploreInvestments', '/invest'],
    ['requestInvestorAccess', '/invest/apply'],
    ['myInvestments', '/invest/my-investments'],
  ]);
  // Role and mode do not change the links.
  const withRole = investNavLinks({ invest: { investEnabled: true }, access: { personal: [] } });
  assert.equal(withRole.length, 3);
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
  assert.equal(documentVisibilityLabel('committed', t), 'invest.detail.documents.visibility.committed');
  assert.equal(applicationStatusLabel('needs_information', t), 'invest.application.status.needsInformation');
  assert.equal(provenanceLabelKey('checked'), 'invest.detail.provenance.checked');
  assert.equal(provenanceLabelKey('entity_provided'), 'invest.detail.provenance.entityProvided');
  assert.equal(formatInvestCents(25000, 'USD'), '$250.00');
});
