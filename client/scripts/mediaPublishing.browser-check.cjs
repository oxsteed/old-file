const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

const mocks = {
  'react-i18next': `export const useTranslation = () => ({ t: window.translate,
    i18n: { language: 'en' } });`,
  '../../context/AuthContext': `export const useAuth = () => ({ user: window.signedIn ? { id: 'viewer' } : null });`,
  '../../api/media': `const call = (name, args) => { window.calls.push({ name, args }); };
    export const getCommunities = async () => ({ communities: [] });
    export const getMediaVerification = async () => ({ publishers: [{ key: 'user:viewer', actor_type: 'user', actor_id: 'actor', display_name: 'Synthetic member', location: { city: 'Springfield', region: 'OH' }, eligibility: { photo: true, video: true } }], helper: { is_verified: true }, businesses: [], restaurants: [] });
    export const getDrafts = async () => ({ drafts: window.draft ? [window.draft] : [] });
    export const getDraft = async () => ({ draft: structuredClone(window.draft) });
    export const searchMediaEntities = async () => ({ entities: [] });
    export const createPost = async data => { call('create', [data]); const now = new Date().toISOString();
      if (window.creationRequest && JSON.stringify(data) !== window.creationRequest) throw { response: { data: { code: 'media_request_conflict', error: 'Replay mismatch' } } };
      window.creationRequest = JSON.stringify(data);
      window.draft = window.draft || { ...data, actor_type: 'user', actor_id: 'actor', display_name: 'Synthetic member', location_city: 'Springfield', location_region: 'OH', id: 'draft', assets: [], created_at: now, updated_at: now };
      if (window.failCreate) { window.failCreate = false; throw new Error('Lost create response'); }
      return { post: window.draft }; };
    export const updateDraft = async (id, data) => { call('update', [id, data]);
      if (window.deferUpdate) { window.deferUpdate = false; await new Promise(resolve => { window.releaseUpdate = resolve; }); }
      window.draft = { ...window.draft, ...data, updated_at: new Date().toISOString() }; return { post: structuredClone(window.draft) }; };
    export const deletePost = async id => { call('delete', [id]); window.draft = null; };
    const upload = async (id, file, progress, replace) => {
      call('upload', [id, file.name, replace]); progress({ loaded: 1, total: 2 });
      if (window.failUpload) { window.failUpload = false; throw { response: { data: { error: 'Synthetic scanner outage', code: 'media_scan_unavailable' } } }; }
      const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const content_sha256 = [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
      window.draft.assets = [{ id: 'attachment', asset_type: 'image', processing_status: 'ready', content_sha256, sort_order: 0 }];
      if (window.loseUploadResponse) { window.loseUploadResponse = false; throw new Error('Lost upload response'); }
      return { asset: window.draft.assets[0] };
    };
    export const uploadPhoto = upload, uploadVideo = upload;
    export const linkAsset = async (...args) => call('link', args);
    export const removeMediaAsset = async (id, assetId) => {
      call('remove', [id, assetId]);
      if (window.deferRemove) await new Promise(resolve => { window.releaseRemove = resolve; });
      window.draft.assets = window.draft.assets.filter(asset => asset.id !== assetId);
    };
    export const reorderMediaAssets = async (...args) => call('reorder', args);
    export const updateMediaAsset = async (id, assetId, data) => { call('updateAsset', [id, assetId, data]);
      if (window.failMetadata) { window.failMetadata = false; throw { response: { data: { error: 'Synthetic metadata outage' } } }; }
      const asset = window.draft.assets.find(item => item.id === assetId); Object.assign(asset, data); return { asset }; };
    export const uploadMediaCaption = async (...args) => call('caption', args);
    export const publishPost = async id => { call('publish', [id]);
      if (window.processing) { window.processing = false; throw { response: { data: { code: 'media_safety_pending', processing_status: 'quarantine' } } }; }
      return { post: { id } }; };
    const forbiddenWrite = () => { throw new Error('Guest must not write'); };
    const actionError = () => { throw { response: { data: { error: 'Synthetic action outage' } } }; };
    export const toggleLike = actionError, toggleBookmark = actionError, toggleRepost = actionError,
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
      import { MediaGuestGateProvider } from './src/pages/media/MediaGuestGate.jsx';
      window.calls = []; window.translate = (key, options = {}) => options.defaultValue || key;
      window.signedIn = location.pathname.includes('compose') || location.search.includes('actions');
      window.deferUpdate = location.search.includes('delayed');
      window.failCreate = location.search.includes('lost-create');
      window.loseUploadResponse = location.search.includes('lost-upload');
      window.failMetadata = location.search.includes('metadata');
      if (location.search.includes('restored')) {
        window.draft = { id: 'draft', actor_id: 'actor', actor_type: 'user', body: 'Retained draft', links: [], assets: [{ id: 'failed', asset_type: 'image', processing_status: 'failed' }], processing_status: 'failed', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        localStorage.setItem('oxsteed.media.compose.draft:viewer', 'draft');
      } else { localStorage.removeItem('oxsteed.media.compose.draft:viewer'); window.failUpload = !location.search.includes('lost-upload'); }
      const post = { id: 'post', display_name: 'Synthetic helper', handle: 'helper', verified_kind: 'identity',
        created_at: new Date().toISOString(), body: 'Local work', like_count: 0, bookmark_count: 0,
        repost_count: 0, reply_count: 0, share_count: 0, view_count: 0, links: [
          ...['restaurant', 'business', 'logistics_campaign'].map(type => ({ id: type, link_type: type,
            available: true, canonical_url: '/public/' + type, name_snapshot: type, cta: 'View' })),
          ...['food_item', 'helper', 'job', 'tool_rental', 'direct_catalog'].map(type => ({ id: 'tx-' + type, link_type: type,
            available: true, canonical_url: '/public/' + type, name_snapshot: type, cta: type === 'food_item' ? 'Order' : type === 'job' ? 'Apply' : type === 'tool_rental' ? 'Rent' : 'Book' })),
          { id: 'removed', link_type: 'business', available: false, name_snapshot: 'Removed business' }
        ], ...(location.search.includes('warning') ? { content_warning: 'Synthetic warning', assets: [{ id: 'photo', asset_type: 'image', url: '/synthetic.jpg', alt_text: 'A synthetic accessible image' }, { id: 'video', asset_type: 'video', url: '/synthetic.mp4', caption_url: '/synthetic.vtt', caption_language: 'fr' }] } : {}) };
      const Destination = () => { const location = useLocation(); return <p data-destination>{location.pathname}</p>; };
      createRoot(document.getElementById('root')).render(<BrowserRouter><Routes>
        <Route path="/media/compose" element={<Compose />} />
        <Route path="/media/card" element={<MediaGuestGateProvider><Card post={post} /></MediaGuestGateProvider>} />
        <Route path="*" element={<Destination />} />
      </Routes></BrowserRouter>);` },
    bundle: true, write: false, jsx: 'automatic', define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
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
      if (!restored) {
        await page.locator('.media-attachment-card.state-failed').filter({ hasText: 'Synthetic scanner outage' }).waitFor();
        await page.getByRole('button', { name: 'media.compose.retry', exact: true }).click();
        await page.locator('.media-attachment-card.state-ready').waitFor();
      }
      await page.locator('textarea').fill('Edited after failure');
      await page.locator('button[type=submit]').click();
      await page.locator('[data-destination]').filter({ hasText: '/media/post/draft' }).waitFor();
      const calls = await page.evaluate(() => window.calls);
      assert.equal(calls.filter(c => c.name === 'create').length, restored ? 0 : 1);
      const uploads = calls.filter(c => c.name === 'upload');
      assert.equal(uploads.length, restored ? 1 : 2);
      assert.equal(calls.filter(c => c.name === 'update').at(-1).args[1].body, 'Edited after failure');
      assert.equal(await page.evaluate(() => localStorage.getItem('oxsteed.media.compose.draft:viewer')), null);
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
    for (const type of ['restaurant', 'business', 'logistics_campaign']) {
      await page.goto(`${app.url}/media/card`);
      assert.equal(await page.locator('a').filter({ hasText: 'Removed business' }).count(), 0);
      await page.locator(`a[href="/public/${type}"]`).click();
      await page.locator('[data-destination]').filter({ hasText: `/public/${type}` }).waitFor();
    }
  } finally { if (browser) await browser.close(); await app.close(); }
});

