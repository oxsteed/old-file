// Run with playwright-core and Chrome available (NODE_PATH may point to tooling):
// node --test scripts/qrGenerator.browser-check.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

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
      download: async () => ({data: {data: {imageUrl: '/saved-qr.png'}}}),
      delete: async () => {window.savedQRs = [];}
    };`,
  };
  const result = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
        import Page from './src/pages/QRCodeGeneratorPage.jsx';
        import {prepareQrLogo} from './src/utils/qrLogo.js';
        import QRCodeStyling from 'qr-code-styling';
        const getRawData = QRCodeStyling.prototype.getRawData;
        QRCodeStyling.prototype.getRawData = function (...args) {
          if (window.stallQrRender) {
            window.qrRenderStalled = true;
            return new Promise(() => {});
          }
          return getRawData.apply(this, args);
        };
        window.prepareQrLogo = prepareQrLogo;
        window.qrErrors = []; window.savedQRs = [];
        createRoot(document.getElementById('root')).render(<MemoryRouter><Page /></MemoryRouter>);`,
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
    // Production allows data images, but intentionally forbids fetching data
    // URLs via XHR/connect-src. A permissive development server hid this hang.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'");
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
    await page.route('**/saved-qr.png', async route => {
      const data = await page.evaluate(() => window.savedPayload.imageData);
      await route.fulfill({contentType: 'image/png', body: Buffer.from(data.split(',')[1], 'base64')});
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const downloadButton = page.getByRole('button', {name: 'qrGenerator.downloadSelected', exact: true});
    try {
      await page.waitForFunction(() => document.querySelector('.qrg-preview-container canvas') &&
        !document.querySelector('.qrg-download-buttons button').disabled);
    } catch (error) {
      const previewState = await page.evaluate(() => ({
        canvas: Boolean(document.querySelector('.qrg-preview-container canvas')),
        previewHtml: document.querySelector('.qrg-preview-container')?.innerHTML || '',
        buttonsDisabled: [...document.querySelectorAll('.qrg-download-buttons button')].map((button) => button.disabled),
      }));
      throw new Error(`${error.message}; pageErrors=${errors.join(' | ') || 'none'}; previewState=${JSON.stringify(previewState)}`);
    }
    await page.locator('#title').fill('QR regression');
    await page.locator('#url').fill('https://example.com/qr-regression');
    await page.waitForFunction(() => !document.querySelector('.qrg-download-buttons button').disabled);
    for (const format of ['png', 'svg']) {
      await page.locator('#downloadFormat').selectOption(format);
      const downloadPromise = page.waitForEvent('download');
      await downloadButton.click();
      const download = await downloadPromise;
      const chunks = [];
      for await (const chunk of await download.createReadStream()) chunks.push(chunk);
      const content = Buffer.concat(chunks);
      assert.ok(content.length > 100, `${format} must contain image data`);
      if (format === 'png') {
        assert.equal(content.subarray(1, 4).toString(), 'PNG');
        assert.equal(download.suggestedFilename(), 'qr-regression.png');
      } else {
        assert.match(content.toString(), /<svg/);
        assert.equal(download.suggestedFilename(), 'qr-regression.svg');
      }
    }
    await page.locator('.qrg-code-type-option').nth(1).click();
    await page.locator('#url').fill('DOCK-07-A');
    await page.waitForSelector('.qrg-preview-container img');
    await page.locator('#downloadFormat').selectOption('svg');
    const code128Download = page.waitForEvent('download');
    await downloadButton.click();
    const code128File = await code128Download;
    const code128Chunks = [];
    for await (const chunk of await code128File.createReadStream()) code128Chunks.push(chunk);
    const code128Export = Buffer.concat(code128Chunks).toString();
    const code128Source = code128Export.match(/base64,([^"']+)/);
    assert.ok(code128Source, 'Code 128 export must embed the barcode SVG');
    assert.match(Buffer.from(code128Source[1], 'base64').toString(), /DOCK-07-A/);
    await page.locator('.qrg-code-type-option').nth(2).click();
    await page.locator('#url').fill('400638133393');
    await page.waitForSelector('.qrg-preview-container img');
    await page.locator('.qrg-code-type-option').first().click();
    await page.locator('#url').fill('https://example.com/qr-regression');
    await page.waitForSelector('.qrg-preview-container canvas');
    await page.locator('#downloadFormat').selectOption('branded-svg');
    const brandedSvgDownload = page.waitForEvent('download');
    await downloadButton.click();
    const brandedSvg = await brandedSvgDownload;
    const brandedSvgChunks = [];
    for await (const chunk of await brandedSvg.createReadStream()) brandedSvgChunks.push(chunk);
    assert.match(Buffer.concat(brandedSvgChunks).toString(), /QR regression/);
    await page.locator('#downloadFormat').selectOption('promo-png');
    await page.locator('#promoDescription').fill('Discover our latest services and special offers.');
    await page.locator('#promoCta').fill('Scan to get started');
    const promoDownload = page.waitForEvent('download');
    await downloadButton.click();
    const promoFile = await promoDownload;
    const promoChunks = [];
    for await (const chunk of await promoFile.createReadStream()) promoChunks.push(chunk);
    const promoBytes = Buffer.concat(promoChunks);
    const promoSize = await page.evaluate(async (data) => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`;
      await image.decode();
      return {width: image.naturalWidth, height: image.naturalHeight};
    }, promoBytes.toString('base64'));
    assert.ok(promoSize.height > promoSize.width, 'promotional PNG must be a page layout');
    await page.locator('#downloadFormat').selectOption('promo-svg');
    const promoSvgDownload = page.waitForEvent('download');
    await downloadButton.click();
    const promoSvg = await promoSvgDownload;
    const promoSvgChunks = [];
    for await (const chunk of await promoSvg.createReadStream()) promoSvgChunks.push(chunk);
    const promoSvgText = Buffer.concat(promoSvgChunks).toString();
    assert.match(promoSvgText, /Discover our latest services/);
    assert.match(promoSvgText, /Scan to get started/);
    await page.locator('#downloadFormat').selectOption('branded-png');
    const logo = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ff0000'; context.fillRect(0, 0, 256, 256);
      return canvas.toDataURL();
    });
    const logoFile = {name:'logo.png', mimeType:'image/png', buffer:Buffer.from(logo.split(',')[1], 'base64')};
    // Re-selecting identical bytes must not leave processing stuck either.
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = Date.now();
      await page.locator('#logoUpload').setInputFiles(logoFile);
      await page.waitForFunction(() => !document.querySelector('.qrg-download-buttons button').disabled, null, {timeout: 5000});
      console.log(`Logo preview ${attempt + 1}: ${Date.now() - started} ms under restrictive CSP.`);
      const center = await page.locator('.qrg-preview-container canvas').evaluate(canvas =>
        Array.from(canvas.getContext('2d').getImageData(150, 150, 1, 1).data));
      assert.deepEqual(center, [255, 0, 0, 255], 'preview must actually contain the logo');
    }
    for (const format of ['PNG', 'SVG']) {
      await page.locator('#downloadFormat').selectOption(format.toLowerCase());
      const pending = page.waitForEvent('download');
      await downloadButton.click();
      const chunks = [];
      for await (const chunk of await (await pending).createReadStream()) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      const center = await page.evaluate(async ({data, type}) => {
        const image = new Image(); image.src = `data:${type};base64,${data}`;
        await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 300;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        return Array.from(context.getImageData(150, 150, 1, 1).data);
      }, {data:bytes.toString('base64'), type:format === 'PNG' ? 'image/png' : 'image/svg+xml'});
      assert.deepEqual(center, [255, 0, 0, 255], `${format} download must retain the logo`);
    }
    await page.clock.install();
    await page.evaluate(() => { window.stallQrRender = true; });
    await page.locator('#logoUpload').setInputFiles(logoFile);
    await page.waitForFunction(() => window.qrRenderStalled);
    await page.clock.fastForward(15_001);
    await page.waitForFunction(() => window.qrErrors.includes('qrGenerator.errorGenerating'));
    assert.equal(await downloadButton.isDisabled(), true, 'a stalled render must not enable downloads');
    await page.evaluate(() => { window.stallQrRender = false; window.qrErrors = []; });
    await page.locator('#logoUpload').setInputFiles(logoFile);
    await page.waitForFunction(() => !document.querySelector('.qrg-download-buttons button').disabled, null, {timeout:5000});
    await page.clock.resume();
    await page.getByRole('button', {name: 'qrGenerator.removeLogo'}).click();
    await page.waitForFunction(() => !document.querySelector('.qrg-download-buttons button').disabled);
    // A real high-quality JPEG larger than the old limit, not just a fake MIME label.
    const largeJpeg = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 2300; canvas.height = 1800;
      const context = canvas.getContext('2d');
      const pixels = context.createImageData(canvas.width, canvas.height);
      let seed = 42;
      for (let i = 0; i < pixels.data.length; i += 4) {
        for (let c = 0; c < 3; c++) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; pixels.data[i+c] = seed >>> 24; }
        pixels.data[i+3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      return canvas.toDataURL('image/jpeg', 1);
    });
    const jpegBytes = Buffer.from(largeJpeg.split(',')[1], 'base64');
    assert.ok(jpegBytes.length > 5 * 1024 * 1024 && jpegBytes.length < 15 * 1024 * 1024);
    const jpegStarted = Date.now();
    await page.locator('#logoUpload').setInputFiles({name:'large-logo.jpg', mimeType:'image/jpeg', buffer:jpegBytes});
    await page.waitForFunction(() => !document.querySelector('.qrg-download-buttons button').disabled, null, {timeout: 5000});
    console.log(`Large JPEG preview: ${Date.now() - jpegStarted} ms.`);
    const normalized = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1600; canvas.height = 800;
      canvas.getContext('2d').fillRect(0, 0, 1600, 800);
      const results = [];
      for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, type));
        const data = await window.prepareQrLogo(blob);
        const img = new Image(); img.src = data; await img.decode();
        results.push({type, width:img.naturalWidth, height:img.naturalHeight, png:data.startsWith('data:image/png;')});
      }
      return results;
    });
    for (const result of normalized) assert.deepEqual(result, {type:result.type, width:512, height:256, png:true});
    const failureChecks = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const results = [];
      // Valid PNG dimensions but missing image data must fail native decoding.
      try { await window.prepareQrLogo(blob.slice(0, 30, 'image/png')); }
      catch (error) { results.push(error.message); }
      const controller = new AbortController();
      const pending = window.prepareQrLogo(blob, controller.signal);
      controller.abort();
      try { await pending; } catch (error) { results.push(error.name); }
      return results;
    });
    assert.deepEqual(failureChecks, ['logoInvalid', 'AbortError']);
    await page.locator('#logoUpload').setInputFiles({name:'forged.png', mimeType:'image/png', buffer:Buffer.from('<svg onload="alert(1)"/>')});
    await page.waitForFunction(() => window.qrErrors.includes('qrGenerator.logoInvalid'));
    await page.locator('#logoUpload').setInputFiles({name:'too-big.png', mimeType:'image/png', buffer:Buffer.alloc(15 * 1024 * 1024 + 1)});
    await page.waitForFunction(() => window.qrErrors.includes('qrGenerator.logoTooLarge'));
    assert.deepEqual(await page.evaluate(() => window.qrErrors.splice(0)), ['qrGenerator.logoInvalid', 'qrGenerator.logoTooLarge']);
    console.log(`Verified ${(jpegBytes.length / 1024 / 1024).toFixed(1)} MiB JPG, PNG/JPG/WebP resizing, forged-file rejection, and 15 MiB boundary.`);
    await page.locator('#url').fill('');
    assert.equal(await downloadButton.isDisabled(), true);
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
    assert.equal((await savedDownloadPromise).suggestedFilename(), 'qr-regression.png');
    assert.deepEqual(await page.evaluate(() => window.qrErrors), []);
    assert.deepEqual(errors, []);
    console.log('Verified real canvas rendering, PNG/SVG exports, logo add/remove, blank-input guards, save payload, and saved download.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
