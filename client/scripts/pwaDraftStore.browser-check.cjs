const test = require('node:test'),
  assert = require('node:assert/strict'),
  http = require('node:http'),
  path = require('node:path');
const { build } = require('esbuild'),
  { chromium } = require('playwright-core');
test(
  'photo drafts survive an interrupted final write, expire, and cannot cross accounts; history restores scroll',
  { timeout: 60000 },
  async () => {
    const root = path.resolve(__dirname, '..'),
      bundle = await build({
        stdin: {
          resolveDir: root,
          loader: 'jsx',
          contents: `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route,Link}from'react-router-dom';import ScrollToTop from './src/components/ScrollToTop';import * as drafts from './src/utils/jobDraftStore';window.drafts=drafts;function List(){return <div style={{height:2400}}><Link style={{position:'fixed',top:5}} to='/detail'>Open detail</Link></div>;}createRoot(document.getElementById('root')).render(<BrowserRouter><ScrollToTop/><Routes><Route path='/' element={<List/>}/><Route path='/detail' element={<p>Details</p>}/></Routes></BrowserRouter>);`,
        },
        bundle: true,
        write: false,
        format: 'esm',
      });
    const server = http.createServer((req, res) => {
      if (req.url === '/app.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(bundle.outputFiles[0].contents);
      } else {
        res.setHeader('Content-Type', 'text/html');
        res.end(
          '<div id="root"></div><script type="module" src="/app.js"></script>',
        );
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
      }),
      page = await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.drafts);
      const result = await page.evaluate(async () => {
        const d = window.drafts;
        d.setDraftAccount('one');
        const file = new File(['photo'], 'repair.png', {
          type: 'image/png',
          lastModified: 123,
        });
        let modified = 123;
        Object.defineProperty(file, 'lastModified', { get: () => modified++ });
        await d.saveJobDraft('one', {
          payload: { title: 'Original' },
          wizard_step: 1,
          mediaTab: 'photos',
          files: [file],
        });
        const text = JSON.parse(localStorage.getItem('oxsteed:job-draft:one'));
        text.savedAt += 1000;
        text.payload.title = 'Latest text';
        localStorage.setItem('oxsteed:job-draft:one', JSON.stringify(text));
        await d.saveJobDraft('one', {
          payload: { title: 'Original' },
          wizard_step: 1,
          mediaTab: 'photos',
          files: [file],
        });
        const text2 = JSON.parse(localStorage.getItem('oxsteed:job-draft:one'));
        text2.savedAt += 1000;
        text2.payload.title = 'Latest text';
        localStorage.setItem('oxsteed:job-draft:one', JSON.stringify(text2));
        const restored = await d.readJobDraft('one');
        const nativeOpen = indexedDB.open.bind(indexedDB);
        indexedDB.open = () => {
          throw new DOMException('full', 'QuotaExceededError');
        };
        const fallback = await d.saveJobDraft('one', {
          payload: { title: 'Quota recovery' },
          mediaTab: 'photos',
          files: [file],
        });
        indexedDB.open = nativeOpen;
        const pending = d.saveJobDraft('one', {
          payload: { title: 'Late stale write' },
          mediaTab: 'photos',
          files: [file],
        });
        await d.clearJobDraft('one');
        await pending;
        const cleared = await d.readJobDraft('one');
        await d.saveJobDraft('one', {
          payload: { title: 'Private draft' },
          mediaTab: 'photos',
          files: [file],
        });
        d.setDraftAccount('two');
        const other = await d.readJobDraft('one');
        d.setDraftAccount('one');
        await new Promise((r) => setTimeout(r, 50));
        const previous = await d.readJobDraft('one');
        await d.saveJobDraft('one', {
          payload: { title: 'Expired' },
          mediaTab: 'photos',
          files: [],
        });
        const db = await new Promise((resolve) => {
          const r = indexedDB.open('oxsteed-job-drafts', 1);
          r.onsuccess = () => resolve(r.result);
        });
        await new Promise((resolve) => {
          const tx = db.transaction('drafts', 'readwrite'),
            store = tx.objectStore('drafts'),
            get = store.get('one');
          get.onsuccess = () => store.put({ ...get.result, savedAt: 0 });
          tx.oncomplete = resolve;
        });
        db.close();
        localStorage.removeItem('oxsteed:job-draft:one');
        const expired = await d.readJobDraft('one');
        return {
          title: restored.payload.title,
          photos: restored.files.length,
          name: restored.files[0].name,
          fallback,
          cleared,
          other,
          previous,
          expired,
        };
      });
      assert.equal(result.title, 'Latest text');
      assert.equal(result.photos, 1);
      assert.equal(result.name, 'repair.png');
      assert.deepEqual(result.fallback, { saved: true, photosSaved: false });
      for (const key of ['cleared', 'other', 'previous', 'expired'])
        assert.equal(result[key], null, key);
      await page.evaluate(() => window.scrollTo(0, 800));
      await page.waitForTimeout(100);
      await page.getByRole('link', { name: 'Open detail' }).click();
      await page.waitForURL('**/detail');
      await page.goBack();
      await page.waitForFunction(() => Math.abs(window.scrollY - 800) < 4);
      assert.equal(await page.evaluate(() => window.scrollY), 800);
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
    }
  },
);
