const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startPwaFixture } = require('./pwa-fixture-server.cjs');

test('Direct prefetch loads the catalog alone and keeps navigation during a delayed route', { timeout: 45000 }, async () => {
  const fixture = await startPwaFixture();
  fixture.state.user = null;
  fixture.state.readResponses['/api/direct/profile'] = {};
  let browser;
  let releaseCatalog;
  const catalogHeld = new Promise(resolve => { releaseCatalog = resolve; });
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route =>
      new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
    await context.route('**/assets/DirectCatalogLanding-*.js', async route => {
      await catalogHeld;
      await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const assets = [];
    page.on('request', request => assets.push(new URL(request.url()).pathname));
    await page.goto(fixture.origin + '/');
    const reject = page.getByRole('button', { name: 'Reject All', exact: true });
    if (await reject.isVisible()) await reject.click();
    const link = page.locator('.site-footer a[href="/direct"]').first();
    const prefetch = page.waitForRequest(request => /\/DirectCatalogLanding-[^/]+\.js$/.test(new URL(request.url()).pathname));
    await link.hover();
    await prefetch;
    assert.equal(new URL(page.url()).pathname, '/', 'hover fetches before navigating');
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await link.click();
    await page.locator('.ox-navbar').waitFor();
    assert.equal(await page.locator('#direct-catalog-title').count(), 0);
    releaseCatalog();
    await page.locator('#direct-catalog-title').waitFor();
    assert.equal(assets.filter(asset => /\/DirectCatalogLanding-/.test(asset)).length, 1);
    assert.equal(assets.some(asset => /\/DirectPortalPage-/.test(asset)), false);

    await page.locator('.product-header a[href="/direct/request-quote"]').click();
    await page.getByRole('heading', { name: 'Request a Direct quote', exact: true }).waitFor();
    assert.equal(assets.some(asset => /\/DirectPortalPage-/.test(asset)), true);
    assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
    assert.equal(fixture.state.writes.some(route => route.startsWith('/api/direct/')), false);
  } finally {
    releaseCatalog();
    await browser?.close();
    await fixture.close();
  }
});
