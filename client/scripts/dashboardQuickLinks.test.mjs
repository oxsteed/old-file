import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const quickLinksSource = fs.readFileSync(new URL('../src/components/DashboardQuickLinks.jsx', import.meta.url), 'utf8');
const customerDashboardSource = fs.readFileSync(new URL('../src/pages/Dashboard.jsx', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

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
