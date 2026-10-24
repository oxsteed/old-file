// Actual application screens with synthetic, intercepted API responses only.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('node:path');
const out = path.resolve(__dirname, '../public/screenshots');
const base = process.env.PWA_CAPTURE_URL || 'http://127.0.0.1:4187';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname))
  throw Error('Use an isolated loopback client');
const user = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Alex',
  first_name: 'Alex',
  email: 'demo@example.invalid',
  role: 'customer',
  email_verified: true,
  didit_status: 'verified',
  country: 'US',
  preferred_language: 'en',
  preferred_currency: 'USD',
  onboarding_complete: true,
};
const helper = {
  id: 'demo-helper',
  type: 'helper',
  businessName: 'Neighborhood Home Care',
  ownerName: 'Sam',
  avatar: '',
  rating: 4.9,
  reviewCount: 24,
  jobsCompleted: 62,
  memberSince: '2024',
  verified: false,
  backgroundChecked: false,
  categories: ['Home repair'],
  skills: ['Plumbing'],
  licenses: [],
  insurance: [],
  topServices: ['Home repairs'],
  startingPrice: 45,
  startingPriceUnit: 'hour',
  responseTime: 'Within an hour',
  responseMinutes: 30,
  city: 'Dayton',
  state: 'OH',
  serviceRadius: 15,
  availableToday: true,
  shortBio: 'Local help for everyday home repairs.',
  distance_miles: 2,
};
const restaurant = {
  id: 42,
  name: 'Neighborhood Kitchen',
  display_name: 'Neighborhood Kitchen',
  cuisine_tags: ['caribbean'],
  slug: 'neighborhood-kitchen',
  description: 'Fresh meals made in your neighborhood',
  cuisine_type: 'Caribbean',
  currency: 'USD',
  is_open: true,
  accepting_orders: true,
  status: 'active',
  rating: 4.8,
  rating_count: 82,
  delivery_fee_cents: 250,
  estimated_delivery_minutes: 25,
  city: 'Dayton',
  address: 'Main Street',
};
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    serviceWorkers: 'block',
    colorScheme: 'dark',
  });
  await context.addInitScript(() => {
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('i18nextLng', 'en');
  });
  const apis = new Set();
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    apis.add(url.pathname);
    let data = {};
    if (url.pathname === '/api/auth/me') data = { user };
    else if (url.pathname === '/api/launch-visibility') data = {};
    else if (url.pathname === '/api/helpers')
      data = {
        helpers: [helper],
        businesses: [],
        restaurants: [],
        total: 1,
        page: 1,
      };
    else if (url.pathname.includes('/config/capabilities'))
      data = { capabilities: {} };
    else if (url.pathname === '/api/food/restaurants')
      data = { restaurants: [restaurant], pagination: { hasMore: false } };
    else if (url.pathname === '/api/food/restaurants/42')
      data = {
        restaurant,
        menu: [
          {
            id: 1,
            name: 'House favorites',
            items: [
              {
                id: 12,
                name: 'Herb-roasted chicken',
                description:
                  'Served with rice, garden vegetables and house sauce',
                price_cents: 1650,
                currency: 'USD',
                is_available: true,
                category: 'House favorites',
              },
            ],
          },
        ],
        categories: [{ id: 1, name: 'House favorites' }],
      };
    else if (url.pathname.includes('/my/orders')) data = { orders: [] };
    else if (url.pathname === '/api/oxsteed-credit/accounts')
      data = { accounts: [{ currencyCode: 'USD', status: 'active' }] };
    else if (url.pathname === '/api/oxsteed-credit/account')
      data = {
        account: {
          id: 'demo-account',
          currencyCode: 'USD',
          status: 'active',
          balanceCents: 12850,
          availableBalanceCents: 12850,
          reservedCents: 0,
        },
      };
    else if (url.pathname === '/api/oxsteed-credit/status')
      data = { credit: { enabled: false } };
    else if (url.pathname === '/api/jobs/draft') data = null;
    else if (url.pathname.includes('notifications'))
      data = { notifications: [], unread_count: 0 };
    else if (/wallets/.test(url.pathname)) data = { wallets: [] };
    else if (
      /helpers|categories|favorites|bookings|bids|feed|jobs/.test(url.pathname)
    )
      data = [];
    else if (/places/.test(url.pathname)) data = { places: [] };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });
  for (const [name, path, width, height] of [
    ['home', '/', 1280, 720],
    ['post-job', '/post-job', 750, 1334],
    ['food-order', '/restaurants/r/42?tab=menu', 750, 1334],
    ['wallet', '/wallet', 1280, 720],
  ]) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + path);
    await page.waitForTimeout(5000);
    const reject = page
      .getByRole('button', { name: /reject|necessary only|essential only/i })
      .first();
    if (await reject.isVisible()) await reject.click();
    if (name === 'post-job') {
      const title = page.getByRole('textbox', { name: /Job Title/i });
      if (await title.isVisible())
        await title.fill('Repair the leaking kitchen faucet');
    }
    await page.evaluate(() => document.fonts.ready);
    await page.locator('body').click({ position: { x: 5, y: 70 } });
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(
      JSON.stringify({
        name,
        url: page.url(),
        text: (await page.locator('body').innerText()).slice(0, 1200),
        errors,
      }),
    );
    await page.close();
  }
  const sharePage = await context.newPage();
  await sharePage.goto(base);
  const id = '20000000-0000-4000-8000-000000000002';
  await sharePage.evaluate(async (id) => {
    const file = new File(
      [await (await fetch('/icons/icon-192.png')).blob()],
      'kitchen-repair.png',
      { type: 'image/png' },
    );
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('oxsteed-share-target', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('drafts', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').put({
        id,
        createdAt: Date.now(),
        title: 'Repair the kitchen faucet',
        text: 'A photo of the repair is attached.',
        files: [file],
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, id);
  await sharePage.goto(base + '/post-job?share=' + id);
  await sharePage
    .getByText('Shared photos are attached. Review the details before posting.')
    .waitFor();
  require('node:assert/strict').equal(
    await sharePage.getByRole('textbox', { name: /Job Title/i }).inputValue(),
    'Repair the kitchen faucet',
  );
  require('node:assert/strict').equal(
    await sharePage.locator('.pjw-preview-grid img').count(),
    1,
  );
  console.log(
    'Full job-form photo hand-off passed; no upload or job submission performed',
  );
  await sharePage.close();
  console.log('APIs', JSON.stringify([...apis]));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
