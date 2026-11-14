import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve('src/admin/pages/super/PaymentDisputes.jsx'),
  'utf8',
);

function catalog(locale) {
  return JSON.parse(fs.readFileSync(path.resolve(`src/locales/${locale}.json`), 'utf8'));
}

// Domain 7 #20: the pager stranded the operator on an empty page when
// the total was an exact multiple of PAGE_SIZE: Next led to zero rows
// and the pager disappeared with it. The pager must always render when
// not loading, and the list endpoint total must drive it.
test('payment-disputes pager always renders when loaded and is driven by the server total', () => {
  assert.match(source, /total: body\?\.total \|\| 0/);
  assert.match(source, /offset \+ disputes\.length < total/);
  // The pager block itself must not be gated on a non-empty page; the
  // dispute-list block above it legitimately keeps its own length gate.
  assert.match(source, /\{!loading && !loadError && \(\s*<div className="flex items-center gap-3 mt-4">/);
  assert.doesNotMatch(source, /!loading && !loadError && disputes\.length > 0 && \(\s*<div className="flex items-center gap-3 mt-4">/);
  assert.match(source, /adminMoneyDisputes\.pageInfo', \{ count: disputes\.length, total \}/);
});

test('payment-disputes pageInfo catalog carries the total in every supported locale', () => {
  for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
    const pageInfo = catalog(locale).adminMoneyDisputes?.pageInfo;
    assert.ok(pageInfo, `${locale} missing adminMoneyDisputes.pageInfo`);
    assert.match(pageInfo, /\{\{count\}\}/, `${locale} pageInfo must interpolate {{count}}`);
    assert.match(pageInfo, /\{\{total\}\}/, `${locale} pageInfo must interpolate {{total}}`);
  }
});

// Domain 7 #16: the decision confirm showed only id and status, never
// the requested amount, so the confirming admin approved without
// re-seeing what was at stake; and a closing decision with neither a
// refund reference nor a no-refund reason only failed later with the
// server 400. The confirm must show the amount, and the client must
// pre-block the empty-fields case before the confirm opens.
test('payment-dispute confirm shows the requested amount', () => {
  assert.match(source, /amount: adminMoney\(Number\(selected\.requested_refund_cents \|\| 0\) \/ 100, selected\.currency_code \|\| 'USD'\)/);
  assert.match(source, /decideConfirmBody', \{[\s\S]*?amount:/);
});

test('payment-dispute closing decision is pre-blocked when both refund fields are empty', () => {
  assert.match(source, /setActionError\(t\('adminMoneyDisputes\.closureNeedsRefundOrReason'\)\)/);
});

test('payment-dispute decideConfirmBody catalog carries the amount in every supported locale', () => {
  for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
    const body = catalog(locale).adminMoneyDisputes?.decideConfirmBody;
    assert.ok(body, `${locale} missing adminMoneyDisputes.decideConfirmBody`);
    assert.match(body, /\{\{amount\}\}/, `${locale} decideConfirmBody must interpolate {{amount}}`);
  }
});
