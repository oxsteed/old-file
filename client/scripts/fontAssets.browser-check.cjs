const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { startPwaFixture } = require('./pwa-fixture-server.cjs');

test('built fonts load as real local font faces across public and authenticated surfaces', { timeout: 180000 }, async () => {
  const fixture = await startPwaFixture();
  const baseUser = { ...fixture.state.user };
  const business = { id: 4, business_name: 'Fixture Service Team', business_kind: 'service', status: 'active', setup_status: 'active', role: 'owner', is_owner: true };
  fixture.state.readResponses = {
    '/api/businesses': { businesses: [business] }, '/api/businesses/managed': { businesses: [] },
    '/api/me/businesses': { data: { items: [business] } },
    '/api/businesses/4/analytics': { monthly: [], invoices: {}, jobs: {} },
    '/api/businesses/4/calendar/summary': {},
  };
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const cases = [ ['food', '/restaurants'], ['restaurant', '/restaurants/r/42'], ['direct', '/direct'], ['messages', '/messages'], ['workspace', '/business/4/workspace'] ];
  try {
    for (const [name, routePath] of cases) for (const [language, width] of [['en', 1440], ['ar', 390]]) {
      fixture.state.user = { ...baseUser, role: name === 'workspace' ? 'helper' : 'customer', default_mode: name === 'workspace' ? 'business_owner' : 'customer' };
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addInitScript(({ language }) => {
        localStorage.setItem('oxs:language', language);
        localStorage.setItem('theme', language === 'ar' ? 'dark' : 'light');
      }, { language });
      await context.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
      const page = await context.newPage();
      const errors = [], fonts = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.request().resourceType() === 'font') fonts.push({ path: new URL(response.url()).pathname, status: response.status() }); });
      try {
        await page.goto(fixture.origin + routePath);
        await page.locator('h1').first().waitFor();
        const loaded = await page.evaluate(async () => {
          const styles = ['400 24px "Instrument Serif"', 'italic 400 24px "Instrument Serif"', '400 16px Inter', '700 16px Inter', '400 16px "Work Sans"'];
          const result = [];
          for (const style of styles) {
            const faces = await document.fonts.load(style, 'OxSteed français Español Kreyòl');
            result.push({ style, count: faces.length, loaded: faces.every(face => face.status === 'loaded') });
          }
          await document.fonts.ready;
          return result;
        });
        assert.ok(loaded.every(font => font.count > 0 && font.loaded), `${name}/${language}: real font faces, not a successful fallback check`);
        assert.ok(fonts.length > 0 && fonts.every(font => font.status === 200 && font.path.startsWith('/assets/')), `${name}/${language}: local font responses succeed`);
        assert.ok(fonts.some(font => /instrument-serif-[23]-/.test(font.path)), 'normal serif uses the real font rather than a local Georgia alias');
        assert.equal(await page.locator('html').getAttribute('dir'), language === 'ar' ? 'rtl' : 'ltr');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}/${language}: font metrics fit the viewport`);
        assert.deepEqual(errors, [], `${name}/${language}`);
        await page.screenshot({ path: path.join(os.tmpdir(), `oxsteed-font-${name}-${language}.png`) });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await fixture.close(); }
});
