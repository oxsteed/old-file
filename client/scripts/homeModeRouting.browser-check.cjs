const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { setTimeout: delay } = require('node:timers/promises');
const { startPwaFixture } = require('./pwa-fixture-server.cjs');
const catalogs = { en: require('../src/locales/en.json'), ar: require('../src/locales/ar.json') };

test('the built homepage stays in the customer workspace on desktop and mobile', { timeout: 180000 }, async () => {
  const fixture = await startPwaFixture();
  const baseUser = { ...fixture.state.user };
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const modes = ['guest', 'customer', 'helper', 'business_owner', 'business_manager', 'business_representative', 'business_employee'];
  const membership = { business_manager: 'manager', business_representative: 'representative', business_employee: 'employee' };
  const results = [];
  try {
    for (const mode of modes) for (const width of [390, 1440]) {
      const language = width === 390 && ['customer', 'helper', 'business_owner'].includes(mode) ? 'ar' : 'en';
      const catalog = catalogs[language];
      fixture.state.user = mode === 'guest' ? null : { ...baseUser, role: mode === 'customer' ? 'customer' : 'helper', default_mode: mode };
      fixture.state.readResponses = {
        '/api/me/businesses': { data: { items: [{ id: 4, business_id: 4, business_name: 'Fixture Service Team', business_kind: 'service', business_mode: 'service', status: 'active', setup_status: 'active', role: membership[mode] || 'owner', is_owner: mode === 'business_owner', permissions: ['business.view', 'messages.view_assigned', 'calendar.view_self'], currency: 'USD' }] } },
        '/api/businesses/attention': { items: [], summary: { total: 0 }, businesses: [] },
        '/api/businesses/4/analytics': {},
        '/api/businesses/4/messages': { messages: [], total: 0 },
        '/api/businesses/4/appointments': { appointments: [], total: 0 },
        '/api/vehicles/my': [], '/api/vehicles/makes': [],
      };
      if (fixture.state.user) {
        const organization = mode.startsWith('business_')
          ? [{ type: 'business', id: '4', name: 'Fixture Service Team', role: membership[mode] || 'owner' }]
          : [];
        fixture.state.readResponses['/api/me/access'] = {
          accountId: String(fixture.state.user.id), flags: { accessProjection: true, accessRequests: true },
          access: { personal: mode === 'helper' ? ['customer', 'helper.offer_services'] : ['customer'], organizations: organization },
        };
      }
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addInitScript(({ language, width }) => {
        localStorage.setItem('oxs:language', language);
        localStorage.setItem('theme', width === 390 ? 'dark' : 'light');
      }, { language, width });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [], assets = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { const pathname = new URL(request.url()).pathname; if (pathname.startsWith('/assets/')) assets.push(pathname); });
      await context.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
      try {
        const start = Date.now();
        await page.goto(fixture.origin + '/');
        await page.getByRole('heading', { name: catalog.hero.title.replace(/\s+/g, ' '), exact: true }).waitFor();
        if (mode === 'customer') await page.getByRole('link', { name: catalog.toolRentals.myBookings, exact: true }).waitFor();
        if (mode === 'helper') await page.getByRole('link', { name: catalog.nav.myWork, exact: true }).waitFor();
        assert.ok(assets.some(file => /\/HomePage-[^/]+\.js$/.test(file)));
        assert.equal(assets.some(file => /\/(HelperDashboard|Business(?:Owner|Manager|Representative|Employee)Dashboard)-[^/]+\.js$/.test(file)), false);
        assert.equal(await page.locator('html').getAttribute('dir'), language === 'ar' ? 'rtl' : 'ltr');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${mode} ${width} must fit the viewport`);
        assert.ok(await page.getByRole('navigation', { name: catalog.navigation?.main || 'Main navigation' }).count() || await page.locator('.ox-navbar').count());
        assert.equal(await page.locator('.pwa-connection-online').count(), 0);
        assert.deepEqual(errors, [], `${mode} ${width}`);
        results.push({ mode, width, language, coldMs: Date.now() - start });
      } finally { await context.close(); }
    }

    // Hold a real discovery chunk while the actual app shows its fallback.
    fixture.state.user = null;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => localStorage.setItem('oxs:language', 'en'));
    const page = await context.newPage();
    let releaseAuth, releaseChunk, noteChunkRequest;
    const authHeld = new Promise(resolve => { releaseAuth = resolve; });
    const held = new Promise(resolve => { releaseChunk = resolve; });
    const chunkRequested = new Promise(resolve => { noteChunkRequest = resolve; });
    await context.route('**/api/auth/me', async route => { await authHeld; await route.continue(); });
    await context.route('**/assets/HomePage-*.js', async route => { noteChunkRequest(true); await held; await route.continue(); });
    try {
      await page.goto(fixture.origin + '/');
      await page.locator('.ox-loading-state:visible').waitFor();
      releaseAuth();
      assert.ok(await Promise.race([chunkRequested, delay(15000, false, { ref: false })]), 'expected the discovery chunk within 15 seconds');
      // Suspense can retain the auth-loading shell with display:none while
      // showing the chunk fallback. Count the UI users can see and access.
      await page.locator('.ox-loading-state:visible').waitFor();
      assert.equal(await page.locator('.ox-loading-state:visible').count(), 1, 'one visible loading announcement');
      assert.equal(await page.locator('.ox-navbar:visible').count(), 1, 'navigation remains available during loading');
      assert.equal(await page.getByRole('main').count(), 1, 'fallback keeps one accessible main landmark');
      releaseChunk();
      await page.getByRole('heading', { name: catalogs.en.hero.title.replace(/\s+/g, ' '), exact: true }).waitFor();
      assert.equal(await page.locator('.ox-loading-state:visible').count(), 0, 'loading clears when discovery is ready');
    } finally { releaseAuth(); releaseChunk(); await context.close(); }
    console.log(JSON.stringify({ homeModes: results }));
  } finally { await browser.close(); await fixture.close(); }
});
