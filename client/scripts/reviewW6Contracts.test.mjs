import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Review W6 contract checks (source-level; the flows need a browser + Stripe).
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const LANGS = ['en', 'es', 'fr', 'ht', 'ar'];

test('P2-477: helper signup records terms on the pending registration', () => {
  assert.match(read('components/registration/AccountForm.tsx'), /\/helper-registration\/registration-terms/);
});

test('P2-476: helper dashboard renders the onboarding checklist', () => {
  assert.match(read('pages/HelperDashboard.jsx'), /<HelperOnboardingChecklist \/>/);
  const checklist = read('components/HelperOnboardingChecklist.jsx');
  assert.match(checklist, /onboarding\/status/);
  assert.match(checklist, /\/finalize/);
});

test('P3-1067: consulting confirmPayment sends the payment id and optional intent id', () => {
  const api = read('api/consultingPayment.js');
  assert.match(api, /confirmPayment = \(paymentId, stripePaymentIntentId\)/);
  assert.match(read('components/ConsultingPaymentModal.jsx'), /ConsultingCardPay/);
});

test('P3-1070: admin can mark consulting invoices paid', () => {
  assert.match(read('admin/pages/ConsultingPayments.jsx'), /\/mark-paid/);
});

test('P2-549: wallet page offers a top-up', () => {
  assert.match(read('pages/food/WalletPage.jsx'), /OxsteedCreditTopupPanel/);
  assert.match(read('api/oxsteedCredit.js'), /'\/oxsteed-credit\/topups'/);
});

test('P2-550: statement investigation API paths are relative to the /api base and linked from the archive', () => {
  const api = read('api/statementInvestigation.js');
  assert.doesNotMatch(api, /`\/api\/statements/);
  assert.match(read('pages/food/StatementArchivePage.jsx'), /\/statements\/\$\{encodeURIComponent\(item\.id\)\}\/entries\//);
});

test('W6 strings exist in every language', () => {
  for (const lang of LANGS) {
    const main = JSON.parse(read(`locales/${lang}.json`));
    const credit = JSON.parse(read(`i18n/locales/${lang}/credit.json`));
    assert.ok(main.helperOnboarding?.finalize, `${lang} helperOnboarding`);
    assert.ok(main.toolRentals?.depositReturn, `${lang} deposit`);
    assert.ok(main.adminConsultingPayments?.markPaid, `${lang} markPaid`);
    assert.ok(main.payment?.consultingCardStart, `${lang} consultingCard`);
    assert.ok(main.scheduling?.paymentRequired, `${lang} scheduling`);
    assert.ok(credit.walletTopup?.title, `${lang} walletTopup`);
    assert.ok(credit.archive?.investigate, `${lang} archive`);
  }
});
