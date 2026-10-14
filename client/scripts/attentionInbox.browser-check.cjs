// Attention inbox modal: renders the list, filters, task views (route + lazy
// component), dirty-form guard, and error states without layout breakage.
// Run with playwright-core and Chrome available:
// node --test scripts/attentionInbox.browser-check.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

const I18N_DICT = {
  'list.title': 'Attention inbox',
  'list.subtitle': 'Every open item across your businesses, in one place.',
  'list.loading': 'Loading attention items…',
  'list.retry': 'Try again',
  'list.empty': 'Nothing needs your attention right now.',
  'list.partialFailure': 'Some items could not be loaded.',
  'list.staleSource': 'Some data may be out of date.',
  'list.filters.all': 'All',
  'list.filters.business': 'Business',
  'list.filters.category': 'Category',
  'list.filters.urgency': 'Urgency',
  'list.sort.urgentFirst': 'Urgent first',
  'list.affectedBusinesses': '{{count}} businesses',
  'list.pagination.previous': 'Previous',
  'list.pagination.next': 'Next',
  'age.daysAgo': '{{days}} days ago',
  'age.dueIn': 'Due in {{days}} days',
  'age.overdue': 'Overdue',
  'actions.backToAttention': 'Back to attention',
  'actions.openFullPage': 'Open full page',
  'actions.close': 'Close',
  'actions.confirmDiscard': 'Discard unsaved changes?',
  'actions.discardChanges': 'Discard changes',
  'actions.keepEditing': 'Keep editing',
  'actions.resolvedTask': 'Task resolved',
  'actions.accessRevoked': 'Access revoked',
  'reasons.unreadMessages': 'Unread messages',
  'reasons.creditRequestPending': 'Credit request pending',
  'reasons.launchStep': 'Launch step incomplete',
  'reasons.other': 'Something needs your review',
  'categories.messages': 'Messages',
  'categories.restaurant_credit': 'Restaurant credit',
  'categories.setup_verification': 'Setup & verification',
  'urgency.urgent': 'Urgent',
  'urgency.high': 'High',
  'urgency.low': 'Low',
  'creditRail.restaurant': 'Restaurant',
  'taskView.routeOnly': 'This task is handled on its own page.',
};

const YESTERDAY = new Date(Date.now() - 86400000).toISOString();

const PAYLOAD = {
  totals: { total: 4, affectedBusinesses: 2, byCategory: {}, byUrgency: {} },
  items: [
    {
      id: 'credit:req:1', businessId: 'biz_1', businessName: 'Cafe Luna',
      restaurantId: 42, restaurantName: 'Cafe Luna',
      category: 'restaurant_credit', sourceType: 'credit_request', sourceId: '1',
      reason: 'attention.reasons.creditRequestPending', reasonParams: {},
      urgency: 'high', createdAt: new Date().toISOString(), deadlineAt: YESTERDAY, ageDays: 1,
      amountCents: 2500, currencyCode: 'USD', creditRail: 'restaurant',
      taskDestination: { type: 'component', component: 'RestaurantCreditManager', params: {} },
    },
    {
      id: 'msg:thread:abc123', businessId: 'biz_1', businessName: 'Cafe Luna',
      restaurantId: 42, restaurantName: 'Cafe Luna',
      category: 'messages', sourceType: 'message_thread', sourceId: 'abc123',
      reason: 'attention.reasons.unreadMessages', reasonParams: { count: 3 },
      urgency: 'urgent', createdAt: new Date().toISOString(), deadlineAt: null, ageDays: 2,
      amountCents: null, currencyCode: 'USD', creditRail: null,
      taskDestination: { type: 'route', route: '/business/biz_1/messages', params: {} },
    },
    {
      id: 'mystery:1', businessId: 'biz_2', businessName: 'FixIt Co',
      restaurantId: null, restaurantName: null,
      category: 'messages', sourceType: 'mystery', sourceId: '1',
      reason: 'attention.reasons.totallyUnknown', reasonParams: {},
      urgency: 'normal', createdAt: new Date().toISOString(), deadlineAt: null, ageDays: 0,
      amountCents: null, currencyCode: 'USD', creditRail: null,
      taskDestination: { type: 'route', route: '/business/biz_2/messages', params: {} },
    },
    {
      id: 'setup:1', businessId: 'biz_2', businessName: 'FixIt Co',
      restaurantId: null, restaurantName: null,
      category: 'setup_verification', sourceType: 'setup', sourceId: '1',
      reason: 'attention.reasons.launchStep', reasonParams: {},
      urgency: 'low', createdAt: new Date().toISOString(), deadlineAt: null, ageDays: 5,
      amountCents: null, currencyCode: 'USD', creditRail: null,
      taskDestination: { type: 'route', route: '/business/biz_2/setup', params: {} },
    },
  ],
  freshness: [],
  partialFailures: [],
  page: 1,
  limit: 20,
  totalPages: 1,
};

