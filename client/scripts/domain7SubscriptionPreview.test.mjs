// Domain 7 #6: subscription cancel must preview the subscription (user,
// plan, status, amount) before the confirm can proceed, and the confirm
// must stay disabled until a preview for the exact id entered has loaded.
//
// Run: node --test scripts/domain7SubscriptionPreview.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(
  path.join(root, 'src', 'admin', 'pages', 'super', 'SubscriptionsAdminPage.jsx'),
  'utf8',
);

test('page looks the subscription up before confirming', () => {
  assert.match(
    page,
    /adminApi\.get\(`\/admin\/super\/subscriptions\/\$\{encodeURIComponent\(/,
    'no subscription lookup call before confirm',
  );
});

test('preview shows user, plan, status and amount', () => {
  for (const field of ['userDisplayName', 'planName', 'amountCents']) {
    assert.ok(page.includes(field), `preview never renders ${field}`);
  }
  assert.match(page, /resultStatus|previewStatus/, 'preview never renders status');
});

test('confirm stays disabled until a preview for the exact id entered loads', () => {
  assert.match(page, /confirmDisabled/, 'ConfirmDialog is never given confirmDisabled');
  assert.match(
    page,
    /previewMatchesId = preview && String\(preview\.id\) === subscriptionId\.trim\(\)/,
    'no exact-id match check defines the preview gate',
  );
  assert.match(page, /confirmDisabled=\{!previewMatchesId/, 'confirmDisabled is not tied to the exact-id preview match');
  assert.match(
    page,
    /if \(!preview \|\| String\(preview\.id\) !== id\)/,
    'cancelSubscription has no exact-id preview guard before the step-up',
  );
});

test('cancel refuses to issue a step-up without a matching preview', () => {
  const cancel = page.slice(page.indexOf('const cancelSubscription'));
  assert.match(cancel, /preview/, 'cancelSubscription never consults the preview');
  assert.match(cancel, /stepup-challenges/, 'cancelSubscription lost its step-up');
});
