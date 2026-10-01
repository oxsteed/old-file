// Authenticated admin browser matrix.
//
// Run with either:
//   OXSTEED_E2E_BASE_URL=https://... OXSTEED_E2E_STORAGE_STATE=/path/state.json \
//     npm run test:admin-authenticated
// or with OXSTEED_E2E_EMAIL, OXSTEED_E2E_PASSWORD, and
// OXSTEED_E2E_SIGNATURE_NAME. Credentials and storage state stay outside the
// repository and are never printed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const baseURL = process.env.OXSTEED_E2E_BASE_URL || process.env.E2E_BASE_URL || '';
const storageStatePath = process.env.OXSTEED_E2E_STORAGE_STATE || '';
const email = process.env.OXSTEED_E2E_EMAIL || '';
const password = process.env.OXSTEED_E2E_PASSWORD || '';
const signatureName = process.env.OXSTEED_E2E_SIGNATURE_NAME || '';
const twoFactorCode = process.env.OXSTEED_E2E_2FA_CODE || '';
const configured = Boolean(baseURL && (storageStatePath || (email && password && signatureName)));

function staticAdminRoutes() {
  const manifestPath = path.resolve(__dirname, '../src/admin/adminRouteManifest.js');
  const source = fs.readFileSync(manifestPath, 'utf8');
  const routes = [...source.matchAll(/defineRoute\('([^']+)'/g)]
    .map((match) => match[1])
    .filter((route) => route.startsWith('/admin') || route === '/direct/admin')
    .filter((route) => !route.includes(':'));
  return [...new Set(routes)];
}

const ADMIN_ROUTES = staticAdminRoutes();
const RESPONSIVE_ROUTES = [
  '/admin/dashboard',
  '/admin/super/dashboard',
  '/admin/super/restaurant-credit',
  '/admin/super/settings',
];

function describeResponse(response) {
  return `${response.status()} ${response.url()}`;
}

async function createContext(browser, options = {}) {
  const contextOptions = {
    baseURL,
    viewport: options.viewport || { width: 1440, height: 900 },
    colorScheme: options.colorScheme || 'dark',
    locale: options.locale || 'en-US',
    reducedMotion: 'reduce',
  };
  if (storageStatePath) contextOptions.storageState = storageStatePath;
  return browser.newContext(contextOptions);
}

async function ensureAuthenticated(page) {
  await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });
  if (!/\/login(?:\?|$)/.test(page.url())) return;

  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#terms-agree').check();
  await page.locator('#signature-name').fill(signatureName);
  await page.getByRole('button', { name: /sign in/i }).click();

  if (await page.locator('#two-factor-code').count()) {
    assert.ok(twoFactorCode, '2FA is required; set OXSTEED_E2E_2FA_CODE for the browser matrix');
    await page.locator('#two-factor-code').fill(twoFactorCode);
    await page.getByRole('button', { name: /verify|continue|sign in/i }).click();
  }

  await page.waitForURL((url) => !/\/login(?:\?|$)/.test(url.pathname), { timeout: 20_000 });
}

async function collectPageFailures(page, failures) {
  const visibleErrors = await page.locator('body').innerText().catch(() => '');
  if (/\b(internal server error|unexpected error|something went wrong)\b/i.test(visibleErrors)) {
    failures.push(`visible error on ${page.url()}`);
  }
}

function installFailureListeners(page, failures) {
  page.on('response', (response) => {
    if (response.status() >= 500) failures.push(describeResponse(response));
  });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
}

test('authenticated admin routes load without server or runtime failures', { skip: !configured }, async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await createContext(browser);
  const page = await context.newPage();
  const failures = [];
  installFailureListeners(page, failures);

  try {
    await ensureAuthenticated(page);
    for (const route of ADMIN_ROUTES) {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      assert.ok(!response || response.status() < 500, `${route} returned ${response?.status()}`);
      await page.waitForTimeout(250);
      await collectPageFailures(page, failures);
    }
    assert.deepEqual(failures, [], `admin browser failures:\n${failures.join('\n')}`);
  } finally {
    await context.close();
    await browser.close();
  }
});

test('key admin surfaces survive responsive, theme, reduced-motion, and Arabic locale contexts', { skip: !configured }, async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const failures = [];
  try {
    for (const options of [
      { viewport: { width: 390, height: 844 }, colorScheme: 'light', locale: 'en-US' },
      { viewport: { width: 1440, height: 900 }, colorScheme: 'dark', locale: 'ar' },
    ]) {
      const context = await createContext(browser, options);
      const page = await context.newPage();
      installFailureListeners(page, failures);
      try {
        await ensureAuthenticated(page);
        for (const route of RESPONSIVE_ROUTES) {
          const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          assert.ok(!response || response.status() < 500, `${options.locale} ${route} returned ${response?.status()}`);
          await page.waitForTimeout(250);
          await collectPageFailures(page, failures);
        }
      } finally {
        await context.close();
      }
    }
    assert.deepEqual(failures, [], `responsive admin browser failures:\n${failures.join('\n')}`);
  } finally {
    await browser.close();
  }
});

if (!configured) {
  process.stdout.write('Authenticated admin browser matrix skipped: set OXSTEED_E2E_BASE_URL plus storage state or test credentials.\n');
}
