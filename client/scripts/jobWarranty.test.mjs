import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildJobWarranty, PLATFORM_WARRANTY_MONTHS } from '../src/utils/jobDetailModel.js';

const source = async (file) => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');

test('platform warranty default is six months, Emile\'s figure from the work-agreement vision', () => {
  assert.equal(PLATFORM_WARRANTY_MONTHS, 6);
});

test('buildJobWarranty returns null until the by-job fetch resolves', () => {
  assert.equal(buildJobWarranty(null), null);
  assert.equal(buildJobWarranty(undefined), null);
  assert.equal(buildJobWarranty('nope'), null);
});

test('buildJobWarranty shapes an agreement\'s own terms', () => {
  const warranty = buildJobWarranty({
    id: 'agreement-1',
    warrantyMonths: 12,
    warrantyTerms: 'Covers parts and labour.',
    reimbursementTerms: 'Water damage reimbursed.',
  });
  assert.deepEqual(warranty, {
    source: 'agreement',
    agreementId: 'agreement-1',
    months: 12,
    terms: 'Covers parts and labour.',
    reimbursementTerms: 'Water damage reimbursed.',
  });
});

test('buildJobWarranty falls back to the platform default when the agreement carries no usable terms', () => {
  const warranty = buildJobWarranty({ id: 'agreement-2', warrantyMonths: undefined, warrantyTerms: '  ', reimbursementTerms: null });
  assert.equal(warranty.source, 'agreement');
  assert.equal(warranty.agreementId, 'agreement-2');
  assert.equal(warranty.months, PLATFORM_WARRANTY_MONTHS);
  assert.equal(warranty.terms, null);
  assert.equal(warranty.reimbursementTerms, null);
});

test('buildJobWarranty returns the platform default when no agreement exists', () => {
  assert.deepEqual(buildJobWarranty({ id: null }), {
    source: 'platform_default',
    agreementId: null,
    months: PLATFORM_WARRANTY_MONTHS,
    terms: null,
    reimbursementTerms: null,
  });
});

test('warranty keys have matching legacy and namespace copies in every language', async () => {
  const keys = [
    'warrantyTitle', 'warrantyMonths', 'warrantyTerms', 'warrantyReimbursement',
    'warrantyNoTerms', 'warrantyPlatformDefault', 'warrantyPlatformNote', 'warrantyFileClaim',
  ];
  for (const language of ['en', 'es', 'fr', 'ht', 'ar']) {
    const legacy = JSON.parse(await readFile(new URL(`../src/locales/${language}.json`, import.meta.url)));
    const common = JSON.parse(await readFile(new URL(`../src/i18n/locales/${language}/common.json`, import.meta.url)));
    assert.equal(Object.keys(common.jobDetail).length, 59);
    for (const key of keys) {
      assert.ok(common.jobDetail[key]?.trim(), `${language} ${key}`);
      assert.equal(legacy.jobDetail[key], common.jobDetail[key], `${language} ${key}`);
    }
  }
});

test('JobDetailPage renders the warranty card for parties, with the claim routed to the agreement or to support', async () => {
  const page = await readFile(new URL('../src/pages/JobDetailPage.jsx', import.meta.url), 'utf8');
  // The card reads the shaped warranty from the by-job agreement fetch and
  // renders in the main column after the private-notes card.
  assert.match(page, /buildJobWarranty\(agreementInfo\)/);
  assert.match(page, /warrantyMonths: a\.warranty_months/);
  assert.match(page, /warrantyTerms: a\.warranty_terms/);
  assert.match(page, /reimbursementTerms: a\.reimbursement_terms/);
  assert.match(page, /jobDetail\.warrantyTitle/);
  assert.match(page, /jobDetail\.warrantyPlatformDefault/);
  assert.match(page, /jobDetail\.warrantyFileClaim/);
  // Agreement state: filing happens on the agreement page.
  assert.match(page, /to=\{`\/agreements\/\$\{warranty\.agreementId\}`\}/);
  // No-agreement state: the claim goes to support through the B7 handoff,
  // from the warranty card itself (not the separate Get help button above).
  const cardBlock = page.slice(page.indexOf('jobDetail.warrantyPlatformDefault'));
  assert.match(cardBlock.slice(0, 800), /buildBookingSupportHandoff\(\{ jobId: id/);
});
