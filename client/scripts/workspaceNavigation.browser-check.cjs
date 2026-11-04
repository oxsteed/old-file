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
      fixture.state.user = { ...fixture.state.user, role: 'helper', default_mode: 'business_owner', preferred_language: language };
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
        assert.equal(await page.getByRole('main').count(), 1);
        await page.locator('.skip-nav').focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.activeElement.id === 'main-content');
        for (const editor of editors) assert.equal(assets.some(asset => asset.includes(`/${editor}-`)), false, `${editor} is not needed for overview`);

        const profileTab = tabs.getByRole('button', { name: catalog.businessHub.tabEditProfile, exact: true });
        await profileTab.focus();
        assert.equal(await profileTab.evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
        await page.keyboard.press('Enter');
        await page.getByRole('status').filter({ hasText: catalog.businessHub.rooms.loadingWorkspace }).waitFor();
        assert.equal(await profileTab.getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('.ox-navbar').count(), 1);
        assert.ok(await tabs.getByRole('button', { name: catalog.businessHub.tabOverview, exact: true }).isEnabled());
        await tabs.getByRole('button', { name: catalog.businessHub.tabOverview, exact: true }).click();
        await page.locator('.bh-loading', { hasText: catalog.businessHub.rooms.loadingWorkspace }).waitFor({ state: 'hidden' });
        await tabs.getByRole('button', { name: catalog.businessHub.tabEditProfile, exact: true }).click();
        releaseProfile();
        await page.locator('.bpe-studio').waitFor();
        if (width === 390) await page.getByRole('combobox', { name: catalog.profileStudio.sections, exact: true }).selectOption('identity');
        else await page.getByRole('button', { name: new RegExp(catalog.businessHub.sectionBusinessIdentity) }).click();
        await page.locator('#bh-business-name').fill('Unsent profile draft');
        assert.equal(await page.getByRole('button', { name: catalog.businessHub.btnSaveProfile, exact: true }).isEnabled(), true);
        const profileReads = fixture.state.requests.filter(request => request.path === '/api/businesses/4/profile-edit').length;
        start = Date.now();
        await tabs.getByRole('button', { name: catalog.businessHub.tabOverview, exact: true }).click();
        await page.locator('.bpe-studio').waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => {
          const event = new Event('beforeunload', { cancelable: true });
          window.dispatchEvent(event);
          return event.defaultPrevented;
        }), true, 'an unsaved profile stays protected while another tool is visible');
        assert.equal(await page.evaluate(() => {
          const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true });
          window.dispatchEvent(event);
          return event.defaultPrevented;
        }), false, 'a hidden editor must not intercept save shortcuts for another tool');
        await tabs.getByRole('button', { name: catalog.businessHub.tabEditProfile, exact: true }).click();
        await page.locator('.bpe-studio').waitFor();
        assert.equal(await page.locator('#bh-business-name').inputValue(), 'Unsent profile draft');
        assert.equal(await page.getByRole('button', { name: catalog.businessHub.btnSaveProfile, exact: true }).isEnabled(), true, 'returning does not replace the unsaved baseline');
        assert.equal(fixture.state.requests.filter(request => request.path === '/api/businesses/4/profile-edit').length, profileReads, 'warm returns do not refetch and overwrite edits');
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
    fixture.state.readResponses['/api/businesses/managed'] = { businesses: [{
      id: 4, business_name: 'Fixture Team', business_kind: 'service', status: 'active',
      setup_status: 'active', role: 'employee', permissions: ['business.view', 'calendar.view_self'],
    }] };
    fixture.state.readResponses['/api/launch-visibility'] = { media: true };
    fixture.state.readResponses['/api/businesses/4/operations-summary'] = { data: {
      timezone: 'America/New_York', tasks: [], sections: {
        bookings: { available: true, status: 'ready', scope: 'self', today: 2 },
      },
    } };
    const teamContext = await browser.newContext();
    await teamContext.addInitScript(() => localStorage.setItem('oxs:language', 'en'));
    const teamPage = await teamContext.newPage();
    const teamAssets = [];
    teamPage.on('request', request => teamAssets.push(new URL(request.url()).pathname));
    await teamContext.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
    try {
      await teamPage.goto(fixture.origin + '/business/4/workspace/profile');
      await teamPage.locator('.business-operations__card dd', { hasText: '2' }).waitFor();
      await teamPage.waitForURL('**/business/4/workspace');
      assert.equal(await teamPage.locator('.bh-tabs').getByRole('button', { name: catalogs.en.businessHub.tabEditProfile, exact: true }).count(), 0);
      assert.equal(await teamPage.locator('.bpe-studio').count(), 0);
      assert.equal(await teamPage.locator('.bh-tabs').getByRole('button', { name: /media/i }).count(), 0);
      await teamPage.goto(fixture.origin + '/business/4/workspace/media');
      await teamPage.locator('.business-operations__card dd', { hasText: '2' }).waitFor();
      await teamPage.waitForURL('**/business/4/workspace');
      assert.ok(!teamAssets.includes('/api/businesses/4/profile-edit'));
      assert.ok(!teamAssets.some(asset => asset.includes('/BusinessMediaTab-')));
      for (const editor of editors) assert.equal(teamAssets.some(asset => asset.includes(`/${editor}-`)), false, `employee does not download ${editor}`);
      await teamPage.locator('.bh-tabs').getByRole('button', { name: catalogs.en.businessHub.tabTeamLabel, exact: true }).click();
      await teamPage.locator('.bh-tabs .active', { hasText: catalogs.en.businessHub.tabTeamLabel }).waitFor();
    } finally { await teamContext.close(); }
    assert.equal(fixture.state.writes.some(route => route.startsWith('/api/businesses')), false, 'navigation does not submit business writes');
    console.log(JSON.stringify({ syntheticNavigationTimings: timings }));
  } finally { await browser.close(); await fixture.close(); }
});

