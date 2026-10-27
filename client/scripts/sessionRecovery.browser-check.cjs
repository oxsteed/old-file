const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startPwaFixture } = require('./pwa-fixture-server.cjs');

test('built app recovers a cold outage and transient refresh without losing a private draft or replaying writes', { timeout: 60000 }, async () => {
  const fixture = await startPwaFixture();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await context.addInitScript(() => {
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('oxs:language', 'en');
    });
    await context.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(fixture.origin + '/post-job');
    const title = page.getByRole('textbox', { name: /Job Title/i });
    await title.waitFor();
    const reject = page.getByRole('button', { name: 'Reject All', exact: true });
    if (await reject.isVisible()) await reject.click();
    await title.fill('Private draft saved before an outage');
    await page.locator('input[type=file][accept="image/*"]').setInputFiles({
      name: 'repair.png', mimeType: 'image/png', buffer: require('fs').readFileSync(require('path').join(__dirname, '../public/icons/icon-192.png')),
    });
    await page.waitForTimeout(800);
    fixture.state.failures['/api/auth/me'] = 503;
    await page.reload();
    await page.getByRole('heading', { name: 'We couldn’t check your session' }).waitFor({ timeout: 12000 }).catch(async error => {
      throw new Error(`${error.message}\nRendered recovery page: ${(await page.locator('body').innerText()).slice(0,2500)}`);
    });
    assert.ok(page.url().endsWith('/post-job'));
    assert.equal(await page.locator('.pwa-connection').count(), 0, 'one primary recovery action');
    assert.equal(await title.count(), 0);
    assert.equal(await page.locator('#email').count(), 0);
    // Both tabs remain unverified during the shared outage; recovery in one
    // must not make the other trust a browser-stored profile.
    const other = await context.newPage();
    await other.goto(fixture.origin + '/post-job');
    await other.getByRole('heading', { name: 'We couldn’t check your session' }).waitFor();
    delete fixture.state.failures['/api/auth/me'];
    await other.getByRole('button', { name: 'Try again', exact: true }).click();
    await other.getByRole('textbox', { name: /Job Title/i }).waitFor();
    assert.equal(await title.count(), 0);
    await other.close();
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await title.waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.pjw-preview-grid img').length === 1);
    assert.equal(await title.inputValue(), 'Private draft saved before an outage');
    // A later failure must retain the mounted form and its current edits.
    await title.fill('Private unsent edit during a refresh outage');
    fixture.state.failures['/api/auth/me'] = 503;
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.locator('.pwa-connection-offline').waitFor();
    assert.equal(await title.inputValue(), 'Private unsent edit during a refresh outage');
    delete fixture.state.failures['/api/auth/me'];
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.locator('.pwa-connection').waitFor({ state: 'detached' });
    assert.equal(await title.inputValue(), 'Private unsent edit during a refresh outage');
    assert.equal(fixture.state.writes.some(path => /(?:checkout|payments|bids|orders)$/.test(path)), false);
    await page.waitForTimeout(5100); // Existing resume coordinator cooldown.
    fixture.state.user = null;
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.waitForURL('**/login');
    assert.equal(await title.count(), 0);
    fixture.state.user = { id:'another-account',role:'customer',default_mode:'customer',email_verified:true,didit_status:'verified',preferred_language:'en' };
    fixture.state.draft = null;
    await page.goto(fixture.origin + '/post-job');
    await title.waitFor();
    assert.equal(await title.inputValue(), '');
    assert.equal(await page.locator('.pjw-preview-grid img').count(), 0);
  } finally { await context.close();await browser.close();await fixture.close(); }
});
