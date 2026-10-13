// Review W3 (P1-132, P1-133, P2-478, P2-479, P2-480, P2-481).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jobDetailView, acceptedExpiryDaysLeft } from '../src/utils/jobDetailModel.js';
import { validateBidEdit } from '../src/utils/bidEdit.js';

const helper = { id: 'h1', role: 'helper' };
const owner = { id: 'c1', role: 'customer' };
const base = { id: 'j1', client_id: 'c1', assigned_helper_id: 'h1' };

test('accepted-job expiry countdown', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  assert.equal(acceptedExpiryDaysLeft({ status: 'accepted', accepted_at: '2026-10-07T12:00:00Z' }, now), 2);
  assert.equal(acceptedExpiryDaysLeft({ status: 'accepted', accepted_at: '2026-10-01T12:00:00Z' }, now), 0);
  assert.equal(acceptedExpiryDaysLeft({ status: 'in_progress', accepted_at: '2026-10-07T12:00:00Z' }, now), null);
  assert.equal(acceptedExpiryDaysLeft({ status: 'accepted' }, now), null);
});

test('assigned helper can mark done once; owner sees pending confirmation', () => {
  const running = { ...base, status: 'in_progress' };
  assert.equal(jobDetailView({ job: running, user: helper }).canHelperComplete, true);
  const requested = { ...running, completion_requested_at: '2026-10-12T00:00:00Z' };
  const helperView = jobDetailView({ job: requested, user: helper });
  assert.equal(helperView.canHelperComplete, false);
  assert.equal(helperView.completionPending, true);
  assert.equal(jobDetailView({ job: requested, user: owner }).action, 'complete');
});

test('both parties can close a completed job; strangers cannot', () => {
  const done = { ...base, status: 'completed' };
  assert.equal(jobDetailView({ job: done, user: owner }).canClose, true);
  assert.equal(jobDetailView({ job: done, user: helper }).canClose, true);
  assert.equal(jobDetailView({ job: done, user: { id: 'x', role: 'helper' } }).canClose, false);
});

test('bid edit validation mirrors the server', () => {
  assert.deepEqual(validateBidEdit({ amount: '120', etaHours: '3', message: 'ok' }), {});
  assert.equal(validateBidEdit({ amount: '0', etaHours: '', message: '' }).amount, 'myBids.editAmountInvalid');
  assert.equal(validateBidEdit({ amount: '20000000', etaHours: '', message: '' }).amount, 'myBids.editAmountTooLarge');
  assert.equal(validateBidEdit({ amount: '5', etaHours: '-1', message: '' }).etaHours, 'myBids.editEtaInvalid');
  assert.equal(validateBidEdit({ amount: '5', etaHours: '', message: 'x'.repeat(2001) }).message, 'myBids.editMessageTooLong');
});

test('UI entry points are wired and every new key exists in all five locales', () => {
  const page = readFileSync(new URL('../src/pages/JobDetailPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /<JobAutoExpiryWarning /);
  assert.match(page, /\/jobs\/\$\{id\}\/close/);
  assert.match(page, /jdp-helper-complete-action/);
  assert.match(readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8'), /path="\/helper\/payouts"/);
  assert.match(readFileSync(new URL('../src/pages/MyBidsPage.jsx', import.meta.url), 'utf8'), /<EditBidModal/);
  assert.match(readFileSync(new URL('../src/components/jobs/AssignedJobsPanel.jsx', import.meta.url), 'utf8'), /role: 'helper'/);
  const keys = {
    jobDetail: ['completionRequested', 'jobClosed', 'closeBlockedDispute', 'closeBlockedPayment', 'completionPendingOwner', 'completionPendingHelper', 'helperMarkDone', 'closeJob'],
    myJobs: ['assignedTab', 'assignedSubtitle', 'assignedLoading', 'assignedFailed', 'assignedRetry', 'assignedPayouts', 'assignedEmpty', 'assignedAwaitingConfirmation'],
    myBids: ['edit', 'editTitle', 'editSave', 'editSaved', 'editFailed', 'editClosed', 'editAmountInvalid', 'editEtaInvalid'],
    helperPayouts: ['title', 'available', 'pending', 'instantAvailable', 'limitNote', 'instantButton', 'confirm', 'requested', 'failed'],
    jobAutoExpiry: ['title', 'message', 'note'],
  };
  for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8'));
    for (const [ns, list] of Object.entries(keys)) {
      for (const key of list) assert.ok(catalog[ns]?.[key], `${locale} ${ns}.${key}`);
    }
    for (const s of ['accepted', 'in_progress', 'completed', 'closed', 'cancelled']) {
      assert.ok(catalog.myJobs.assignedStatus[s], `${locale} myJobs.assignedStatus.${s}`);
    }
  }
});
