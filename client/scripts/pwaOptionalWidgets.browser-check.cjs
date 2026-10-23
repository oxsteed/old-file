const test = require('node:test'),
  assert = require('node:assert/strict'),
  http = require('node:http'),
  path = require('node:path');
const { build } = require('esbuild'),
  { chromium } = require('playwright-core');
test(
  'optional widget chunk failures never reload or erase an active form',
  { timeout: 30000 },
  async () => {
    const root = path.resolve(__dirname, '..'),
      bundle = await build({
        stdin: {
          resolveDir: root,
          loader: 'jsx',
          contents: `import React from 'react';import{createRoot}from'react-dom/client';import{DeferredSupportWidget,DeferredCommandPalette}from './src/components/DeferredShellWidgets';createRoot(document.getElementById('root')).render(<><input aria-label='Current job'/><DeferredSupportWidget/><DeferredCommandPalette/></>);`,
        },
        bundle: true,
        write: false,
        format: 'esm',
        jsx: 'automatic',
        plugins: [
          {
            name: 'unavailable-chunks',
            setup(plugin) {
              plugin.onResolve({ filter: /^react-i18next$/ }, () => ({
                path: 'translation',
                namespace: 'fixture',
              }));
              plugin.onResolve(
                { filter: /^\.\/(SupportWidget|CommandPalette)$/ },
                (args) => ({ path: args.path, namespace: 'fixture' }),
              );
              plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
                contents:
                  args.path === 'translation'
                    ? `export const useTranslation=()=>({t:key=>key});`
                    : `(globalThis.failedWidgets ||= []).push(${JSON.stringify(args.path)});throw new Error('Failed to fetch dynamically imported module');export default()=>null;`,
                loader: 'jsx',
              }));
            },
          },
        ],
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
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
      }),
      page = await browser.newPage(),
      errors = [];
    page.setDefaultTimeout(6000);
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page
        .getByRole('textbox', { name: 'Current job' })
        .fill('Do not discard my job');
      await page.waitForFunction(
        () => globalThis.failedWidgets?.includes('./SupportWidget'),
        null,
        { timeout: 10000 },
      );
      assert.equal(
        await page.getByRole('textbox', { name: 'Current job' }).inputValue(),
        'Do not discard my job',
      );
      await page.keyboard.press('Control+k');
      await page.getByRole('alert').waitFor();
      assert.equal(
        await page.getByRole('textbox', { name: 'Current job' }).inputValue(),
        'Do not discard my job',
      );
      assert.ok(!page.url().includes('chunk-retry'));
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
