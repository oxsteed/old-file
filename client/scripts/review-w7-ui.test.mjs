import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const langs = ['en', 'es', 'fr', 'ht', 'ar'];
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

test('W7 UI wiring', () => {
  const job = src('pages/JobDetailPage.jsx');
  assert.match(job, /\/messages\/jobs\/\$\{id\}\/conversation/); // P1-136
  assert.match(job, /\/agreements\/new\?jobId=/); // P1-137
  assert.match(job, /DisputeSubmissionModal/); // P1-137
  assert.match(job, /acceptBid/); // P1-134
  assert.match(src('pages/WorkAgreementPage.jsx'), /\/complete`/); // P1-164
  assert.match(src('components/helperProfile/chat/AgreementCard.jsx'), /recordsRoomAgreementId/); // P1-163
  assert.match(src('pages/DirectPortalPage.jsx'), /payDirectWithCredit/); // P1-178
  assert.match(src('pages/DirectPortalPage.jsx'), /checkDirectServiceAvailability/); // P1-179
});

test('W7 strings exist in every locale', () => {
  const keys = [
    'jobDetail.openJobChat', 'jobDetail.createAgreement', 'jobDetail.reportProblem', 'jobDetail.customerConfirmsEscrow',
    'workAgreement.confirmComplete', 'workAgreement.awaitingCounterparty',
    'helperProfile.messenger.quoteFinishOnJob', 'helperProfile.messenger.agreementOpenRecords',
    'directPortal.case.actions.payWithCredit', 'directPortal.request.hints.outsideServiceArea',
  ];
  for (const lang of langs) {
    const data = JSON.parse(src(`locales/${lang}.json`));
    for (const key of keys) assert.ok(typeof get(data, key) === 'string' && get(data, key).length, `${lang}:${key}`);
  }
});
