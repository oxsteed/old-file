// Browser-level smoke coverage for the read-only admin command center.
// Run with: node --test scripts/adminOperations.browser-check.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

const operationsData = {
  generated_at: '2026-09-29T12:00:00.000Z',
  sections: {
    delivery: { key: 'delivery', available: true, route: '/delivery/operations', statuses: { available: true, total: 2, statuses: { posted: 1, delivered: 1 } }, openIssues: { available: true, count: 1 }, pendingEvents: { available: true, count: 0 } },
    jobs: { key: 'jobs', available: true, route: '/admin/jobs', statuses: { available: true, total: 3, statuses: { published: 2, completed: 1 } } },
    orders: { key: 'orders', available: true, route: '/admin/orders', statuses: { available: true, total: 4, statuses: { preparing: 2, completed: 2 } } },
    support: { key: 'support', available: true, route: '/admin/support', tickets: { available: true, total: 2, statuses: { open: 2 } }, queue: { available: true, total: 1, statuses: { waiting: 1 } } },
    payments: { key: 'payments', available: true, route: '/admin/payments', statuses: { available: true, total: 5, statuses: { succeeded: 5 } } },
    disputes: { key: 'disputes', available: true, route: '/admin/disputes', statuses: { available: true, total: 1, statuses: { open: 1 } } },
    queues: { key: 'queues', available: true, route: '/admin/support/metrics', queue: { available: true, total: 1, statuses: { waiting: 1 } } },
    integrations: { key: 'integrations', available: true, route: '/admin/super/settings', connected: { available: true, count: 1 } },
    credit: { key: 'credit', available: false, reason: 'permission_required', permission: 'super_admin' },
    sla: { key: 'sla', available: true, route: '/admin/support/sla', conversations: { available: true, total: 2, statuses: { open: 2 } }, openBreaches: { available: true, count: 1 } },
    risk: { key: 'risk', available: true, route: '/admin/reports/dashboard', openIncidents: { available: true, count: 0 } },
    dataGovernance: { key: 'dataGovernance', available: true, route: '/admin/legal/ccpa-requests', privacy: { available: true, total: 1, statuses: { pending: 1 } } },
    changeControl: { key: 'changeControl', available: true, route: '/admin/super/audit-log', changes24h: { available: true, count: 2 }, enabledFlags: { available: true, count: 1 } },
    observability: { key: 'observability', available: true, route: '/admin/reports/dashboard', openIncidents: { available: true, count: 0 } },
    crm: { key: 'crm', available: true, route: '/admin/businesses', leads: { available: true, total: 2, statuses: { new: 2 } } },
  },
};
for (const [key, section] of Object.entries(operationsData.sections)) {
  section.correlation_id = 'unknown';
  section.source = key === 'delivery' ? 'delivery_jobs' : `${key}_source`;
}

test('admin operations command center renders, respects grants, and recovers from errors', async () => {
  const mocks = {
    'react-i18next': `const t = (key, options = {}) => {
      let value = options.defaultValue || key;
      return String(value).replace(/\\{\\{(\\w+)\\}\\}/g, (_, name) => options[name] ?? '');
    };
    export const useTranslation = () => ({ t });`,
    '../../lib/adminApi': `export default { get: async () => {
      if (window.adminOperationsMode === 'error') throw new Error('mock load failed');
      return { data: window.adminOperationsData };
    }};`,
    '../lib/GrantGuard': `export const useHasGrant = grant => ({ loading: false, allowed: (window.adminScopes || []).includes(grant) });`,
  };
  const result = await build({
    stdin: {
      contents: `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { BrowserRouter } from 'react-router-dom';
        import Page from './src/admin/pages/OperationsOverview.jsx';
        window.adminOperationsData = ${JSON.stringify(operationsData)};
        window.adminOperationsMode = 'success';
        window.adminScopes = [];
        createRoot(document.getElementById('root')).render(<BrowserRouter><Page /></BrowserRouter>);`,
      resolveDir: path.resolve(__dirname, '..'),
      loader: 'jsx',
    },
    bundle: true,
    write: false,
    loader: { '.css': 'empty' },
    plugins: [{ name: 'isolated-admin-operations-dependencies', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => mocks[args.path]
        ? { path: args.path, namespace: 'admin-operations-test' }
        : undefined);
      plugin.onLoad({ filter: /.*/, namespace: 'admin-operations-test' }, args => ({ contents: mocks[args.path], loader: 'js' }));
    }}],
  });

  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(result.outputFiles[0].contents);
      return;
    }
    res.end('<div id="root"></div><script type="module" src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#operations-title').waitFor();
    await page.getByText('adminOperations.deliveryTitle').waitFor();

    assert.equal(await page.locator('section[aria-labelledby="operations-title"]').count(), 1);
    assert.equal(await page.locator('a[href="/admin/payments"]').count(), 0, 'financial link must stay hidden without its grant');
    assert.equal(await page.locator('a[href="/admin/orders"]').count(), 1);
    assert.equal(await page.locator('code').filter({ hasText: 'delivery_jobs' }).count(), 1);
    assert.equal(await page.getByText('adminOperations.correlationId').count(), 15);
    assert.equal(await page.locator('[role="alert"]').count(), 0);
    assert.equal(await page.locator('article').count(), 15);

    await page.evaluate(() => { window.adminOperationsMode = 'error'; });
    await page.getByRole('button', { name: 'adminOperations.refresh' }).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /adminOperations\.loadError/);

    await page.evaluate(() => { window.adminOperationsMode = 'success'; });
    await page.getByRole('button', { name: 'adminOperations.retry' }).click();
    await page.getByText('adminOperations.deliveryTitle').waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
