import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

// Delivery estimate gaps: price range headline, sample route preview before
// an estimate, and the public /delivery hero with the estimate card.

const apiMock = `
  export const estimateDelivery = async () => ({});
  export const estimateDeliveryPublic = async () => ({});
  export const getDeliveryPublicCaptchaConfig = async () => null;
  export const getCustomerTrackingState = async () => ({});
  export const deliveryMoney = (cents) => '$' + (cents / 100).toFixed(2);
  export const deliveryUnit = (value, unit) => value + ' ' + unit;
  export const deliveryError = () => 'error';
`;
const mocks = {
  'react-i18next': `export const useTranslation = () => ({
    t: (key, values) => values ? key + JSON.stringify(values) : key,
    i18n: { language: 'en', dir: () => 'ltr' },
  });`,
  '../components/PageShell': `export default ({ children }) => <div>{children}</div>;`,
  '../components/PageMeta': `export default () => null;`,
  '../AddressAutocomplete': `export default ({ ariaLabel }) => <input aria-label={ariaLabel} />;`,
  '../api/delivery': apiMock,
  '../../api/delivery': apiMock,
};

async function load() {
  const result = await build({
    stdin: {
      contents: `import React from 'react';
        import { renderToString } from 'react-dom/server';
        import { MemoryRouter } from 'react-router-dom';
        import DeliveryLandingPage from './src/pages/DeliveryLandingPage.jsx';
        import * as estimate from './src/components/delivery/DeliveryEstimate.jsx';
        export const renderLanding = () => renderToString(<MemoryRouter><DeliveryLandingPage /></MemoryRouter>);
        import TurnstileWidget, { loadTurnstile, TURNSTILE_SCRIPT_SRC } from './src/components/TurnstileWidget.jsx';
        export const renderCard = (props) => renderToString(<estimate.EstimateCard t={(k) => k} onContinue={() => {}} {...props} />);
        export const renderWidget = (props) => renderToString(<TurnstileWidget {...props} />);
        export { loadTurnstile, TURNSTILE_SCRIPT_SRC };
        export const renderPrice = (props) => renderToString(<estimate.EstimatePrice t={(k, v) => v ? k + JSON.stringify(v) : k} {...props} />);
        export { estimate };`,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'jsx',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/*', 'react-router-dom', 'lucide-react'],
    loader: { '.css': 'empty' },
    define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'delivery-estimate-mocks', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, ({ path }) => (mocks[path] ? { path, namespace: 'delivery-test' } : undefined));
      plugin.onLoad({ filter: /.*/, namespace: 'delivery-test' }, ({ path }) => ({ contents: mocks[path], loader: 'jsx' }));
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports;
}

const loaded = load();

test('signed-out /delivery renders the hero, the estimate card, and a labelled sample route preview', async () => {
  const html = (await loaded).renderLanding();
  assert.match(html, /delivery\.title/);
  assert.match(html, /delivery\.hero\.step1/);
  assert.match(html, /delivery-estimate-card/);
  assert.match(html, /aria-label="delivery\.customer\.pickup"/);
  assert.match(html, /aria-label="delivery\.customer\.dropoff"/);
  assert.match(html, /data-sample="true"/);
  assert.match(html, /delivery\.routePreview\.sample(?!Label)/);
  assert.match(html, /aria-label="delivery\.routePreview\.sampleLabel"/);
  // No estimate yet: nothing to book, so no sign-in-to-book button.
  assert.doesNotMatch(html, /delivery\.estimate\.signInToBook/);
  // The FAQ and the rest of the landing page are still there.
  assert.match(html, /deliveryLanding\.faqTitle/);
});

test('the price headline shows a standard-to-rush range, or one price when they match', async () => {
  const { renderPrice } = await loaded;
  const estimate = { pricing: { currency: 'USD', cents: { customerTotal: 1799 } }, sizePrices: {
    small: { customerTotalCents: 1799, range: { minCents: 1799, maxCents: 1799 } },
    large: { customerTotalCents: 2399, range: { minCents: 2399, maxCents: 3176 } },
  } };
  const ranged = renderPrice({ estimate, size: 'large' });
  assert.match(ranged, /delivery\.estimate\.priceRange\{&quot;min&quot;:&quot;\$23\.99&quot;,&quot;max&quot;:&quot;\$31\.76&quot;\}/);
  assert.match(ranged, /delivery\.estimate\.rangeNote/);
  assert.match(ranged, /<bdi>/);
  const single = renderPrice({ estimate, size: 'small' });
  assert.match(single, /\$17\.99/);
  assert.doesNotMatch(single, /priceRange\{|rangeNote/);
});

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

test('a signed-out estimate survives sign-in once, and expires after 30 minutes', async () => {
  const { estimate } = await loaded;
  const prefill = { originText: 'A St', destinationText: 'B St', packageType: 'medium', weightLbs: '25' };
  const storage = memoryStorage();
  assert.equal(estimate.storeEstimatePrefill(prefill, storage, 1000), true);
  assert.deepEqual(estimate.takeEstimatePrefill(storage, 2000), prefill);
  assert.equal(estimate.takeEstimatePrefill(storage, 3000), null, 'consumed once');
  estimate.storeEstimatePrefill(prefill, storage, 0);
  assert.equal(estimate.takeEstimatePrefill(storage, 31 * 60 * 1000), null, 'expired');
  estimate.storeEstimatePrefill({ ...prefill, packageType: 'freight' }, storage, 0);
  assert.equal(estimate.takeEstimatePrefill(storage, 1), null, 'invalid size rejected');
  storage.setItem(estimate.ESTIMATE_PREFILL_KEY, '{not json');
  assert.equal(estimate.takeEstimatePrefill(storage, 1), null);
});

test('the new estimate copy is in all 20 locale files and translated in es, fr, ht and ar', () => {
  const dir = new URL('../src/locales/', import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  assert.equal(files.length, 20);
  const read = (name) => JSON.parse(readFileSync(new URL(name, dir), 'utf8')).delivery;
  const en = read('en.json');
  const keys = [['estimate', 'priceRangeLabel'], ['estimate', 'priceRange'], ['estimate', 'rangeNote'], ['estimate', 'standardTotal'],
    ['estimate', 'signInToBook'], ['estimate', 'signInNote'], ['routePreview', 'sample'], ['routePreview', 'sampleLabel']];
  for (const file of files) {
    const locale = read(file);
    for (const [group, key] of keys) {
      assert.ok(typeof locale[group]?.[key] === 'string' && locale[group][key].length, `${file} ${group}.${key}`);
    }
    assert.match(locale.estimate.priceRange, /\{\{min\}\}.*\{\{max\}\}/, file);
  }
  for (const file of ['es.json', 'fr.json', 'ht.json', 'ar.json']) {
    const locale = read(file);
    for (const [group, key] of [['estimate', 'rangeNote'], ['estimate', 'signInToBook'], ['routePreview', 'sample']]) {
      assert.notEqual(locale[group][key], en[group][key], `${file} ${group}.${key} is translated`);
    }
  }
});

test('the public estimate card sends signed-out visitors to sign in with the estimate kept', () => {
  const source = readFileSync(new URL('../src/pages/DeliveryLandingPage.jsx', import.meta.url), 'utf8');
  assert.match(source, /requestEstimate=\{estimateDeliveryPublic\}/);
  assert.match(source, /storeEstimatePrefill\(prefill\)/);
  assert.match(source, /navigate\(`\/login\?next=\$\{encodeURIComponent\('\/delivery'\)\}`\)/);
  const page = readFileSync(new URL('../src/pages/DeliveryPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /takeEstimatePrefill\(\)/);
});

test('the estimate card renders the Turnstile widget only when the server enables the bot check', async () => {
  const { renderCard, renderWidget } = await loaded;
  const off = renderCard({});
  assert.doesNotMatch(off, /turnstile-widget|delivery\.captcha\.label/);
  const disabled = renderCard({ captcha: { enabled: false, siteKey: null } });
  assert.doesNotMatch(disabled, /turnstile-widget/);
  const on = renderCard({ captcha: { enabled: true, provider: 'turnstile', siteKey: 'site-key' } });
  assert.match(on, /data-testid="turnstile-widget"/);
  assert.match(on, /delivery\.captcha\.label/);
  assert.equal(renderWidget({ siteKey: '' }), '');
});

test('the Turnstile script loads once and a failed load can be retried', async () => {
  const { loadTurnstile, TURNSTILE_SCRIPT_SRC } = await loaded;
  const appended = [];
  const doc = { createElement: () => ({}), head: { appendChild: (node) => appended.push(node) } };
  const win = {};
  const first = loadTurnstile(doc, win);
  assert.equal(loadTurnstile(doc, win), first, 'one in-flight load');
  assert.equal(appended.length, 1);
  assert.equal(appended[0].src, TURNSTILE_SCRIPT_SRC);
  appended[0].onerror();
  await assert.rejects(first, /turnstile_unavailable/);
  const retry = loadTurnstile(doc, win);
  assert.equal(appended.length, 2, 'a failed load is retried');
  win.turnstile = { render: () => 'id' };
  appended[1].onload();
  assert.equal(await retry, win.turnstile);
  assert.equal(await loadTurnstile(doc, win), win.turnstile);
});

test('the public estimate sends the token, resets the single-use widget, and asks again on expiry or rejection', () => {
  const card = readFileSync(new URL('../src/components/delivery/DeliveryEstimate.jsx', import.meta.url), 'utf8');
  assert.match(card, /captchaOn \? \{ captchaToken \} : \{\}/);
  assert.match(card, /captchaRef\.current\?\.reset\(\)/);
  assert.match(card, /onExpire=\{\(\) => setCaptchaToken\(''\)\}/);
  assert.match(card, /captcha_required' \|\| captchaCode === 'captcha_failed'/);
  const landing = readFileSync(new URL('../src/pages/DeliveryLandingPage.jsx', import.meta.url), 'utf8');
  assert.match(landing, /getDeliveryPublicCaptchaConfig\(\)/);
  assert.match(landing, /onCaptchaRequired=\{loadCaptcha\}/);
  const dir = new URL('../src/locales/', import.meta.url);
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const captcha = JSON.parse(readFileSync(new URL(file, dir), 'utf8')).delivery.captcha;
    for (const key of ['label', 'required', 'failed', 'unavailable']) assert.ok(captcha?.[key], `${file} delivery.captcha.${key}`);
  }
});
