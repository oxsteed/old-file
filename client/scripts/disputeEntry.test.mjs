import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Review P3-815 / P3-818: disputes can be opened from the job and resolved
// with the server's vocabulary.
const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');

test('job detail page opens the dispute modal for either party', () => {
  const src = read('src/pages/JobDetailPage.jsx');
  assert.match(src, /import DisputeSubmissionModal from '\.\.\/components\/DisputeSubmissionModal'/);
  assert.match(src, /\(isOwner \|\| isAssignedHelper\) && job\.assigned_helper_id && DISPUTABLE_JOB_STATUSES\.includes\(job\.status\)/);
  assert.match(src, /<DisputeSubmissionModal jobId=\{id\}/);
});

test('dispute center points to the job-based entry', () => {
  assert.match(read('src/pages/disputes/DisputeCenter.jsx'), /disputes\.center\.openFromJob/);
});

test('admin resolve posts server resolution values', () => {
  const src = read('src/admin/pages/DisputeResolve.jsx');
  for (const v of ['refund_customer', 'split_resolution', 'helper_wins', 'dismissed']) {
    assert.ok(src.includes(`value: '${v}'`), v);
  }
  assert.ok(!/value: '(full_refund|partial_refund|release_to_helper)'/.test(src));
});

test('new dispute strings exist in all five locales', () => {
  for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
    const c = JSON.parse(read(`src/locales/${locale}.json`));
    assert.ok(c.jobDetail?.openDispute, `${locale} jobDetail.openDispute`);
    assert.ok(c.jobDetail?.disputeOpened, `${locale} jobDetail.disputeOpened`);
    assert.ok(c.disputes?.center?.openFromJob, `${locale} disputes.center.openFromJob`);
  }
});
