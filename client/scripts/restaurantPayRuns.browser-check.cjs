// Browser-level coverage for the Phase 5 merchant pay-run flow in
// RestaurantPayrollPanel: the pay-run list (draft + finalized), the
// detail view with tip-out/in lines and disbursement coverage, the
// maker-checker approve step (a finalized run shows "Not approved
// yet" until a second approver acts), the provider export, the
// create form, and per-line disbursement recording with the amount
// taken from the line total (never typed by the operator).
//
// The panel is rendered directly with the real i18n catalog; the
// restaurants API module and the operations context are stubbed.
// The shell must mount without page errors.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const restaurantsApi = fs.readFileSync(path.join(root, 'src/api/restaurants.js'), 'utf8');
const exportsList = [...restaurantsApi.matchAll(/export const (\w+)/g)].map((m) => m[1]);
const mockApi = `function reply(name, args) {
  window.calls.push({ name, args });
  const v = window.fx[name];
  if (v && v.error) {
    const err = new Error('synthetic error');
    err.response = { status: v.status || 503, data: { code: v.error } };
    return Promise.reject(err);
  }
  return Promise.resolve(v ?? null);
}\n` + exportsList.map((name) => {
  if (name === 'downloadPayrollCsv' || name === 'downloadPayRunCsv') {
    return `export const ${name} = (...args) => { window.calls.push({ name: '${name}', args }); return Promise.resolve(new Blob(['employee_name\\n'], { type: 'text/csv' })); };`;
  }
  return `export const ${name} = (...args) => reply('${name}', args);`;
}).join('\n');

const mockContext = `export const useOperationStore = () => ({ locationId: 1, brandAccess: true, store: { timezone: 'America/New_York' } });
export const OperationStorePicker = () => null;
export const permits = () => true;
export const requestIdentity = () => 'fixture-key';
`;

const catalogs = { en: { translation: JSON.parse(fs.readFileSync(path.join(root, 'src/locales/en.json'), 'utf8')) } };

const draftRun = {
  id: 11, period_from: '2026-10-01', period_to: '2026-10-15', status: 'draft',
  totals: { total_pay_cents: 26000, currency: 'USD' }, line_count: 2,
  approved_by: null, approved_at: null, linkedPayoutCents: 0,
};
const finalizedRun = {
  id: 12, period_from: '2026-10-01', period_to: '2026-10-15', status: 'finalized',
  totals: { total_pay_cents: 26000, currency: 'USD' }, line_count: 2,
  approved_by: null, approved_at: null, linkedPayoutCents: 0,
  lines: [
    {
      id: 101, staff_user_id: 'user-ana', staff_label: 'Ana', regular_hours: 10,
      overtime_hours: 0, doubletime_hours: 0, hourly_wage_cents: 1500,
      regular_wages_cents: 15000, overtime_wages_cents: 0, doubletime_wages_cents: 0,
      wages_cents: 15000, meal_break_premium_cents: 0, predictability_premium_cents: 0,
      gross_tips_cents: 2000, tip_out_cents: 500, tip_in_cents: 0, net_tips_cents: 1500,
      total_pay_cents: 17000,
    },
    {
      id: 102, staff_user_id: 'user-ben', staff_label: 'Ben', regular_hours: 5,
      overtime_hours: 0, doubletime_hours: 0, hourly_wage_cents: 1800,
      regular_wages_cents: 9000, overtime_wages_cents: 0, doubletime_wages_cents: 0,
      wages_cents: 9000, meal_break_premium_cents: 0, predictability_premium_cents: 0,
      gross_tips_cents: 0, tip_out_cents: 0, tip_in_cents: 0, net_tips_cents: 0,
      total_pay_cents: 9000,
    },
  ],
  disbursements: [],
  disbursementCoverage: {
    run_total_cents: 26000, disbursed_cents: 0, lines_total: 2, lines_covered: 0, fully_covered: false,
  },
};
const approvedRun = {
  ...finalizedRun,
  approved_by: 'user-checker',
  approved_at: '2026-10-16T12:00:00.000Z',
};
const paidRun = {
  ...approvedRun,
  status: 'paid',
  disbursements: [
    { id: 1, payRunLineId: 101, staff_user_id: 'user-ana', staff_label: 'Ana', amountCents: 17000, currencyCode: 'USD', method: 'bank_transfer', reference: 'ACH-1', note: null, recordedBy: 'user-owner', recordedAt: '2026-10-16T12:00:00.000Z' },
    { id: 2, payRunLineId: 102, staff_user_id: 'user-ben', staff_label: 'Ben', amountCents: 9000, currencyCode: 'USD', method: 'provider_export', reference: 'GUSTO-7', note: null, recordedBy: 'user-owner', recordedAt: '2026-10-16T12:00:00.000Z' },
  ],
  disbursementCoverage: {
    run_total_cents: 26000, disbursed_cents: 26000, lines_total: 2, lines_covered: 2, fully_covered: true,
  },
};