test('an unavailable editor read never substitutes a partial business listing', { timeout: 45000 }, async () => {
  const fixture = await startPwaFixture();
  fixture.state.user = { ...fixture.state.user, role: 'helper', default_mode: 'business_owner' };
  const business = { id: 4, business_name: 'Listed service team', business_kind: 'service', status: 'active', setup_status: 'active', role: 'owner', is_owner: true, currency: 'USD', address_country: 'US' };
  fixture.state.readResponses = {
    '/api/businesses': { businesses: [business] }, '/api/businesses/managed': { businesses: [] },
    '/api/me/businesses': { data: { items: [business] } },
    '/api/businesses/4/profile-edit': { business: { ...business, description: 'Complete editable profile' } },
  };
  fixture.state.failures['/api/businesses/4/profile-edit'] = 503;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  await context.addInitScript(() => localStorage.setItem('oxs:language', 'en'));
  await context.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  try {
    await page.goto(fixture.origin + '/business/4/workspace/profile');
    await page.getByText(catalogs.en.businessHub.errorProfileLoad, { exact: true }).waitFor();
    assert.equal(await page.locator('.bpe-studio').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Save Profile', exact: true }).count(), 0);
    delete fixture.state.failures['/api/businesses/4/profile-edit'];
    await page.getByRole('button', { name: catalogs.en.businessHub.tryAgain, exact: true }).click();
    await page.locator('.bpe-studio').waitFor();
    await page.getByRole('button', { name: /Business Identity/ }).click();
    assert.equal(await page.locator('#bh-business-name').inputValue(), business.business_name);
    assert.equal(await page.locator('textarea[name="description"]').inputValue(), 'Complete editable profile');
    assert.equal(fixture.state.writes.some(path => /^\/api\/businesses\/\d+$/.test(path)), false);
  } finally { await context.close(); await browser.close(); await fixture.close(); }
});

test('profile drafts and delayed reads stay within their business and account', { timeout: 90000 }, async () => {
  const fixture = await startPwaFixture();
  fixture.state.user = { ...fixture.state.user, role: 'helper', default_mode: 'business_owner' };
  const first = { id: 4, business_name: 'First service team', business_kind: 'service', status: 'active', setup_status: 'active', role: 'owner', is_owner: true, currency: 'USD', address_country: 'US' };
  const second = { ...first, id: 5, business_name: 'Second service team' };
  fixture.state.readResponses = {
    '/api/businesses': { businesses: [first, second] }, '/api/businesses/managed': { businesses: [] },
    '/api/me/businesses': { data: { items: [first, second] } },
    '/api/businesses/4/profile-edit': { business: first },
    '/api/businesses/5/profile-edit': { business: second },
  };
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await context.addInitScript(() => localStorage.setItem('oxs:language', 'en'));
  await context.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  let releaseFirst, noteFirst;
  const held = new Promise(resolve => { releaseFirst = resolve; });
  const requested = new Promise(resolve => { noteFirst = resolve; });
  await context.route('**/api/businesses/4/profile-edit', async route => { noteFirst(); await held; await route.continue(); });
  const openIdentity = async () => {
    await page.locator('.bpe-studio').waitFor();
    await page.getByRole('button', { name: /Business Identity/ }).click();
    await page.locator('#bh-business-name').waitFor();
  };
  try {
    await page.goto(fixture.origin + '/business/4/workspace/profile');
    await requested;
    await page.locator('.bh-switcher select').selectOption('5');
    await openIdentity();
    assert.equal(await page.locator('#bh-business-name').inputValue(), second.business_name);
    await page.locator('#bh-business-name').fill('Private draft for second business');
    const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/businesses/4/profile-edit');
    releaseFirst();
    await (await oldResponse).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await page.locator('#bh-business-name').inputValue(), 'Private draft for second business', 'a late response from another business cannot replace this draft');

    await page.locator('.bh-switcher select').selectOption('4');
    await openIdentity();
    assert.equal(await page.locator('#bh-business-name').inputValue(), first.business_name);
    await page.locator('#bh-business-name').fill('Saved first profile');
    fixture.state.readResponses['/api/businesses/4/profile-edit'] = { business: { ...first, business_name: 'Saved first profile' } };
    const readsBeforeSave = fixture.state.requests.filter(request => request.path === '/api/businesses/4/profile-edit').length;
    await page.getByRole('button', { name: 'Save Profile', exact: true }).click();
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Save Profile');
      return Boolean(button?.disabled);
    });
    await openIdentity();
    assert.equal(await page.locator('#bh-business-name').inputValue(), 'Saved first profile');
    assert.equal(fixture.state.requests.filter(request => request.path === '/api/businesses/4/profile-edit').length, readsBeforeSave + 1, 'successful saves revalidate the profile');
    assert.deepEqual(fixture.state.writes.filter(path => /^\/api\/businesses\/\d+$/.test(path)), ['/api/businesses/4']);

    await page.locator('#bh-business-name').fill('Private draft for previous account');
    fixture.state.user = { ...fixture.state.user, id: 'another-business-owner' };
    const accountReads = fixture.state.requests.filter(request => request.path === '/api/auth/me').length;
    const previousProfileReads = fixture.state.requests.filter(request => request.path === '/api/businesses/4/profile-edit').length;
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    const deadline = Date.now() + 15000;
    while ((fixture.state.requests.filter(request => request.path === '/api/auth/me').length <= accountReads
      || fixture.state.requests.filter(request => request.path === '/api/businesses/4/profile-edit').length <= previousProfileReads) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(fixture.state.requests.filter(request => request.path === '/api/auth/me').length > accountReads);
    assert.ok(fixture.state.requests.filter(request => request.path === '/api/businesses/4/profile-edit').length > previousProfileReads);
    await openIdentity();
    await page.waitForFunction(() => document.querySelector('#bh-business-name')?.value === 'Saved first profile');
    assert.equal(await page.getByRole('button', { name: 'Save Profile', exact: true }).isEnabled(), false, 'the next verified account does not inherit an unsaved profile');
  } finally { releaseFirst(); await context.close(); await browser.close(); await fixture.close(); }
});
