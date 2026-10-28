const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startPwaFixture } = require('./pwa-fixture-server.cjs');
const catalogs = { en: require('../src/locales/en.json'), ar: require('../src/locales/ar.json') };
const editors = ['PricingRulesManager', 'MemberPermissionsEditor', 'ProductManagement', 'ProductPricingManager', 'BusinessCreationWizard', 'BusinessProfileEditor'];

test('workspace navigation defers inactive editors and remains usable during delayed panel and dialog loads', { timeout: 180000 }, async () => {
  const fixture = await startPwaFixture();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const timings = [];
  try {
    for (const [language, width] of [['en', 1440], ['ar', 390]]) {
      const catalog = catalogs[language];
      fixture.state.user = { ...fixture.state.user, role: 'helper', default_mode: 'business_owner' };
      const business = { id: 4, business_name: 'Fixture Service Team', business_kind: 'service', status: 'active', setup_status: 'active', role: 'owner', is_owner: true, currency: 'USD', address_country: 'US' };
      fixture.state.readResponses = {
        '/api/businesses': { businesses: [business] }, '/api/businesses/managed': { businesses: [] },
        '/api/me/businesses': { data: { items: [business] } },
        '/api/businesses/4/analytics': { monthly: [], mtd: {}, last_month: {}, ytd: {}, invoices: {}, jobs: {} },
        '/api/businesses/4/calendar/summary': {}, '/api/businesses/4/profile-edit': { business },
        '/api/businesses/4/services': { services: [] },
        '/api/businesses/categories': { categories: [], operatingModels: [] },
      };
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addInitScript(({ language }) => { localStorage.setItem('oxs:language', language); localStorage.setItem('theme', language === 'ar' ? 'dark' : 'light'); }, { language });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [], assets = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/assets/')) assets.push(new URL(request.url()).pathname); });
      await context.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
      let releaseProfile, releaseWizard;
      const profileHeld = new Promise(resolve => { releaseProfile = resolve; });
      const wizardHeld = new Promise(resolve => { releaseWizard = resolve; });
      await context.route('**/assets/BusinessProfileEditor-*.js', async route => { await profileHeld; await route.continue(); });
      await context.route('**/assets/BusinessCreationWizard-*.js', async route => { await wizardHeld; await route.continue(); });
      const tabs = page.locator('.bh-tabs');
      try {
        let start = Date.now();
        await page.goto(fixture.origin + '/business/4/workspace');
        await tabs.locator('.active').waitFor();
        await page.locator('.bh-switcher').waitFor();
        timings.push({ language, transition: 'cold-workspace', ms: Date.now() - start });
        for (const editor of editors) assert.equal(assets.some(asset => asset.includes(`/${editor}-`)), false, `${editor} is not needed for overview`);

        await tabs.getByRole('button', { name: catalog.businessHub.tabEditProfile, exact: true }).click();
        await page.locator('.bh-loading', { hasText: catalog.businessHub.rooms.loadingWorkspace }).waitFor();
        assert.equal(await page.locator('.ox-navbar').count(), 1);
        assert.ok(await tabs.getByRole('button', { name: catalog.businessHub.tabOverview, exact: true }).isEnabled());
        await tabs.getByRole('button', { name: catalog.businessHub.tabOverview, exact: true }).click();
        await page.locator('.bh-loading', { hasText: catalog.businessHub.rooms.loadingWorkspace }).waitFor({ state: 'detached' });
        await tabs.getByRole('button', { name: catalog.businessHub.tabEditProfile, exact: true }).click();
        releaseProfile();
        await page.locator('.bpe-studio').waitFor();
        start = Date.now();
        await tabs.getByRole('button', { name: catalog.businessHub.tabOverview, exact: true }).click();
        await page.locator('.bpe-studio').waitFor({ state: 'detached' });
        await tabs.getByRole('button', { name: catalog.businessHub.tabEditProfile, exact: true }).click();
        await page.locator('.bpe-studio').waitFor();
        timings.push({ language, transition: 'warm-profile-return', ms: Date.now() - start });

        await page.locator('.bh-header-actions').getByRole('button', { name: `+ ${catalog.businessHub.addBusiness}`, exact: true }).click();
        const loadingDialog = page.getByRole('dialog', { name: catalog.businessHub.rooms.loadingWorkspace, exact: true });
        await loadingDialog.waitFor();
        const cancel = loadingDialog.getByRole('button', { name: catalog.businessHub.btnCancel, exact: true });
        await cancel.focus();
        await page.keyboard.press('Tab');
        assert.equal(await cancel.evaluate(element => element === document.activeElement), true);
        await page.keyboard.press('Escape');
        await loadingDialog.waitFor({ state: 'detached' });
        releaseWizard();
        await page.locator('.bh-header-actions').getByRole('button', { name: `+ ${catalog.businessHub.addBusiness}`, exact: true }).click();
        await page.locator('.bcw-panel').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await page.locator('html').getAttribute('dir'), language === 'ar' ? 'rtl' : 'ltr');
        assert.deepEqual(errors, []);
      } finally { releaseProfile(); releaseWizard(); await context.close(); }
    }

    // A directly requested editor route must retain the existing team gate.
    fixture.state.user = { ...fixture.state.user, default_mode: 'business_employee' };
    fixture.state.readResponses['/api/businesses'] = { businesses: [] };
    fixture.state.readResponses['/api/businesses/managed'] = { businesses: [{ id: 4, business_name: 'Fixture Team', business_kind: 'service', status: 'active', setup_status: 'active', role: 'employee' }] };
    const teamContext = await browser.newContext();
    await teamContext.addInitScript(() => localStorage.setItem('oxs:language', 'en'));
    const teamPage = await teamContext.newPage();
    const teamAssets = [];
    teamPage.on('request', request => teamAssets.push(new URL(request.url()).pathname));
    await teamContext.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
    try {
      await teamPage.goto(fixture.origin + '/business/4/workspace/profile');
      await teamPage.locator('.bh-tabs .active').waitFor();
      assert.equal(await teamPage.locator('.bh-tabs').getByRole('button', { name: catalogs.en.businessHub.tabEditProfile, exact: true }).count(), 0);
      assert.equal(await teamPage.locator('.bpe-studio').count(), 0);
      for (const editor of editors) assert.equal(teamAssets.some(asset => asset.includes(`/${editor}-`)), false, `employee does not download ${editor}`);
      await teamPage.locator('.bh-tabs').getByRole('button', { name: catalogs.en.businessHub.tabTeamLabel, exact: true }).click();
      await teamPage.locator('.bh-tabs .active', { hasText: catalogs.en.businessHub.tabTeamLabel }).waitFor();
    } finally { await teamContext.close(); }
    assert.equal(fixture.state.writes.some(route => route.startsWith('/api/businesses')), false, 'navigation does not submit business writes');
    console.log(JSON.stringify({ syntheticNavigationTimings: timings }));
  } finally { await browser.close(); await fixture.close(); }
});
