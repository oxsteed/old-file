// Mobile/PWA M9: OTP/TOTP inputs need mobile affordances (numeric keypad,
// SMS code autofill) and VerifyEmail resend needs a cooldown so rapid
// re-taps cannot re-POST /auth/otp/request.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

function inputBlock(src, idPattern) {
  const idx = src.search(idPattern);
  assert.ok(idx >= 0, `input not found: ${idPattern}`);
  return src.slice(idx, src.indexOf('/>', idx) + 2);
}

test('M9: login 2FA input has numeric keypad, SMS autofill, and length cap', () => {
  const src = fs.readFileSync(path.join(root, '../src/pages/Login.jsx'), 'utf8');
  const input = inputBlock(src, /id="two-factor-code"/);
  assert.match(input, /autoComplete="one-time-code"/);
  assert.match(input, /inputMode="numeric"/, '2FA input must summon the numeric keypad');
  assert.match(input, /maxLength=\{6\}/, '2FA input must cap at 6 digits');
});

test('M9: VerifyEmail OTP input has numeric keypad and SMS autofill', () => {
  const src = fs.readFileSync(path.join(root, '../src/pages/VerifyEmailPage.tsx'), 'utf8');
  const input = inputBlock(src, /value=\{otp\}/);
  assert.match(input, /maxLength=\{6\}/);
  assert.match(input, /inputMode="numeric"/, 'OTP input must summon the numeric keypad');
  assert.match(input, /autoComplete="one-time-code"/, 'OTP input must offer the SMS code above the keyboard');
});

test('M9: VerifyEmail resend has a 60s cooldown with visible countdown', () => {
  const src = fs.readFileSync(path.join(root, '../src/pages/VerifyEmailPage.tsx'), 'utf8');
  assert.match(src, /RESEND_COOLDOWN_SECONDS = 60/, 'resend cooldown must be 60s');
  assert.match(src, /resendCooldown/, 'page must track remaining cooldown seconds');
  assert.match(src, /handleRequestOTP[\s\S]*?resendCooldown > 0/, 'request handler must refuse while cooling down');
  assert.match(src, /disabled=\{loading \|\| resendCooldown > 0\}/, 'send button must stay disabled during cooldown');
  assert.match(src, /verifyEmail\.resendIn/, 'button must show the remaining cooldown time');
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const locales = JSON.parse(fs.readFileSync(path.join(root, `../src/locales/${lang}.json`), 'utf8'));
    assert.ok(locales.verifyEmail?.resendIn, `missing verifyEmail.resendIn in ${lang}`);
  }
});