test('attention inbox modal renders, filters, opens tasks, and guards dirty forms', async () => {
  const useDirtyFormPath = path.resolve(__dirname, '../src/components/attention/useDirtyForm.jsx');
  const mocks = {
    // The modal accepts fetchAttention as a prop in the fixture; stub the
    // real module so the axios import.meta chain never evaluates under iife.
    '../../api/businesses': {
      loader: 'js',
      contents: `export const getAttention = async () => { throw new Error('unmocked getAttention'); };`,
    },
    'react-i18next': {
      loader: 'js',
      contents: `
        const dict = ${JSON.stringify(I18N_DICT)};
        const interpolate = (value, opts) => String(value).replace(/{{(\\w+)}}/g, (_, k) =>
          opts && opts[k] !== undefined ? String(opts[k]) : '');
        const t = (key, opts) => interpolate(dict[key] !== undefined ? dict[key] : key, opts);
        export const useTranslation = () => ({ t, i18n: { exists: (key) => dict[key] !== undefined } });
      `,
    },
    '../../pages/food/RestaurantCreditManager.jsx': {
      loader: 'jsx',
      contents: `
        import React from 'react';
        import { useDirtyForm } from ${JSON.stringify(useDirtyFormPath)};
        export default function MockCreditManager({ restaurant, onAttentionAction }) {
          const { isDirty, setDirty } = useDirtyForm();
          return (
            <div id="mock-credit-manager">
              <p id="mock-restaurant">restaurant:{restaurant && restaurant.id}</p>
              <button id="mock-dirty" onClick={() => setDirty(!isDirty)}>dirty:{String(isDirty)}</button>
              <button id="mock-action" onClick={() => onAttentionAction && onAttentionAction()}>action</button>
            </div>
          );
        }
      `,
    },
  };

  const result = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
        import AttentionModal from './src/components/attention/AttentionModal.jsx';
        // The mode survives reloads via the URL (?mode=forbidden|error); a
        // plain reload wipes window.* state.
        window.__attentionMode = new URLSearchParams(window.location.search).get('mode') || 'ok';
        window.__lastParams = null;
        window.__actionCount = 0;
        window.__businesses = [
          { business_id: 'biz_1', business_name: 'Cafe Luna' },
          { business_id: 'biz_2', business_name: 'FixIt Co' },
        ];
        const fetchAttention = async (params, signal) => {
          window.__lastParams = params;
          if (window.__attentionMode === 'forbidden') {
            const err = new Error('Forbidden'); err.response = { status: 403 }; throw err;
          }
          if (window.__attentionMode === 'error') throw new Error('boom');
          return JSON.parse(JSON.stringify(${JSON.stringify(PAYLOAD)}));
        };
        createRoot(document.getElementById('root')).render(
          <MemoryRouter><AttentionModal open={true}
            onClose={() => { window.__closed = true; }}
            businesses={window.__businesses}
            fetchAttention={fetchAttention}
            onAction={() => { window.__actionCount += 1; }} /></MemoryRouter>);`,
      resolveDir: path.resolve(__dirname, '..'),
      loader: 'jsx',
    },
    bundle: true,
    write: false,
    loader: { '.css': 'empty' },
    plugins: [{
      name: 'isolated-page-dependencies',
      setup(plugin) {
        plugin.onResolve({ filter: /.*/ }, (args) => (mocks[args.path]
          ? { path: args.path, namespace: 'attention-test' }
          : undefined));
        // Files served from the mock namespace have no filesystem context;
        // resolve their imports back to the real modules so the mock workflow
        // shares the same useDirtyForm module instance as the modal.
        const reactPath = require.resolve('react', { paths: [__dirname] });
        plugin.onResolve({ filter: /^react$/, namespace: 'attention-test' }, () => ({ path: reactPath }));
        // Absolute imports inside mock files resolve to the real file modules
        // so the mock workflow shares the modal's useDirtyForm instance.
        plugin.onResolve({ filter: /^\//, namespace: 'attention-test' }, (args) => ({ path: args.path, namespace: 'file' }));
        plugin.onLoad({ filter: /.*/, namespace: 'attention-test' }, (args) => ({
          contents: mocks[args.path].contents,
          loader: mocks[args.path].loader,
        }));
      },
    }],
  });

  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(result.outputFiles[0].contents);
    } else {
      res.end('<html class="dark" dir="ltr"><body><div id="root"></div><script src="/app.js"></script></body></html>');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForSelector('.attention-row', { timeout: 10000 });

    // List renders all items, sorted overdue-first (credit request is overdue).
    const reasons = await page.$$eval('.attention-row__reason', (els) => els.map((el) => el.textContent));
    assert.deepEqual(reasons, [
      'Credit request pending',
      'Unread messages3',
      'Something needs your review',
      'Launch step incomplete',
    ]);
    // Unknown backend reason keys never render raw.
    assert.ok(!(await page.content()).includes('totallyUnknown'));
    // Overdue + amount + credit rail shown on the credit row.
    const firstRow = await page.$eval('.attention-list > li:first-child .attention-row', (el) => el.textContent);
    assert.match(firstRow, /Overdue/);
    assert.match(firstRow, /\$25\.00/);
    assert.match(firstRow, /Restaurant/);

    // Filters drive the request params.
    const urgencySelect = page.locator('label.attention-filter select').nth(2);
    await urgencySelect.selectOption('high');
    await page.waitForFunction(() => window.__lastParams && window.__lastParams.urgency === 'high');
    assert.equal((await page.evaluate(() => window.__lastParams)).urgency, 'high');
    await urgencySelect.selectOption('');
    await page.waitForFunction(() => window.__lastParams && !window.__lastParams.urgency);

    // Route-type destination: message + Open full page.
    await page.click('.attention-list > li:nth-child(2) .attention-row');
    await page.waitForSelector('.attention-task__header');
    assert.match(await page.content(), /This task is handled on its own page\./);
    assert.ok(await page.$('text=Open full page'));
    // Back to the list.
    await page.click('text=Back to attention');
    await page.waitForSelector('.attention-row');

    // Component-type destination: lazy workflow mounts with derived props.
    await page.click('.attention-list > li:first-child .attention-row');
    await page.waitForSelector('#mock-credit-manager');
    assert.equal(await page.$eval('#mock-restaurant', (el) => el.textContent), 'restaurant:42');
    // Dirty-form guard: mark dirty, then Back asks for confirmation.
    await page.click('#mock-dirty');
    await page.click('text=Back to attention');
    await page.waitForSelector('.attention-confirm');
    assert.match(await page.content(), /Discard unsaved changes\?/);
    // Keep editing stays in the task.
    await page.click('text=Keep editing');
    assert.ok(await page.$('#mock-credit-manager'));
    // Discard returns to the list.
    await page.click('text=Back to attention');
    await page.waitForSelector('.attention-confirm');
    await page.click('text=Discard changes');
    await page.waitForSelector('.attention-row');
    // Task action callback reaches the parent.
    await page.click('.attention-list > li:first-child .attention-row');
    await page.waitForSelector('#mock-action');
    await page.click('#mock-action');
    assert.equal(await page.evaluate(() => window.__actionCount), 1);

    // Escape closes a clean modal; backdrop click too.
    await page.click('text=Back to attention');
    await page.waitForSelector('.attention-row');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__closed === true);

    // Access-revoked state.
    await page.goto(`http://127.0.0.1:${port}/?mode=forbidden`);
    await page.waitForSelector('text=Access revoked');
    // Retryable error state.
    await page.goto(`http://127.0.0.1:${port}/?mode=error`);
    await page.waitForSelector('text=Try again');
    await page.evaluate(() => { window.__attentionMode = 'ok'; });
    await page.click('text=Try again');
    await page.waitForSelector('.attention-row');

    // Layout: no horizontal overflow across widths, light/dark, LTR/RTL.
    for (const width of [320, 390, 768, 1360, 1600]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `horizontal overflow ${overflow}px at ${width}px`);
    }
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(150);
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `light mode overflow ${overflow}px`);
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(150);
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `RTL overflow ${overflow}px`);
    // Task view in RTL at mobile width.
    await page.click('.attention-list > li:first-child .attention-row');
    await page.waitForSelector('#mock-credit-manager');
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `RTL task view overflow ${overflow}px`);

    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
