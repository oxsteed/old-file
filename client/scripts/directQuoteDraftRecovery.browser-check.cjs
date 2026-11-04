const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startPwaFixture } = require('./pwa-fixture-server.cjs');

test('Direct quote text and uploaded photos recover without crossing accounts or replaying a request', { timeout: 60000 }, async () => {
  const fixture = await startPwaFixture();
  const serviceId = '40000000-0000-4000-8000-000000000001';
  fixture.state.readResponses['/api/direct/catalog'] = { catalog: { categories: [{
    name: 'Electrical', slug: 'electrical', services: [{ id: serviceId, name: 'Synthetic service', slug: 'synthetic-service' }],
  }] } };
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
    const original = fixture.state.user;
    const page = await context.newPage();
    let uploadDraftId;
    await page.route('**/api/direct/uploads', async route => {
      uploadDraftId = /name="draftId"\r\n\r\n([^\r]+)/.exec(route.request().postData())?.[1];
      await route.fulfill({ json: { attachment: { key: 'synthetic-photo', name: 'repair.png', type: 'image/png' } } });
    });
    let submits = 0;
    await page.route('**/api/direct/requests', async route => {
      submits++;
      const data = route.request().postDataJSON();
      assert.equal(data.metadata.draftId, uploadDraftId);
      assert.equal(data.metadata.photoAttachments[0].key, 'synthetic-photo');
      await route.fulfill(submits === 1 ? { status: 503, json: { error: 'Synthetic outage' } } : { json: { referenceId: 'synthetic-quote' } });
    });
    const url = fixture.origin + '/direct/request-quote';
    const details = page.getByRole('textbox', { name: /What should we know/ });
    const saved = () => page.evaluate(() => Object.entries(sessionStorage).find(([key]) => key.startsWith('oxs:direct-quote-draft:v1:'))?.[1]);
    await page.goto(url);
    await page.getByRole('checkbox', { name: /Synthetic service/ }).check();
    await details.fill('Keep this quote and its photo');
    await page.locator('input[type=file]').setInputFiles({
      name: 'repair.png', mimeType: 'image/png', buffer: require('fs').readFileSync(require('path').join(__dirname, '../public/icons/icon-192.png')),
    });
    await page.getByRole('button', { name: 'Remove attachment', exact: true }).waitFor();
    assert.equal(JSON.parse(await saved()).draft.draftId, uploadDraftId);
    await page.reload();
    await details.waitFor();
    assert.equal(await details.inputValue(), 'Keep this quote and its photo');
    assert.equal(await page.getByRole('checkbox', { name: /Synthetic service/ }).isChecked(), true);
    assert.equal(await page.getByRole('button', { name: 'Remove attachment', exact: true }).count(), 1);
    assert.equal(submits, 0);

    fixture.state.failures['/api/auth/me'] = 503;
    const failedVerification = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/auth/me' && response.status() === 503);
    await page.reload();
    await failedVerification;
    assert.ok(await details.count() === 0 || await details.inputValue() !== 'Keep this quote and its photo');
    delete fixture.state.failures['/api/auth/me'];
    await page.reload();
    await details.waitFor();
    assert.equal(await details.inputValue(), 'Keep this quote and its photo');
    assert.equal(submits, 0);

    const changeAccount = async user => {
      fixture.state.user = user;
      await page.evaluate(id => window.dispatchEvent(new StorageEvent('storage', {
        key: 'oxs:auth-session-transition',
        newValue: JSON.stringify({ version: 1, type: 'session-established', accountId: id, sourceId: 'synthetic-other-tab' }),
      })), user.id);
      await page.waitForFunction(email => document.querySelector('input[type=email]')?.value === email, user.email);
    };
    await changeAccount({ ...original, id: '30000000-0000-4000-8000-000000000005', email: 'other@example.invalid' });
    assert.equal(await details.inputValue(), '');
    assert.equal(await page.getByRole('button', { name: 'Remove attachment', exact: true }).count(), 0);
    await changeAccount(original);
    assert.equal(await details.inputValue(), 'Keep this quote and its photo');
    assert.equal(await page.getByRole('button', { name: 'Remove attachment', exact: true }).count(), 1);

    await page.getByRole('textbox', { name: /Last name/ }).fill('Fixture');
    await page.getByRole('textbox', { name: /Where is the work/ }).fill('Synthetic location');
    await page.getByRole('textbox', { name: /ZIP code/ }).fill('45502');
    const submit = page.getByRole('button', { name: 'Request a quote', exact: true });
    await submit.click();
    await page.getByText('Synthetic outage', { exact: true }).waitFor();
    assert.equal(submits, 1);
    await page.reload();
    await details.waitFor();
    assert.equal(await details.inputValue(), 'Keep this quote and its photo');
    assert.equal(submits, 1);
    await submit.click();
    await page.waitForURL('**/direct/request-quote/thanks?referenceId=synthetic-quote');
    assert.equal(submits, 2);
    const key = 'oxs:direct-quote-draft:v1:' + JSON.stringify([original.id, null]);
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), null);
  } finally {
    await browser?.close();
    await fixture.close();
  }
});

test('guest Direct quote edits survive immediate reload in the same tab', { timeout: 30000 }, async () => {
  const fixture = await startPwaFixture();
  fixture.state.user = null;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext();
    await context.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(fixture.origin + '/direct/request-quote');
    const details = page.getByRole('textbox', { name: /What should we know/ });
    await details.fill('Guest unfinished work');
    await page.reload();
    await details.waitFor();
    assert.equal(await details.inputValue(), 'Guest unfinished work');
    assert.equal(fixture.state.writes.includes('/api/direct/requests'), false);
    await page.evaluate(() => {
      const key = 'oxs:direct-quote-draft:v1:' + JSON.stringify([null, null]);
      const record = JSON.parse(sessionStorage.getItem(key));
      record.savedAt = Date.now() - 25 * 60 * 60 * 1000;
      sessionStorage.setItem(key, JSON.stringify(record));
    });
    await page.reload();
    await details.waitFor();
    assert.equal(await details.inputValue(), '');
  } finally {
    await browser?.close();
    await fixture.close();
  }
});