test('delayed autosave cannot acknowledge newer typing and publish flushes the latest edit', async () => {
  const app = await fixture(); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    await page.goto(`${app.url}/media/compose?delayed`);
    await page.locator('textarea').fill('First version');
    await page.getByRole('button', { name: 'media.compose.saveDraft', exact: true }).click();
    await page.waitForFunction(() => Boolean(window.releaseUpdate));
    await page.locator('textarea').fill('Newer typing while saving');
    await page.evaluate(() => window.releaseUpdate());
    await page.waitForFunction(() => window.draft.body === 'First version');
    assert.equal(await page.locator('.media-save-state.state-saved').count(), 0);
    await page.locator('button[type=submit]').click();
    await page.locator('[data-destination]').waitFor();
    assert.equal(await page.evaluate(() => window.draft.body), 'Newer typing while saving');
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.name === 'create').length), 1);
  } finally { if (browser) await browser.close(); await app.close(); }
});

test('lost creation response replays the original request after reload before saving newer edits', async () => {
  const app = await fixture(); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    await page.goto(`${app.url}/media/compose?lost-create`);
    await page.locator('textarea').fill('Initial request');
    await page.getByRole('button', { name: 'media.compose.saveDraft', exact: true }).click();
    await page.locator('.media-save-state.state-error').waitFor();
    const request = await page.evaluate(() => localStorage.getItem('oxsteed.media.compose.request:viewer'));
    assert.equal(JSON.parse(request).body, 'Initial request');
    await page.reload();
    // Represent the durable server request that survived the lost response.
    await page.evaluate(value => { window.creationRequest = value; window.failCreate = false; }, request);
    await page.locator('textarea').fill('New edit after reload');
    await page.getByRole('button', { name: 'media.compose.saveDraft', exact: true }).click();
    await page.locator('.media-save-state.state-saved').waitFor();
    const calls = await page.evaluate(() => window.calls);
    assert.equal(calls.find(call => call.name === 'create').args[0].body, 'Initial request');
    assert.equal(await page.evaluate(() => window.draft.body), 'New edit after reload');
    assert.equal(await page.evaluate(() => localStorage.getItem('oxsteed.media.compose.request:viewer')), null);
  } finally { if (browser) await browser.close(); await app.close(); }
});

