// Nov 10 #3 (STILL LIVE, PARTIAL): the transfer panel renders on
// accountStatus === 'active' only; only the limits row is gated on
// transfers.enabled. The whole transfer panel must be gated on
// transfers.enabled, so a disabled transfer rail never shows a transfer form.
//
// Domain 1 audit finding 3 (Nov 10, 2026): the credit transfer form
// rendered for every active account although customer transfers are off by
// default (server 403s at submit). The form must render only when the
// limits summary says transfers are enabled, and must not flash or crash
// while that summary is still loading (limitSummary starts null).
//
// Run: node --test scripts/creditTransferGate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pagePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/pages/food/OxsteedCreditPage.jsx',
);
const src = readFileSync(pagePath, 'utf8');

// The transfer panel render site, extracted once for every test below.
const transferPanel = src.match(
  /\{accountStatus === 'active' && [^}]*<section className="ox-credit-panel ox-credit-transfer-panel"/,
);
assert.ok(transferPanel, 'transfer panel render site not found');

test('the transfer panel renders only when transfers are enabled', () => {
  assert.match(
    transferPanel[0],
    /accountStatus === 'active' && limitSummary\?\.transfers\?\.enabled && <section className="ox-credit-panel ox-credit-transfer-panel"/,
    'transfer panel is gated on transfers.enabled',
  );
  // No ungated render of the transfer panel left anywhere.
  assert.doesNotMatch(
    src,
    /\{accountStatus === 'active' && <section className="ox-credit-panel ox-credit-transfer-panel"/,
  );
});

test('the limits row stays gated on transfers.enabled', () => {
  assert.match(src, /\{limitSummary\.transfers\.enabled && <><div><span>\{t\('transferAmountRemaining'\)\}/);
});

test('transfer form renders only when the limits summary enables transfers', () => {
  assert.match(
    transferPanel[0],
    /limitSummary\?\.transfers\?\.enabled/,
    'transfer panel must be gated on limitSummary.transfers.enabled',
  );
});

test('the transfer panel lives in the Send drawer, not on the page body', () => {
  // Credit redesign (D-806): the panel moved into the Send drawer. The
  // gate above still applies at the render site; this pins the move so
  // the panel cannot silently drift back onto the page body.
  const sendDrawerStart = src.indexOf(`open={activeDrawer === 'send'}`);
  assert.ok(sendDrawerStart >= 0, 'Send drawer not found');
  const nextDrawer = src.indexOf('<CreditDrawer', sendDrawerStart + 1);
  const sendDrawer = src.slice(sendDrawerStart, nextDrawer === -1 ? undefined : nextDrawer);
  assert.match(sendDrawer, /ox-credit-transfer-panel/, 'transfer panel must render inside the Send drawer');
  const pageBody = src.slice(0, src.indexOf(`open={activeDrawer === 'topup'}`));
  assert.doesNotMatch(pageBody, /ox-credit-transfer-panel/, 'transfer panel must not render in the page body');
});

test('transfer gate is null-safe while the limits summary loads', () => {
  // limitSummary starts null; a bare limitSummary.transfers.enabled read
  // would throw on first render. Optional chaining keeps the form hidden
  // (not crashed, not flashed) until the summary arrives.
  assert.match(
    transferPanel[0],
    /limitSummary\?\./,
    'transfer gate must tolerate a null limitSummary',
  );
  assert.doesNotMatch(
    transferPanel[0],
    /limitSummary\.transfers\.enabled/,
    'transfer gate must not dereference a possibly-null limitSummary',
  );
});
