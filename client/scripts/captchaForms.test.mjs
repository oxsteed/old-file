import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { captchaPayload, isCaptchaError } from '../src/utils/captcha.js';

// Every client form whose server route uses verifyCaptcha renders the shared
// TurnstileWidget only when the server enables the check, sends captchaToken,
// consumes the single-use token after each request, and recovers from
// expiry, widget errors, and a server that starts requiring the check.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('captcha helpers: payload only when enabled with a token; recognises verifyCaptcha errors', () => {
  assert.deepEqual(captchaPayload(false, 'tok'), {});
  assert.deepEqual(captchaPayload(true, ''), {});
  assert.deepEqual(captchaPayload(true, 'tok'), { captchaToken: 'tok' });
  assert.equal(isCaptchaError({ response: { data: { error: 'captcha_required' } } }), true);
  assert.equal(isCaptchaError({ response: { data: { error: 'captcha_failed' } } }), true);
  assert.equal(isCaptchaError({ response: { data: { error: 'validation_failed' } } }), false);
  assert.equal(isCaptchaError(undefined), false);
});

test('the shared hook reads the public config and exposes widget props with expiry and error handling', () => {
  const hook = read('../src/hooks/useCaptcha.js');
  assert.match(hook, /getCaptchaConfig/);
  assert.match(hook, /onExpire: \(\) => setToken\(''\)/);
  assert.match(hook, /onError: \(\) => \{ setToken\(''\); setFailed\(true\); \}/);
  assert.match(hook, /ref\.current\?\.reset\(\)/);
  assert.match(read('../src/api/captcha.js'), /api\.get\('\/auth\/captcha-config'\)/);
});

test('every verifyCaptcha route has a client form wired to the widget', () => {
  const serverRoutes = ['auth.js', 'careers.js', 'localDelivery.js'].map((file) => read(`../../server/routes/${file}`)).join('\n');
  const protectedRoutes = [...serverRoutes.matchAll(/router\.post\('([^']+)'[^\n]*verifyCaptcha/g)].map((m) => m[1]);
  assert.deepEqual(protectedRoutes.sort(), ['/check-email', '/openings/:id(\\\\d+)/guest-apply', '/public/estimate'].sort());

  const account = read('../src/components/registration/AccountForm.tsx');
  assert.match(account, /<TurnstileWidget \{\.\.\.captcha\.widgetProps\} \/>/);
  assert.match(account, /\{ captcha\.siteKey && \(|\{captcha\.siteKey && \(/);
  assert.match(account, /api\.post\('\/auth\/check-email', \{ email: form\.email\.trim\(\)\.toLowerCase\(\), \.\.\.captcha\.payload \}\)/);
  assert.match(account, /if \(captcha\.enabled\) captcha\.consume\(\)/);
  assert.match(account, /isCaptchaError\(err\)/);
  assert.match(account, /if \(!captcha\.enabled\) captcha\.reload\(\)/);

  const careers = read('../src/pages/CareerOpeningPage.jsx');
  assert.match(careers, /!user && captcha\.siteKey \?/);
  assert.match(careers, /startGuestApplication\(opening\.id, \{[^}]*\.\.\.captcha\.payload \}\)/);
  assert.match(careers, /if \(captcha\.enabled\) captcha\.consume\(\)/);
  assert.match(careers, /isCaptchaError\(err\)/);
  assert.match(careers, /if \(!captcha\.enabled\) captcha\.reload\(\)/);

  const delivery = read('../src/components/delivery/DeliveryEstimate.jsx');
  assert.match(delivery, /<TurnstileWidget/);
});

test('captcha copy for register and careers is in all 20 locales, translated in es, fr, ht and ar', () => {
  const dir = new URL('../src/locales/', import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  assert.equal(files.length, 20);
  const en = JSON.parse(readFileSync(new URL('en.json', dir), 'utf8'));
  for (const file of files) {
    const locale = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    for (const ns of ['register', 'careers']) {
      for (const key of ['label', 'required', 'failed', 'unavailable']) {
        assert.ok(locale[ns]?.captcha?.[key], `${file} ${ns}.captcha.${key}`);
        if (['es.json', 'fr.json', 'ht.json', 'ar.json'].includes(file)) assert.notEqual(locale[ns].captcha[key], en[ns].captcha[key], `${file} ${ns}.captcha.${key} translated`);
      }
    }
  }
});
