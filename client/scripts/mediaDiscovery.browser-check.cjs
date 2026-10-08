const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

async function fixture() {
  const mocks = {
    'react-i18next': `export const useTranslation = () => ({ t: window.translate });`,
    '../../context/AuthContext': `export const useAuth = () => ({ user: window.viewer });`,
    '../../components/PageMeta': `export default function Meta() { return null; }`,
    './MediaPostCard': `import React from 'react'; export default function Card({ post }) { return <p data-post={post.id}>{post.body}</p>; }`,
    '../../api/media': `export const getFeed = params => new Promise((resolve, reject) => {
      window.requests.push({ params, resolve, reject });
    });`,
  };
  const result = await build({
    stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'jsx', contents: `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { BrowserRouter } from 'react-router-dom';
      import Feed from './src/pages/media/MediaFeedPage.jsx';
      window.requests = []; window.viewer = location.search.includes('guest') ? null : { id: 'synthetic-viewer' };
      window.translate = key => key;
      createRoot(document.getElementById('root')).render(<BrowserRouter><Feed /></BrowserRouter>);` },
    bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'discovery-fixture', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: path.resolve(__dirname, '..') }));
    } }],
  });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(result.outputFiles[0].contents); }
    else res.end('<div id="root"></div><script type="module" src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
async function settle(page, index, ids, hasMore = false) {
  await page.evaluate(({ index, ids, hasMore }) => window.requests[index].resolve({
    posts: ids.map(id => ({ id, body: id })), has_more: hasMore, next_before: hasMore ? 'synthetic-cursor' : null,
  }), { index, ids, hasMore });
}

test('older tab/location responses cannot overwrite the current feed; pagination deduplicates', async () => {
  const app = await fixture(); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(app.url);
    await page.waitForFunction(() => window.requests.length === 1);
    await page.getByRole('button', { name: 'media.feed.following', exact: true }).click();
    await page.waitForFunction(() => window.requests.length === 2);
    assert.equal(await page.evaluate(() => window.requests[1].params.tab), 'following');
    await settle(page, 1, ['following-post'], true);
    await page.locator('[data-post="following-post"]').waitFor();
    await settle(page, 0, ['stale-home']);
    await page.getByRole('button', { name: 'media.feed.loadMore', exact: true }).click();
    await page.waitForFunction(() => window.requests.length === 3);
    await settle(page, 2, ['following-post', 'second-following']);
    await page.locator('[data-post="second-following"]').waitFor();
    assert.equal(await page.locator('[data-post="following-post"]').count(), 1);
    assert.equal(await page.locator('[data-post="stale-home"]').count(), 0);

    await page.getByRole('button', { name: 'media.feed.refresh', exact: true }).click();
    await page.waitForFunction(() => window.requests.length === 4);
    await page.getByRole('button', { name: 'media.feed.chooseLocation', exact: true }).click();
    await page.getByLabel('media.feed.city', { exact: true }).fill('Springfield');
    await page.getByLabel('media.feed.state', { exact: true }).fill('OH');
    await page.getByRole('button', { name: 'media.feed.applyLocation', exact: true }).click();
    await page.waitForFunction(() => window.requests.length === 5);
    await settle(page, 4, ['local-post']);
    await page.locator('[data-post="local-post"]').waitFor();
    await settle(page, 3, ['old-location']);
    await page.getByRole('button', { name: 'Springfield, OH', exact: true }).click();
    assert.equal(await page.locator('[data-post="old-location"]').count(), 0);
    assert.deepEqual(errors, []);
  } finally { if (browser) await browser.close(); await app.close(); }
});

test('guests choose and retain locations; device permission is requested only on their action', async () => {
  const app = await fixture(); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => {
      window.geoCalls = 0;
      Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: success => {
        window.geoCalls += 1; success({ coords: { latitude: 39.92412, longitude: -83.81055 } });
      } } });
    });
    await page.goto(`${app.url}/?guest`);
    await page.waitForFunction(() => window.requests.length === 1);
    assert.equal(await page.evaluate(() => window.geoCalls), 0);
    await page.getByRole('button', { name: 'media.feed.chooseLocation', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'media.feed.following', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'media.feed.useDeviceLocation', exact: true }).click();
    await page.waitForFunction(() => window.requests.length === 2);
    assert.equal(await page.evaluate(() => window.geoCalls), 1);
    assert.deepEqual(await page.evaluate(() => window.requests[1].params),
      { before: null, limit: 20, tab: 'home', location_mode: 'custom', latitude: 39.924, longitude: -83.811 });
    await page.reload();
    await page.waitForFunction(() => window.requests.length === 1);
    assert.equal(await page.evaluate(() => window.geoCalls), 0);
    assert.equal(await page.evaluate(() => window.requests[0].params.latitude), 39.924);
    await page.getByRole('button', { name: 'media.feed.nearDevice', exact: true }).click();
    await page.getByRole('button', { name: 'media.feed.allLocations', exact: true }).click();
    await page.waitForFunction(() => window.requests.length === 2);
    assert.equal(await page.evaluate(() => window.requests[1].params.latitude), undefined);
    assert.equal(await page.evaluate(() => window.requests[1].params.location_mode), 'all');
  } finally { if (browser) await browser.close(); await app.close(); }
});
