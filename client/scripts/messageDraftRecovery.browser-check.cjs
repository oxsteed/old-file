const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startPwaFixture } = require('./pwa-fixture-server.cjs');

test('message edits survive immediate reload and stay isolated across accounts', { timeout: 45000 }, async () => {
  const fixture = await startPwaFixture();
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext();
    await context.route('**/*', route =>
      new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
    const originalUser = fixture.state.user;
    const conversation = '30000000-0000-4000-8000-000000000004';
    const url = fixture.origin + '/messages/' + conversation;
    fixture.state.readResponses['/api/messages/conversations/' + conversation] = [];
    const page = await context.newPage();
    const composer = page.getByRole('textbox', { name: 'Message input', exact: true });
    await page.goto(url);
    await composer.fill('Keep my latest edit');
    const stored = await page.evaluate(({ userId, conversation }) => {
      return localStorage.getItem('oxs:msg-draft:v2:' + JSON.stringify([String(userId), null, conversation]));
    }, { userId: originalUser.id, conversation });
    assert.equal(stored, 'Keep my latest edit');
    await page.reload();
    assert.equal(await composer.inputValue(), 'Keep my latest edit');

    fixture.state.failures['/api/auth/me'] = 503;
    await page.reload();
    await page.getByRole('heading', { name: 'We couldn’t check your session' }).waitFor();
    assert.equal(await composer.count(), 0);
    delete fixture.state.failures['/api/auth/me'];
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    assert.equal(await composer.inputValue(), 'Keep my latest edit');

    fixture.state.user = { ...originalUser, id: '30000000-0000-4000-8000-000000000005' };
    await page.reload();
    assert.equal(await composer.inputValue(), '');
    await composer.fill('A different account draft');
    fixture.state.user = originalUser;
    await page.reload();
    assert.equal(await composer.inputValue(), 'Keep my latest edit');
    assert.equal(fixture.state.writes.includes('/api/messages/conversations/' + conversation), false);
  } finally {
    await browser?.close();
    await fixture.close();
  }
});
