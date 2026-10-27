const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startPwaFixture } = require('./pwa-fixture-server.cjs');
const catalogs = { en: require('../src/locales/en.json'), ar: require('../src/locales/ar.json') };

test('the built homepage follows account mode and retains usable navigation during a cold load', { timeout: 180000 }, async () => {
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
        if (mode === 'guest' || mode === 'customer') {
          await page.getByRole('heading', { name: catalog.hero.title.replace(/\s+/g, ' '), exact: true }).waitFor();
          if (mode === 'customer') assert.ok(await page.getByRole('link', { name: catalog.toolRentals.myBookings, exact: true }).count());
          assert.ok(assets.some(file => /\/HomePage-[^/]+\.js$/.test(file)));
        } else {
          if (mode === 'helper') await page.locator('#helper-workspace-heading').waitFor();
          else if (mode === 'business_owner') await page.getByRole('heading', { name: catalog.dashboards.businessOwner.title, exact: true }).waitFor();
          else {
            const key = { business_manager: 'businessManager', business_representative: 'businessRepresentative', business_employee: 'businessEmployee' }[mode];
            await page.getByRole('heading', { name: catalog.businessRoleDashboard[key].title, exact: true }).waitFor();
          }
          assert.equal(assets.some(file => /\/HomePage-[^/]+\.js$/.test(file)), false, `${mode} must not download customer discovery`);
        }
        assert.equal(await page.locator('html').getAttribute('dir'), language === 'ar' ? 'rtl' : 'ltr');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${mode} ${width} must fit the viewport`);
        assert.ok(await page.getByRole('navigation', { name: catalog.navigation?.main || 'Main navigation' }).count() || await page.locator('.ox-navbar').count());
        if (mode === 'helper' || mode.startsWith('business_')) {
          const destination = mode === 'helper' ? '/helper-dashboard' : '/dashboard';
          assert.ok(await page.locator(`.ox-navbar a[aria-current="page"][href="${destination}"]`).count(), `${mode} highlights its working homepage`);
        }
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
    let releaseChunk;
    const held = new Promise(resolve => { releaseChunk = resolve; });
    await context.route('**/assets/HomePage-*.js', async route => { await held; await route.continue(); });
    try {
      await page.goto(fixture.origin + '/');
      await page.locator('.ox-loading-state').waitFor();
      assert.equal(await page.locator('.ox-navbar').count(), 1, 'navigation remains available during loading');
      assert.equal(await page.locator('main').count(), 1, 'fallback keeps one main landmark');
      releaseChunk();
      await page.getByRole('heading', { name: catalogs.en.hero.title.replace(/\s+/g, ' '), exact: true }).waitFor();
    } finally { releaseChunk(); await context.close(); }
    console.log(JSON.stringify({ homeModes: results }));
  } finally { await browser.close(); await fixture.close(); }
});
