import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/admin/pages/ConsultingPayments.jsx', import.meta.url), 'utf8');
const controller = fs.readFileSync(new URL('../../server/controllers/adminConsultingController.js', import.meta.url), 'utf8');
const locales = ['en', 'es', 'fr', 'ht', 'ar'].map((lang) => ({
  lang,
  json: JSON.parse(fs.readFileSync(new URL(`../src/locales/${lang}.json`, import.meta.url), 'utf8')),
}));

// G10-7 (D-768): a single admin could conjure a completed consulting
// payment with no reference and no second approver. Mark-paid now needs
// two distinct admins to approve first, plus a required reference.
test('the admin page approves first and only offers mark-paid at two approvals', () => {
  assert.match(page, /approve-mark-paid/);
  assert.match(page, /mark_paid_first_approver/);
  assert.match(page, /mark_paid_second_approver/);
  assert.match(page, /approvals === 2/);
  assert.match(page, /markPaidApprovals/);
  assert.match(page, /approveMarkPaid/);
  // The new controls use CSS classes, not inline styles: the
  // no-new-inline-styles gate fails the build on any new style={}.
  assert.match(page, /consulting-approve-mark-paid/);
  assert.match(page, /consulting-mark-paid-approvals/);
  const css = fs.readFileSync(new URL('../src/admin/pages/ConsultingPayments.css', import.meta.url), 'utf8');
  assert.match(css, /\.consulting-approve-mark-paid/);
  assert.match(css, /\.consulting-mark-paid-approvals\.is-complete/);
});

test('the reference input is required, not optional', () => {
  assert.match(page, /reference\.trim\(\)/);
  assert.match(page, /required style/);
  for (const { lang, json } of locales) {
    const ns = json.adminConsultingPayments;
    assert.equal(typeof ns.markPaidReference, 'string', lang);
    assert.doesNotMatch(ns.markPaidReference, /optional|opcional|facultatif|opsyonèl|اختياري/i, lang);
  }
});

test('the server requires two distinct approvers and a reference', () => {
  assert.match(controller, /mark_paid_first_approver IS NOT NULL/);
  assert.match(controller, /mark_paid_second_approver IS NOT NULL/);
  assert.match(controller, /mark_paid_first_approver <> mark_paid_second_approver/);
  assert.match(controller, /second_approver_required/);
  assert.match(controller, /reference_required/);
  assert.match(controller, /mark_paid_not_approved/);
});

test('the approval keys exist in all five locales', () => {
  for (const { lang, json } of locales) {
    const ns = json.adminConsultingPayments;
    for (const key of ['approveMarkPaid', 'markPaidApprovals', 'markPaidApproved', 'markPaidApprovalFailed']) {
      assert.equal(typeof ns[key], 'string', `${lang}.${key}`);
    }
    assert.match(ns.markPaidApprovals, /\{\{count\}\}/, lang);
  }
});
