// Run with Playwright available (NODE_PATH may point to a tooling installation):
// node --test scripts/qrGenerator.browser-check.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright');

test('QR page renders without a logo, exports, saves, and handles input changes', async () => {
  const mocks = {
    'react-i18next': `const t = key => key; export const useTranslation = () => ({t});`,
    '../hooks/useAuth': `export const useAuth = () => ({user: {id: 'qr-test', membership_tier: 'pro', role: 'customer'}});`,
    'react-hot-toast': `export default {success() {}, error(message) { window.qrErrors.push(message); }};`,
    '../components/Navbar': 'export default () => null;',
    '../components/Footer': 'export default () => null;',
    '../components/PageMeta': 'export default () => null;',
    '../utils/logger': 'export default {error() {}};',
    '../api/qrCodes': `export default {
      getAll: async () => ({data: {data: window.savedQRs}}),
      create: async payload => {
        window.savedQRs.push({id: 1, title: payload.title, url: payload.url,
          image_url: payload.imageData, image_format: payload.imageFormat,
          size: payload.size, download_count: 0});
        window.savedPayload = payload;
        return {data: {success: true}};
      },
      download: async () => ({data: {data: {imageUrl: window.savedQRs[0].image_url}}}),
      delete: async () => {window.savedQRs = [];}
    };`,
  };
  const result = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import Page from './src/pages/QRCodeGeneratorPage.jsx';
        window.qrErrors = []; window.savedQRs = [];
        createRoot(document.getElementById('root')).render(<Page />);`,
      resolveDir: path.resolve(__dirname, '..'), loader: 'jsx',
    },
    bundle: true, write: false, loader: {'.css': 'empty'},
    plugins: [{name: 'isolated-page-dependencies', setup(plugin) {
      plugin.onResolve({filter: /.*/}, args => mocks[args.path]
        ? {path: args.path, namespace: 'qr-test'} : undefined);
      plugin.onLoad({filter: /.*/, namespace: 'qr-test'}, args => ({contents: mocks[args.path], loader: 'js'}));
    }}],
  });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(result.outputFiles[0].contents);
    } else res.end('<div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless: true, channel: 'chrome'});
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const png = page.getByRole('button', {name: 'qrGenerator.downloadPNG', exact: true}).first();
    await page.waitForFunction(() => document.querySelector('.qrg-preview-container canvas') &&
      !document.querySelector('.qrg-download-buttons button').disabled);
    await page.locator('#title').fill('QR regression');
    await page.locator('#url').fill('https://example.com/qr-regression');
    await page.waitForFunction(() => !document.querySelector('.qrg-download-buttons button').disabled);
    for (const [button, format] of [[png, 'png'], [page.getByRole('button', {name: 'qrGenerator.downloadSVG', exact: true}), 'svg']]) {
      const downloadPromise = page.waitForEvent('download');
      await button.click();
      const download = await downloadPromise;
      const chunks = [];
      for await (const chunk of await download.createReadStream()) chunks.push(chunk);
      const content = Buffer.concat(chunks);
      assert.ok(content.length > 100, `${format} must contain image data`);
      if (format === 'png') assert.equal(content.subarray(1, 4).toString(), 'PNG');
      else assert.match(content.toString(), /<svg/);
    }
    const logo = await page.locator('.qrg-preview-container canvas').evaluate(canvas => canvas.toDataURL());
    await page.locator('#logoUpload').setInputFiles({name:'logo.png', mimeType:'image/png', buffer:Buffer.from(logo.split(',')[1], 'base64')});
    await page.waitForFunction(() => !document.querySelector('.qrg-download-buttons button').disabled);
    await page.getByRole('button', {name: 'qrGenerator.removeLogo'}).click();
    await page.waitForFunction(() => !document.querySelector('.qrg-download-buttons button').disabled);
    await page.locator('#url').fill('');
    assert.equal(await png.isDisabled(), true);
    assert.equal(await page.getByRole('button', {name:'qrGenerator.save',exact:true}).isDisabled(), true);
    await page.locator('#url').fill('https://example.com/final');
    await page.waitForFunction(() => !document.querySelector('.qrg-download-buttons button').disabled);
    await page.getByRole('button', {name:'qrGenerator.save',exact:true}).click();
    await page.locator('.qrg-modal').getByRole('button', {name:'qrGenerator.save',exact:true}).click();
    await page.locator('.qrg-card').waitFor();
    const saved = await page.evaluate(() => window.savedPayload);
    assert.equal(saved.url, 'https://example.com/final');
    assert.match(saved.imageData, /^data:image\/png;base64,/);
    const savedDownloadPromise = page.waitForEvent('download');
    await page.locator('.qrg-card').getByRole('button', {name:'qrGenerator.downloadPNG'}).click();
    assert.equal((await savedDownloadPromise).suggestedFilename(), 'QR regression.png');
    assert.deepEqual(await page.evaluate(() => window.qrErrors), []);
    assert.deepEqual(errors, []);
    console.log('Verified real canvas rendering, PNG/SVG exports, logo add/remove, blank-input guards, save payload, and saved download.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