test('merchant pay runs: list, approve, provider export, disbursement', { timeout: 180000 }, async () => {
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'jsx',
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
        import i18n from 'i18next'; import { initReactI18next } from 'react-i18next';
        import { PayrollPanel } from './src/pages/food/RestaurantPayrollPanel.jsx';
        i18n.use(initReactI18next).init({ lng: 'en', resources: window.catalogs, interpolation: { escapeValue: false } });
        window.i18n = i18n;
        const root = createRoot(document.getElementById('root'));
        window.render = (props) => root.render(<PayrollPanel t={i18n.t.bind(i18n)} {...props} />);
        window.React = React;`,
    },
    bundle: true,
    write: false,
    outdir: 'fixture',
    format: 'esm',
    loader: { '.css': 'css' },
    define: { 'import.meta.env': '{}' },
    plugins: [{
      name: 'payruns-fixture',
      setup(b) {
        b.onResolve({ filter: /api\/restaurants$/ }, () => ({ path: 'restaurants', namespace: 'fixture' }));
        b.onResolve({ filter: /restaurantOperationsContext$/ }, () => ({ path: 'operations-context', namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: args.path === 'restaurants' ? mockApi : mockContext,
          loader: 'js',
        }));
      },
    }],
  });
  const js = bundle.outputFiles.find((f) => f.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find((f) => f.path.endsWith('.css'))?.text || '';
  const baseCss = fs.readFileSync(path.join(root, 'src/styles/FoodPages.css'), 'utf8');
  const server = http.createServer((req, res) => {
    if (req.url === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(js); }
    else {
      res.end(`<html><head><style>:root{--primary-color:#9a3412;--app-text:#142036;--muted-text:#475569;--card-bg:#fff;--border-color:#dbe3ef;--soft-bg:#f1f5f9}html{font-family:Arial;background:#f7f9fc}body{margin:0}#root{max-width:1200px;margin:auto;padding:16px}*{box-sizing:border-box}${baseCss}\n${css}</style></head><body><div id="root"></div><script>window.catalogs=${JSON.stringify(catalogs)};window.fx={};window.calls=[];</script><script type="module" src="/fixture.js"></script></body></html>`);
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.render);
    const restaurant = { id: 2, business_id: 3, currency_code: 'USD', display_name: 'Synthetic restaurant', timezone: 'America/New_York' };
    const labor = {
      labor_percent: 22, labor_cost_cents: 24000, revenue_cents: 110000,
      total_hours: 15, scheduled_hours: 15, sales_per_labor_hour_cents: 7333,
      missing_wage_user_ids: [],
      employees: [{ user_id: 'user-ana', name: 'Ana', job_role: 'Server', hours: 10, wages_cents: 15000, net_tips_cents: 1500, total_pay_cents: 17000 }],
    };
    const baseFx = {
      getLaborReport: labor,
      getExceptionsReport: { employees: [] },
      getTeamActivity: { entries: [], actors: [], total: 0 },
      getTipPoolSettings: { pooling_enabled: false, tip_out_rules: [] },
      listPayRuns: { payRuns: [draftRun, finalizedRun], total: 2, limit: 20, offset: 0 },
      getPayRun: finalizedRun,
      createPayRun: draftRun,
      approvePayRun: approvedRun,
      recordPayRunDisbursement: paidRun,
    };
    await page.evaluate(({ fx, props }) => {
      window.fx = fx;
      window.calls = [];
      window.render(props);
    }, { fx: baseFx, props: { restaurant, from: '2026-10-01', to: '2026-10-15' } });

    await page.getByText('Pay runs', { exact: true }).waitFor();
    await page.getByText('Draft', { exact: true }).waitFor();
    assert.equal(await page.getByText('Not approved yet', { exact: true }).count(), 2);
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('; ')}`);

    // Create form posts the panel period.
    await page.getByRole('button', { name: 'Create pay run', exact: true }).click();
    await page.waitForFunction(() => window.calls.some((c) => c.name === 'createPayRun'));
    let calls = await page.evaluate(() => window.calls);
    assert.deepEqual(calls.find((c) => c.name === 'createPayRun').args[1], { periodFrom: '2026-10-01', periodTo: '2026-10-15' });

    // Open the finalized run: lines, tip-out, and the approval gate.
    await page.getByRole('button', { name: 'View', exact: true }).nth(1).click();
    await page.waitForFunction(() => window.calls.some((c) => c.name === 'getPayRun'));
    await page.getByText('Finalized. A second payroll manager must approve this run before it can be exported, linked to a payout, or disbursed.').waitFor();
    // Ana appears in the labor table, the run lines, and the
    // disbursement select: three renderings of the same employee.
    assert.equal(await page.getByText('Ana', { exact: true }).count(), 3);
    assert.equal(await page.getByRole('button', { name: 'Approve', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Export for payroll provider', exact: true }).count(), 1);

    // Approve: the checker step posts, and the panel shows the approved state.
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.waitForFunction(() => window.calls.some((c) => c.name === 'approvePayRun'));
    await page.getByText('Approved by a second payroll manager.').waitFor();
    calls = await page.evaluate(() => window.calls);
    assert.equal(calls.find((c) => c.name === 'approvePayRun').args[1], 12);

    // Provider export downloads the provider-shaped file.
    await page.getByRole('button', { name: 'Export for payroll provider', exact: true }).click();
    await page.waitForFunction(() => window.calls.some((c) => c.name === 'downloadPayRunCsv'));
    calls = await page.evaluate(() => window.calls);
    assert.deepEqual(calls.find((c) => c.name === 'downloadPayRunCsv').args.slice(1), [12, 'provider']);

    // Disbursement: pick the first uncovered line and record it; the
    // amount comes from the line total, never from operator input.
    await page.getByLabel('Employee to pay').selectOption('101');
    await page.getByRole('button', { name: 'Record disbursement', exact: true }).click();
    await page.waitForFunction(() => window.calls.some((c) => c.name === 'recordPayRunDisbursement'));
    calls = await page.evaluate(() => window.calls);
    const disb = calls.find((c) => c.name === 'recordPayRunDisbursement');
    assert.equal(disb.args[1], 12);
    assert.deepEqual(disb.args[2], { payRunLineId: 101, amountCents: 17000, method: 'bank_transfer', reference: undefined });
    await page.getByText('Paid', { exact: true }).waitFor();
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('; ')}`);
  } finally {
    await browser.close();
    server.close();
  }
});
