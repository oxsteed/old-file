const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

const mocks = {
  'react-i18next': `export const useTranslation = () => ({ t: window.translate,
    i18n: { language: 'en' } });`,
  '../../context/AuthContext': `export const useAuth = () => ({ user: null });`,
  '../../api/media': `const call = (name, args) => { window.calls.push({ name, args }); };
    export const getCommunities = async () => ({ communities: [] });
    export const getDrafts = async () => ({ drafts: window.draft ? [window.draft] : [] });
    export const getDraft = async () => ({ draft: { ...window.draft, processing_status: 'ready' } });
    export const searchMediaEntities = async () => ({ entities: [] });
    export const createPost = async data => { call('create', [data]); window.draft = { ...data, id: 'draft', assets: [] };
      return { post: window.draft }; };
    export const updateDraft = async (id, data) => { call('update', [id, data]); window.draft = { ...window.draft, ...data }; };
    const upload = async (id, file, progress, replace) => {
      call('upload', [id, file.name, replace]); progress({ loaded: 1, total: 2 });
      if (window.failUpload) { window.failUpload = false; throw { response: { data: { error: 'Synthetic scanner outage', code: 'media_scan_unavailable' } } }; }
      window.draft.assets = [{ id: 'attachment' }]; return { asset: window.draft.assets[0] };
    };
    export const uploadPhoto = upload, uploadVideo = upload;
    export const linkAsset = async (...args) => call('link', args);
    export const publishPost = async id => { call('publish', [id]);
      if (window.processing) { window.processing = false; throw { response: { data: { code: 'media_safety_pending', processing_status: 'quarantine' } } }; }
      return { post: { id } }; };
    const forbiddenWrite = () => { throw new Error('Guest must not write'); };
    export const toggleLike = forbiddenWrite, toggleBookmark = forbiddenWrite, toggleRepost = forbiddenWrite,
      createCreatorBoost = forbiddenWrite, settleCreatorBoost = forbiddenWrite, flagPost = forbiddenWrite;
    export const recordShare = async () => ({ share_count: 1 });`,
};

async function fixture() {
  const result = await build({
    stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'jsx', contents: `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
      import Compose from './src/pages/media/MediaComposePage.jsx';
      import Card from './src/pages/media/MediaPostCard.jsx';
      window.calls = []; window.translate = (key, options = {}) => options.defaultValue || key;
      if (location.search.includes('restored')) {
        window.draft = { id: 'draft', body: 'Retained draft', links: [], assets: [{ id: 'failed' }], processing_status: 'failed' };
        localStorage.setItem('oxsteed.media.compose.draft', 'draft'); window.processing = true;
      } else { localStorage.removeItem('oxsteed.media.compose.draft'); window.failUpload = true; }
      const post = { id: 'post', display_name: 'Synthetic helper', handle: 'helper', verified_kind: 'identity',
        created_at: new Date().toISOString(), body: 'Local work', like_count: 0, bookmark_count: 0,
        repost_count: 0, reply_count: 0, share_count: 0, view_count: 0, links: [
          ...['food_item','helper','job','tool_rental','direct_catalog'].map(type => ({ id: type, link_type: type,
            available: true, canonical_url: '/public/' + type, name_snapshot: type })),
          { id: 'removed', link_type: 'business', available: false, name_snapshot: 'Removed business' }
        ] };
      const Destination = () => { const location = useLocation(); return <p data-destination>{location.pathname}</p>; };
      createRoot(document.getElementById('root')).render(<BrowserRouter><Routes>
        <Route path="/media/compose" element={<Compose />} />
        <Route path="/media/card" element={<Card post={post} />} />
        <Route path="*" element={<Destination />} />
      </Routes></BrowserRouter>);` },
    bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'media-fixture', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'media-test' } : undefined);
      plugin.onLoad({ filter: /.*/, namespace: 'media-test' }, args => ({ contents: mocks[args.path], loader: 'jsx' }));
    } }],
  });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(result.outputFiles[0].contents); }
    else res.end('<div id="root"></div><script type="module" src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

test('composer retains edits after upload failure and replaces failed restored attachments', async () => {
  const app = await fixture(); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    for (const restored of [false, true]) {
      const page = await browser.newPage({ viewport: { width: restored ? 390 : 1440, height: 900 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${app.url}/media/compose${restored ? '?restored' : ''}`);
      if (restored) await page.waitForFunction(() => document.querySelector('textarea').value === 'Retained draft');
      await page.locator('textarea').fill('First draft');
      await page.locator('input[type=file]').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('synthetic') });
      await page.locator('button[type=submit]').click();
      if (restored) {
        await page.waitForFunction(() => document.querySelector('[data-processing-status]')?.dataset.processingStatus === 'ready');
      } else {
        await page.getByRole('alert').filter({ hasText: 'Synthetic scanner outage' }).waitFor();
      }
      await page.locator('textarea').fill('Edited after failure');
      await page.locator('button[type=submit]').click();
      await page.locator('[data-destination]').filter({ hasText: '/media/post/draft' }).waitFor();
      const calls = await page.evaluate(() => window.calls);
      assert.equal(calls.filter(c => c.name === 'create').length, restored ? 0 : 1);
      const uploads = calls.filter(c => c.name === 'upload');
      assert.equal(uploads.length, restored ? 1 : 2);
      assert(uploads.every(c => c.args[0] === 'draft' && c.args[2] === true));
      assert.equal(calls.filter(c => c.name === 'update').at(-1).args[1].body, 'Edited after failure');
      assert.equal(await page.evaluate(() => localStorage.getItem('oxsteed.media.compose.draft')), null);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { if (browser) await browser.close(); await app.close(); }
});

test('guest Linked on OxSteed cards open public pages; removed targets stay inert', async () => {
  const app = await fixture(); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    for (const type of ['food_item', 'helper', 'job', 'tool_rental', 'direct_catalog']) {
      await page.goto(`${app.url}/media/card`);
      assert.equal(await page.locator('a').filter({ hasText: 'Removed business' }).count(), 0);
      await page.locator(`a[href="/public/${type}"]`).click();
      await page.locator('[data-destination]').filter({ hasText: `/public/${type}` }).waitFor();
    }
  } finally { if (browser) await browser.close(); await app.close(); }
});
