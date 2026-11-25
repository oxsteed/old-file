const test = require('node:test'),
  assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright-core');
const { startPwaFixture } = require('./pwa-fixture-server.cjs');
const profiles = [
  {
    name: 'desktop Chromium',
    engine: chromium,
    launch: { channel: 'chrome' },
    context: { viewport: { width: 1440, height: 900 } },
  },
  {
    name: 'Android-sized Chromium',
    engine: chromium,
    launch: { channel: 'chrome' },
    context: {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    },
  },
  {
    name: 'iPad-sized WebKit',
    engine: webkit,
    launch: {},
    context: {
      viewport: { width: 820, height: 1180 },
      isMobile: true,
      hasTouch: true,
      userAgent:
        'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    },
  },
];
for (const profile of profiles) {
  const register = profile.engine === webkit && process.env.PWA_WEBKIT_AVAILABLE !== 'true'
    ? test.skip
    : test;
  register(
    `installed-mode recovery matrix: ${profile.name}`,
    { timeout: 120000 },
    async () => {
      const fixture = await startPwaFixture(),
        browser = await profile.engine
          .launch({
            ...profile.launch,
            headless: true,
          })
          .catch(async (error) => {
            await fixture.close();
            throw error;
          }),
        context = await browser.newContext(profile.context),
        page = await context.newPage();
      await context.addInitScript(() => {
        localStorage.setItem('theme', 'dark');
        localStorage.setItem('oxs:language', 'en');
        Object.defineProperty(navigator, 'standalone', { get: () => true });
        const media = window.matchMedia.bind(window);
        window.matchMedia = (query) =>
          query === '(display-mode: standalone)'
            ? {
                ...media(query),
                matches: true,
                addEventListener() {},
                removeEventListener() {},
              }
            : media(query);
      });
      await context.route('**/*', (route) =>
        new URL(route.request().url()).origin === fixture.origin
          ? route.continue()
          : route.abort(),
      );
      try {
        await page.goto(fixture.origin + '/post-job', {
          waitUntil: 'domcontentloaded',
        });
        await page
          .getByRole('textbox', { name: /Job Title/i })
          .waitFor({ timeout: 60000 });
        const reject = page.getByRole('button', {
          name: 'Reject All',
          exact: true,
        });
        if (await reject.isVisible()) await reject.click();
        await page.waitForFunction(() => navigator.serviceWorker.controller);
        const title = page.getByRole('textbox', { name: /Job Title/i });
        await title.fill('Repair the kitchen faucet');
        await page.locator('input[type=file][accept="image/*"]').setInputFiles({
          name: 'repair.png',
          mimeType: 'image/png',
          buffer: require('fs').readFileSync(
            require('path').join(__dirname, '../public/icons/icon-192.png'),
          ),
        });
        await page.waitForTimeout(700);
        await page.reload();
        await title.waitFor();
        await page.waitForFunction(
          () => document.querySelectorAll('.pjw-preview-grid img').length === 1,
        );
        assert.equal(await title.inputValue(), 'Repair the kitchen faucet');
        assert.equal(await page.locator('.pjw-preview-grid img').count(), 1);
        fixture.state.draft = {
          id: 'draft-demo',
          wizard_step: 1,
          payload: { title: 'Newer server draft' },
          updated_at: new Date(Date.now() + 1000).toISOString(),
        };
        await page.reload();
        await title.waitFor();
        await page.waitForFunction(
          () =>
            document.querySelector('#job-title')?.value ===
              'Newer server draft' ||
            [...document.querySelectorAll('input')].some(
              (el) => el.value === 'Newer server draft',
            ),
        );
        assert.equal(await title.inputValue(), 'Newer server draft');
        assert.equal(await page.locator('.pjw-preview-grid img').count(), 1);
        fixture.state.draft = null;
        await title.fill('Repair the kitchen faucet');
        await page.keyboard.press('Control+k');
        await page.getByRole('dialog').waitFor();
        await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='combobox');
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        const before = fixture.state.requests.filter(
          (r) => r.path === '/api/auth/me',
        ).length;
        await page.evaluate(() =>
          window.dispatchEvent(
            new PageTransitionEvent('pageshow', { persisted: true }),
          ),
        );
        await page.waitForFunction(() =>
          !document.querySelector('.pwa-connection'),
        );
        await page.waitForTimeout(500);
        assert.ok(
          fixture.state.requests.filter((r) => r.path === '/api/auth/me')
            .length > before,
        );
        assert.equal(await title.inputValue(), 'Repair the kitchen faucet');
        await context.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event('offline')));
        await page.locator('.pwa-connection-offline').waitFor();
        await title.fill('Repair faucet while offline');
        await page.waitForTimeout(500);
        assert.equal(await title.inputValue(), 'Repair faucet while offline');
        await context.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await page.locator('.pwa-connection').waitFor({ state: 'detached' });
        await page.reload();
        await title.waitFor();
        await page.waitForFunction(
          () => document.querySelectorAll('.pjw-preview-grid img').length === 1,
        );
        assert.equal(await title.inputValue(), 'Repair faucet while offline');
        // Native-keyboard geometry is simulated; safe areas and the actual focused form are exercised.
        await title.focus();
        const beforeRect = await title.boundingBox();
        assert.ok(beforeRect && beforeRect.width > 0);
        assert.ok(
          await title.evaluate(
            (el) => parseFloat(getComputedStyle(el).fontSize) >= 16,
          ),
        );
        await page.goto(fixture.origin + '/restaurants/r/42?tab=menu');
        const rejectAgain = page.getByRole('button', {
          name: 'Reject All',
          exact: true,
        });
        if (await rejectAgain.isVisible()) await rejectAgain.click();
        await page.getByRole('button', { name: '+', exact: true }).click();
        await page.getByRole('button', { name: /View cart/ }).click();
        await page.getByRole('button', { name: /^Checkout/ }).click();
        const notes = page.getByPlaceholder('Name of the person picking up');
        await notes.fill('Alex pickup');
        await context.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event('offline')));
        await notes.fill('Alex pickup updated');
        await context.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await page.locator('.pwa-connection').waitFor({ state: 'detached' });
        assert.equal(await notes.inputValue(), 'Alex pickup updated');
        // Sharing runs through the real worker, then the normal authenticated form.
        const sharedId = await page.evaluate(async () => {
          const form = new FormData();
          form.append('title', 'Shared repair');
          form.append(
            'images',
            new File(
              [await (await fetch('/icons/icon-192.png')).blob()],
              'shared.png',
              { type: 'image/png' },
            ),
          );
          return new URL(
            (
              await fetch('/post-job/share-target', {
                method: 'POST',
                body: form,
              })
            ).url,
          ).searchParams.get('share');
        });
        assert.match(sharedId, /^[a-f0-9-]{36}$/);
        await page.goto(fixture.origin + '/post-job?share=' + sharedId, {
          waitUntil: 'domcontentloaded',
        });
        // WebKit can take longer to expose the form after a service-worker
        // navigation; keep the installed-mode test from failing on a
        // transient 30-second locator timeout.
        await title.waitFor({ timeout: 60000 });
        await page.waitForFunction(
          () => document.querySelectorAll('.pjw-preview-grid img').length === 1,
        );
        assert.equal(await title.inputValue(), 'Shared repair');
        await title.fill('Keep draft through update');
        await page.waitForTimeout(600);
        fixture.state.release++;
        await page.evaluate(async () => {
          await (await navigator.serviceWorker.getRegistration()).update();
        });
        await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
        // PWA silent updates (D-443): there is no refresh prompt anymore.
        // The update is deferred while authoring a job and applies silently
        // at the next quiet moment instead.
        assert.equal(await page.getByRole('button', { name: 'Refresh to update', exact: true }).count(), 0,
          'updates are deferred while authoring a job');
        assert.equal(await title.inputValue(), 'Keep draft through update');
        await page.locator('.ox-navbar').getByRole('link', { name: 'OxSteed', exact: true }).click();
        await page.waitForURL(fixture.origin + '/');
        // The URL changes before the route transition commits (the home
        // chunk loads lazily, ~2s here). The update guard is held until the
        // guarded form unmounts, so wait for the wizard to leave the DOM
        // before expecting the quiet apply — otherwise the navigation fires
        // while still guarded and the worker sits waiting.
        await page.locator('#job-title').waitFor({ state: 'detached', timeout: 15000 });
        assert.equal(await page.getByRole('button', { name: 'Refresh to update', exact: true }).count(), 0,
          'no refresh prompt on the home page either');
        // The home page is clean, so the next in-app navigation applies the
        // waiting worker silently: the tab reloads fresh, with no prompt.
        // Prove that the navigation replaced the document, then wait for the
        // actual form below. The window load event also waits for unrelated
        // resources and can stall on mobile Chromium after a worker takeover.
        // The update guard settles ~1s after the route transition commits
        // (the coordination hook clears after the wizard unmounts), so the
        // first navigation can land while still guarded; retry the
        // navigation until the worker applies, as a user keeps browsing.
        let applied = false;
        for (let attempt = 0; attempt < 6 && !applied; attempt++) {
          await page.evaluate(() => {
            window.__pwaBeforeUpdateDocument = true;
            history.pushState({}, '', '/discover');
          });
          applied = await page.waitForFunction(() => !window.__pwaBeforeUpdateDocument, { timeout: 1500 })
            .then(() => true)
            .catch(() => false);
        }
        assert.equal(applied, true, 'waiting worker applies silently after navigating away');
        // Identity flips when the new document is created, which can be before
        // that reload has committed. A second reload also returns readyState
        // to "loading", so this wait includes it. Do not wait for window load.
        await page.waitForFunction(() => document.readyState !== 'loading');
        const postJobUrl = fixture.origin + '/post-job';
        try {
          await page.goto(postJobUrl, { waitUntil: 'domcontentloaded' });
        } catch (error) {
          if (!/interrupted by another navigation/i.test(String(error))) throw error;
          await page.waitForURL(fixture.origin + '/');
          await page.goto(postJobUrl, { waitUntil: 'domcontentloaded' });
        }
        await title.waitFor();
        await page.waitForTimeout(800);
        await page.waitForFunction(
          () => document.querySelectorAll('.pjw-preview-grid img').length === 1,
        );
        assert.equal(await title.inputValue(), 'Keep draft through update');
        fixture.state.user = null;
        await page.waitForTimeout(5200);
        await page.evaluate(() =>
          window.dispatchEvent(
            new PageTransitionEvent('pageshow', { persisted: true }),
          ),
        );
        await page.waitForURL(/\/login/);
        await page.waitForTimeout(200);
        const records = await page.evaluate(
          () =>
            new Promise((resolve, reject) => {
              const r = indexedDB.open('oxsteed-job-drafts', 1);
              r.onsuccess = () => {
                const db = r.result,
                  tx = db.transaction('drafts'),
                  q = tx.objectStore('drafts').getAll();
                q.onsuccess = () => resolve(q.result.length);
                tx.oncomplete = () => db.close();
              };
              r.onerror = () => reject(r.error);
            }),
        );
        assert.equal(records, 0);
        assert.ok(
          !fixture.state.writes.some((path) =>
            /checkout|payment|orders$/.test(path),
          ),
          'resume must not replay a financial submission',
        );
      } finally {
        await browser.close();
        await fixture.close();
      }
    },
  );
}