test('lost upload response reconciles the committed digest without another upload or retry row', async () => {
  const app = await fixture(); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${app.url}/media/compose?lost-upload`);
    await page.locator('input[type=file]').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('synthetic') });
    await page.locator('.media-attachment-card.state-ready').waitFor();
    assert.equal(await page.locator('.media-attachment-card.state-failed').count(), 0);
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.name === 'upload').length), 1);
    await page.locator('button[type=submit]').click();
    await page.locator('[data-destination]').waitFor();
  } finally { if (browser) await browser.close(); await app.close(); }
});

test('starting another draft saves the current work and unsaved navigation can be cancelled', async () => {
  const app = await fixture(); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    await page.goto(`${app.url}/media/compose`);
    await page.locator('textarea').fill('Retain this before starting new');
    await page.getByRole('button', { name: 'media.compose.startNew', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('textarea').value === '');
    assert.equal(await page.evaluate(() => window.draft.body), 'Retain this before starting new');
    assert.equal(await page.locator('.media-drafts-list button').count(), 1);
    await page.locator('textarea').fill('Unacknowledged changes');
    await page.evaluate(() => {
      const link = document.createElement('a'); link.href = '/media/search'; link.textContent = 'Synthetic shell navigation'; document.body.append(link);
    });
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('link', { name: 'Synthetic shell navigation' }).click();
    assert.equal(new URL(page.url()).pathname, '/media/compose');
    assert.equal(await page.locator('textarea').inputValue(), 'Unacknowledged changes');
  } finally { if (browser) await browser.close(); await app.close(); }
});

test('warnings withhold media requests until acknowledgement; alt text and captions are displayed', async () => {
  const app = await fixture(); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    const mediaRequests = [];
    page.on('request', req => { if (req.url().includes('/synthetic.')) mediaRequests.push(req.url()); });
    await page.goto(`${app.url}/media/card?warning`);
    await page.getByText('Synthetic warning', { exact: true }).waitFor();
    assert.equal(await page.locator('.media-post-assets').count(), 0);
    assert.deepEqual(mediaRequests, []);
    await page.getByRole('button', { name: 'media.post.showMedia', exact: true }).click();
    assert.equal(await page.getByRole('img', { name: 'A synthetic accessible image' }).count(), 1);
    assert.equal(await page.locator('video track[kind=captions]').getAttribute('src'), '/synthetic.vtt');
    assert.equal(await page.locator('video track').getAttribute('srclang'), 'fr');
    await page.getByRole('button', { name: 'media.post.hideMedia', exact: true }).click();
    assert.equal(await page.locator('.media-post-assets').count(), 0);
  } finally { if (browser) await browser.close(); await app.close(); }
});

test('attachment mutations keep the active draft in place until the server acknowledges them', async () => {
  const app = await fixture(); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    await page.goto(`${app.url}/media/compose?restored`);
    await page.locator('.media-attachment-card').waitFor();
    await page.evaluate(() => { window.deferRemove = true; });
    await page.getByRole('button', { name: 'media.compose.remove', exact: true }).click();
    await page.waitForFunction(() => Boolean(window.releaseRemove));
    await page.getByRole('button', { name: 'media.compose.newDraft', exact: true }).click();
    assert.equal(await page.locator('textarea').inputValue(), 'Retained draft');
    assert.equal(await page.locator('button[type=submit]').isDisabled(), true);
    await page.evaluate(() => window.releaseRemove());
    await page.waitForFunction(() => document.querySelectorAll('.media-attachment-card').length === 0);
    await page.getByRole('button', { name: 'media.compose.startNew', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('textarea').value === '');
    assert.equal(await page.evaluate(() => window.draft.body), 'Retained draft');
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.name === 'remove').length), 1);
  } finally { if (browser) await browser.close(); await app.close(); }
});

test('failed alternative-text saves remain retryable and publish waits for the metadata acknowledgement', async () => {
  const app = await fixture(); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    await page.goto(`${app.url}/media/compose?restored&metadata`);
    await page.locator('textarea').filter({ hasText: 'Retained draft' }).waitFor();
    await page.getByRole('textbox', { name: 'media.compose.altText', exact: true }).fill('Useful image description');
    await page.locator('textarea').focus();
    await page.locator('.media-compose-error').filter({ hasText: 'Synthetic metadata outage' }).waitFor();
    assert.equal(await page.locator('.media-save-state.state-saved').count(), 0);
    await page.locator('button[type=submit]').click();
    await page.locator('[data-destination]').waitFor();
    assert.equal(await page.evaluate(() => window.draft.assets[0].alt_text), 'Useful image description');
    const calls = await page.evaluate(() => window.calls);
    assert.ok(calls.findLastIndex(call => call.name === 'updateAsset') < calls.findLastIndex(call => call.name === 'publish'));
  } finally { if (browser) await browser.close(); await app.close(); }
});

test('guest transactional Linked chips open the sign-in gate with a return path', async () => {
  const app = await fixture(); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${app.url}/media/card`);
    await page.locator('a[href="/public/food_item"]').click();
    await page.locator('#media-guest-sign-in-title').waitFor();
    assert.equal(await page.locator('a.media-primary-button').getAttribute('href'), '/login');
    assert.equal(await page.locator('[data-destination]').count(), 0);
  } finally { if (browser) await browser.close(); await app.close(); }
});

test('signed-in Media actions surface failures and suppress duplicate clicks', async () => {
  const app = await fixture(); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${app.url}/media/card?actions`);
    const like = page.getByRole('button', { name: /Like/ });
    await like.click();
    await page.getByRole('status').filter({ hasText: 'Synthetic action outage' }).waitFor();
    assert.equal(await page.getByRole('status').filter({ hasText: 'Synthetic action outage' }).count(), 1);
    assert.equal(await page.locator('button[aria-label="Like"]').count(), 1);
  } finally { if (browser) await browser.close(); await app.close(); }
});
