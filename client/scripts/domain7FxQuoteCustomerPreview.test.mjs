// Domain 7 #11: the FX quote page must resolve and show the customer
// display name next to the id field before the confirm enables, and the
// maker confirm must show the concrete quote terms.
//
// Run: node --test scripts/domain7FxQuoteCustomerPreview.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(
  path.join(root, 'src', 'admin', 'pages', 'super', 'oxsteedCredit', 'CurrencyQuotesPage.jsx'),
  'utf8',
);

test('customer name is looked up from the admin endpoint, not the customer-role one', () => {
  assert.match(
    page,
    /adminApi\.get\(`\/admin\/super\/oxsteed-credit\/customers\/\$\{encodeURIComponent\(/,
    'no admin-side customer lookup call',
  );
  assert.doesNotMatch(page, /getOxsteedCreditTransferRecipient/, 'page still uses the customer-role recipient lookup');
});

test('resolved name is shown next to the id field', () => {
  assert.match(page, /customerResolved/, 'resolved customer name is never rendered');
  assert.match(page, /displayName/, 'no displayName is rendered for the customer');
});

test('quote creation is blocked until the name resolves for the exact id', () => {
  const create = page.slice(page.indexOf('const createQuote'));
  assert.match(create, /customerRequiredResolved/, 'no unresolved-customer error gates quote creation');
  assert.match(create, /if \(!recipientOk\)/, 'createQuote never checks the resolved-recipient gate');
  assert.match(
    page,
    /const recipientOk = recipient\s*&& String\(recipient\.customerId\) === customerId\.trim\(\)\s*&& Boolean\(recipient\.displayName\)/,
    'recipient gate does not require a display name for the exact id entered',
  );
});

test('maker confirm shows the concrete quote terms', () => {
  assert.match(page, /confirmDescriptionLive/, 'live-mode confirm has no concrete terms');
  assert.match(page, /confirmDescriptionManual/, 'manual-mode confirm has no concrete terms');
  assert.doesNotMatch(
    page,
    /description: t\('adminCurrencyQuotes\.confirmDescription'\)/,
    'confirm still uses the generic description with no terms',
  );
});

test('quote detail shows the resolved name instead of a bare id', () => {
  assert.match(page, /customerDisplayName/, 'QuoteDetail never receives a display name');
});
