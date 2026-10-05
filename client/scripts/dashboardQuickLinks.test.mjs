import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { formatCreditMinorUnits } from '../src/lib/creditCurrency.js';

const quickLinksSource = fs.readFileSync(new URL('../src/components/DashboardQuickLinks.jsx', import.meta.url), 'utf8');
const customerDashboardSource = fs.readFileSync(new URL('../src/pages/Dashboard.jsx', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

// Render the actual launch component and its shared UI, without mounting the
// parent account/API hooks. Builds do not check undefined variables in JSX.
const launchSource = customerDashboardSource
  .slice(0, customerDashboardSource.indexOf('export default function Dashboard()'))
  .replace(/^import .*;\r?\n/gm, '');
const launchContext = vm.createContext({
  React,
  Link: ({ to, children, ...props }) => React.createElement('a', { ...props, href: to }, children),
  LAUNCH_VISIBILITY: { personalLifeDashboard: false },
  formatCreditMinorUnits,
  formatFoodMoney: (amount, currency = 'USD') => formatCreditMinorUnits(amount, currency),
});
vm.runInContext(ts.transpileModule(`${launchSource}\nglobalThis.launchDashboard = LaunchCustomerDashboard;`, {
  fileName: 'Dashboard.jsx',
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
}).outputText, launchContext);

const launchProps = {
  t: (key, values) => values?.amount ? `${key}: ${values.amount}` : key,
  loading: false,
  activeJobs: [],
  foodOrders: [],
  wallets: [],
  unreadMsgs: 0,
  unreadNotifs: 0,
  error: false,
  onRetry: () => {},
};

test('customer dashboard passes account state into the launch component', () => {
  assert.match(customerDashboardSource, /<LaunchCustomerDashboard\b[^>]*\boxsteedCreditAccount=\{oxsteedCreditAccount\}/);
});

test('launch dashboard renders loading, unavailable, and populated credit states without crashing', () => {
  for (const props of [
    { loading: true },
    {}, // Older callers or a failed optional credit request.
    { oxsteedCreditAccount: null },
    { oxsteedCreditAccount: { currencyCode: 'USD', availableBalanceCents: 12345, reservedCents: 500 } },
    { oxsteedCreditAccount: { currencyCode: 'USD', availableBalanceCents: 0, balanceCents: 5000 } },
  ]) {
    const html = renderToStaticMarkup(React.createElement(launchContext.launchDashboard, { ...launchProps, ...props }));
    assert.match(html, /href="\/oxsteed-credit"/);
    assert.match(html, /href="\/restaurant-credit"/);
    if (props.loading) assert.match(html, /animate-pulse/);
    else if (!props.oxsteedCreditAccount) assert.match(html, /dashboard.customer.noOxsteedCredit/);
    else {
      assert.match(html, new RegExp(formatCreditMinorUnits(props.oxsteedCreditAccount.availableBalanceCents, 'USD').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      if (props.oxsteedCreditAccount.reservedCents) assert.match(html, /dashboard.customer.creditReserved/);
      assert.doesNotMatch(html, /dashboard.customer.noOxsteedCredit/);
    }
  }
});

test('every customer-facing shared dashboard quick-link collection includes QR Generator', () => {
  for (const collection of ['helper', 'life', 'toolOwner', 'franchise', 'consultant', 'businessOwner', 'businessRole']) {
    const section = quickLinksSource.match(new RegExp(`${collection}: \\[([\\s\\S]*?)\\n  \\],`))?.[1] || '';
    assert.match(section, /QR_GENERATOR_LINK/, `${collection} dashboard is missing QR Generator`);
  }
  assert.match(quickLinksSource, /const QR_GENERATOR_LINK = link\('\/qr-generator'/);
});

test('customer dashboard includes the QR link and Pro badge', () => {
  assert.match(customerDashboardSource, /to: '\/qr-generator'/);
  assert.match(customerDashboardSource, /dashboard\.customer\.quickLinksPro/);
});

test('QR Generator remains protected by the existing route guard', () => {
  assert.match(appSource, /path="\/qr-generator"\s+element={<Guarded><ProtectedRoute>/);
});

test('all supported locales contain the Pro quick-link label', () => {
  for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(fs.readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8'));
    assert.equal(catalog.dashboard.customer.quickLinksPro, 'Pro', `${locale} is missing dashboard.customer.quickLinksPro`);
  }
});
