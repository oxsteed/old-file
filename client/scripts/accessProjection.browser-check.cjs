const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const { setTimeout: delay } = require('node:timers/promises');

test('access refreshes on resume and changes without replaying stale or cross-account access', { timeout: 30_000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react';
      import { flushSync } from 'react-dom';
      import { createRoot } from 'react-dom/client';
      import useAccessProjection, { notifyAccessChanged } from './src/hooks/useAccessProjection';
      import { advanceAuthEpoch } from './src/api/authSessionEpoch';

      function AccessLabel({ accountId, id }) {
        const projection = useAccessProjection(accountId ? { id: accountId } : null);
        const name = projection?.flags.accessProjection === false ? 'rollback' : projection?.access?.organizations[0]?.name || 'empty';
        window.rendered.push([accountId, name]);
        window.projectionStates.push([accountId, projection?.status]);
        return <output id={id}>{name}</output>;
      }
      window.rendered = [];
      window.projectionStates = [];
      const root = createRoot(document.getElementById('root'));
      window.signInAs = accountId => {
        advanceAuthEpoch();
        flushSync(() => root.render(<><AccessLabel accountId={accountId} id="home" /><AccessLabel accountId={accountId} id="nav" /></>));
      };
      window.refreshAccess = notifyAccessChanged;
      window.signInAs('first');
    ` },
    bundle: true, write: false, define: { 'import.meta.env': '{}' },
  });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const requests = [];
    const outgoing = [];
    await page.route('http://projection.test/**', (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/api/me/access') {
        outgoing.push(route);
        requests.shift()?.(route);
        return;
      }
      if (pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script defer src="/fixture.js"></script>' });
    });
    const waitForRequest = async (index) => {
      const pending = outgoing[index] || new Promise(resolve => requests.push(resolve));
      const route = await Promise.race([pending, delay(5000, null, { ref: false })]);
      assert.ok(route, `access request ${index + 1} never arrived`);
      return route;
    };
    const answer = (route, accountId, name) => route.fulfill({ json: { accountId, access: { organizations: [{ name }] } } });
    const expectName = async (name) => {
      await page.waitForFunction(expected => ['home', 'nav'].every(id => document.getElementById(id)?.textContent === expected), name);
    };

    await page.goto('http://projection.test/');
    await page.waitForFunction(() => window.projectionStates.some(([, status]) => status === 'loading'));
    await answer(await waitForRequest(0), 'first', 'First business');
    await expectName('First business');
    await page.waitForFunction(() => window.projectionStates.some(([, status]) => status === 'ready'));
    assert.equal(outgoing.length, 1);

    await page.evaluate(() => window.refreshAccess());
    const firstRefresh = await waitForRequest(1);
    await page.waitForFunction(() => window.projectionStates.some(([, status]) => status === 'refreshing'));
    await page.evaluate(() => window.signInAs('second'));
    await expectName('empty');
    const secondRequest = await waitForRequest(2);
    await answer(secondRequest, 'second', 'Second business');
    await expectName('Second business');
    await answer(firstRefresh, 'first', 'First business updated');

    // Same account, new login. Simulate the other tab's cookie changing before
    // the local authentication event arrives by returning a different account.
    await page.evaluate(() => window.signInAs('second'));
    await expectName('empty');
    const beforeMismatch = await page.evaluate(() => window.rendered.length);
    await answer(await waitForRequest(3), 'first', 'Different cookie business');
    await page.waitForFunction(count => window.rendered.length > count, beforeMismatch);
    await expectName('empty');
    await page.evaluate(() => window.refreshAccess());
    await answer(await waitForRequest(4), 'second', 'Second business updated');
    await expectName('Second business updated');
    assert.deepEqual(await page.evaluate(() => window.rendered.filter(([id, name]) => id === 'second'
      && !['empty', 'Second business', 'Second business updated'].includes(name))), []);

    // A fresh window focus starts a check even within the snapshot's TTL.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const beforeRevocation = await waitForRequest(5);
    await page.evaluate(() => window.refreshAccess());
    await answer(beforeRevocation, 'second', 'Stale business');
    await (await waitForRequest(6)).fulfill({ json: { accountId: 'second', access: { organizations: [] } } });
    await expectName('empty');
    assert.equal(await page.evaluate(() => window.rendered.some(([, name]) => name === 'Stale business')), false);

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await answer(await waitForRequest(7), 'second', 'Restored workspace');
    await expectName('Restored workspace');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await (await waitForRequest(8)).fulfill({ status: 503, json: { code: 'internal_error' } });
    await expectName('empty');
    await page.waitForFunction(() => window.projectionStates.some(([, status]) => status === 'temporary_failure'));

    await page.evaluate(() => window.refreshAccess());
    await (await waitForRequest(9)).fulfill({ status: 403, json: { code: 'ACCOUNT_SUSPENDED' } });
    await expectName('empty');
    await page.waitForFunction(() => window.projectionStates.some(([, status]) => status === 'restricted'));

    await page.evaluate(() => window.refreshAccess());
    await (await waitForRequest(10)).fulfill({ status: 503, json: { code: 'feature_disabled' } });
    await expectName('rollback');
    await page.waitForFunction(() => window.projectionStates.some(([, status]) => status === 'rollback'));
    await page.evaluate(() => window.signInAs(null));
    await page.waitForFunction(() => window.projectionStates.some(([, status]) => status === 'unauthenticated'));
    assert.equal(outgoing.length, 11, 'Home and navigation share the refresh listeners');
  } finally {
    await browser.close();
  }
});
