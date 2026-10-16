/**
 * harness.cjs - SOP screenshot harness library.
 *
 * Builds the real-App fixture bundle (mocked api/axios, i18n, stripe),
 * serves it over local HTTP (including esbuild code-split chunks), and
 * drives Playwright captures with the headless shell.
 *
 * Writes nothing itself; the capture driver decides outputs.
 */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..', '..');
const SHELL = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';

const STRIPE_MOCK = `export function loadStripe(){ return Promise.resolve(null); }`;

const I18N_MOCK = `
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
export const LANGUAGES = [{ code: 'en', name: 'English', native: 'English' }];
export const detectInitialLanguage = () => 'en';
export const ensureLanguageLoaded = async () => {};
export const ensureLegalContentLoaded = async () => {};
export const initializeEnglishFallback = async () => {};
export const i18nReady = Promise.resolve();
const catalog = window.__sopCatalog || {};
const namespaces = { translation: catalog };
for (const key of Object.keys(catalog)) {
  if (catalog[key] && typeof catalog[key] === 'object') namespaces[key] = catalog[key];
}
i18next.use(initReactI18next).init({
  initImmediate: false, lng: 'en', fallbackLng: 'en',
  ns: Object.keys(namespaces), defaultNS: 'translation',
  resources: { en: namespaces }, interpolation: { escapeValue: false },
});
export default i18next;
`;

const ENTRY = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './src/App';
createRoot(document.getElementById('root')).render(<App />);
window.__sopAppMounted = true;
`;

// Chrome that is not part of any guide screen: cookie banner, support widget,
// PWA install prompt, push soft-ask, toasters, command palette.
const HIDE_CHROME_CSS = `
.cookie-consent-banner{display:none!important;}
.cookie-consent-settings{display:none!important;}
.support-contact-fab{display:none!important;}
button.fixed.bottom-20.z-40{display:none!important;}
`;

function readCatalog() {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/locales/en.json'), 'utf8'));
  // Merge namespaced catalogs (credit, attention, statements, ...) so
  // useTranslation('<ns>') resolves in the fixture.
  try {
    const nsDir = path.join(ROOT, 'src/i18n/locales/en');
    for (const f of fs.readdirSync(nsDir)) {
      if (!f.endsWith('.json')) continue;
      const ns = f.slice(0, -5);
      try { catalog[ns] = JSON.parse(fs.readFileSync(path.join(nsDir, f), 'utf8')); }
      catch {}
    }
  } catch {}
  return catalog;
}

async function buildFixture(apiMockSource) {
  const bundle = await build({
    stdin: { resolveDir: ROOT, loader: 'jsx', contents: ENTRY },
    bundle: true, write: false, outdir: 'fixture', format: 'esm', splitting: true,
    jsx: 'automatic',
    loader: { '.css': 'css', '.woff2': 'dataurl', '.woff': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' },
    define: { 'import.meta.env': '{}' },
    plugins: [{
      name: 'sop-fixtures',
      setup(plugin) {
        plugin.onResolve({ filter: /(^|\/)axios$/, }, () => ({ path: 'api', namespace: 'fixture' }));
        plugin.onResolve({ filter: /(?:^|\/)i18n$/ }, () => ({ path: 'i18n', namespace: 'fixture' }));
        plugin.onResolve({ filter: /^@stripe\/stripe-js(?:\/pure)?$/ }, () => ({ path: 'stripe', namespace: 'fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: { api: apiMockSource, i18n: I18N_MOCK, stripe: STRIPE_MOCK }[args.path],
          loader: 'js', resolveDir: ROOT,
        }));
      },
    }],
  });
  const files = bundle.outputFiles;
  const entryJs = files.find((f) => f.path.endsWith('/stdin.js'));
  // Code-split chunks each emit their own CSS file; esbuild does not load
  // them at runtime, so concatenate everything into one stylesheet served as
  // /app.css (Vite does the equivalent at build time).
  const cssFiles = files.filter((f) => f.path.endsWith('.css'));
  const cssBundle = Buffer.concat(cssFiles.map((f) => Buffer.concat([f.contents, Buffer.from('\n')])));
  const byBase = new Map(files.map((f) => [path.basename(f.path), f]));
  return { files, entryJs, cssFiles, cssBundle, byBase };
}

function createServer({ entryJs, cssBundle, byBase, catalog, tailwindCssPath }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const base = path.basename(url.pathname);
    if (url.pathname === '/app.js') {
      res.setHeader('Content-Type', 'text/javascript'); res.end(entryJs.contents); return;
    }
    if (url.pathname === '/app.css') {
      res.setHeader('Content-Type', 'text/css'); res.end(cssBundle); return;
    }
    if (url.pathname === '/tailwind.css') {
      res.setHeader('Content-Type', 'text/css'); res.end(fs.readFileSync(tailwindCssPath)); return;
    }
    if (url.pathname.startsWith('/socket.io/')) {
      // No realtime server in the fixture; fail socket.io fast and quietly.
      res.statusCode = 204; res.end(); return;
    }
    if (base.endsWith('.js') && byBase.has(base)) {
      res.setHeader('Content-Type', 'text/javascript'); res.end(byBase.get(base).contents); return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/tailwind.css"><link rel="stylesheet" href="/app.css"><style>${HIDE_CHROME_CSS}</style></head>
<body><div id="root"></div>
<script>window.__sopCatalog=${JSON.stringify(catalog).replace(/</g, '\\u003c')};</script>
<script type="module" src="/app.js"></script></body></html>`);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      port: server.address().port,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

async function launchBrowser() {
  return chromium.launch({ headless: true, executablePath: SHELL });
}

/**
 * New page with fixture init: light theme, synthetic user, data mode,
 * service-worker stub (avoids the 8s useWebPush hang), fetch guard.
 */
async function newFixturePage(browser, { viewport, user = null, dataMode = 'full', flags = {} }) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(12000);
  await page.addInitScript(({ u, dm, fl }) => {
    try { localStorage.setItem('theme', 'light'); } catch (e) {}
    window.__sopUser = u;
    window.__sopDataMode = dm;
    window.__sopFlags = fl || {};
    window.__sopApiLog = [];
    // Stub serviceWorker.ready so push-capability checks resolve instantly.
    try {
      if (navigator.serviceWorker) {
        const fakeReg = { pushManager: { getSubscription: async () => null } };
        Object.defineProperty(navigator.serviceWorker, 'ready', {
          get: () => Promise.resolve(fakeReg), configurable: true,
        });
      }
    } catch (e) {}
  }, { u: user, dm: dataMode, fl: flags });
  return page;
}

/** Wait until the app mounted and API traffic has been quiet for a while. */
async function settle(page, { maxWaitMs = 12000, quietWindows = 3, pollMs = 400 } = {}) {
  try {
    await page.waitForFunction(() => window.__sopAppMounted === true, null, { timeout: 20000 });
  } catch (e) {
    return { mounted: false };
  }
  let lastCount = -1, quiet = 0;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline && quiet < quietWindows) {
    await page.waitForTimeout(pollMs);
    const n = await page.evaluate(() => (window.__sopApiLog || []).length).catch(() => -1);
    if (n === lastCount && n >= 0) quiet++; else { quiet = 0; lastCount = n; }
  }
  // extra beat for react-query/cache-driven re-renders
  await page.waitForTimeout(600);
  return { mounted: true };
}

async function apiLog(page) {
  return page.evaluate(() => [...new Set(window.__sopApiLog || [])]).catch(() => []);
}

async function pageErrors(page) {
  return page.evaluate(() => window.__sopPageErrors || []).catch(() => []);
}

function attachErrorCollector(page) {
  page.on('pageerror', (e) => {
    page.evaluate((msg) => {
      window.__sopPageErrors = window.__sopPageErrors || [];
      window.__sopPageErrors.push(String(msg));
    }, String((e && e.message) || e)).catch(() => {});
  });
}

/** Run recipe actions. Each action is a small object; see capture driver. */
async function applyActions(page, actions = []) {
  for (const a of actions) {
    if (a.clickText) {
      const scope = a.within ? page.locator(a.within) : page;
      await scope.getByText(a.clickText, { exact: !!a.exact }).first().click({ timeout: 8000 });
    } else if (a.click) {
      await page.locator(a.click).first().click({ timeout: 8000 });
    } else if (a.fill) {
      await page.locator(a.fill[0]).first().fill(a.fill[1], { timeout: 8000 });
    } else if (a.fillAll) {
      // fill every visible empty text input with a synthetic value
      await page.evaluate((val) => {
        const inputs = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea')];
        for (const el of inputs) {
          if (el.offsetParent === null) continue;
          if (el.value) continue;
          const t = (el.type || 'text').toLowerCase();
          if (['text', 'search', ''].includes(t) || el.tagName === 'TEXTAREA') {
            el.focus();
            document.execCommand('selectAll', false, null);
          }
        }
      }, a.fillAll);
      // use keyboard typing per input instead (more reliable with React)
      const count = await page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea')]
        .filter((el) => el.offsetParent !== null && !el.value && ['text', 'search', '', undefined].includes((el.type || '').toLowerCase()) || (el.tagName === 'TEXTAREA' && el.offsetParent !== null && !el.value)).length);
      void count;
    } else if (a.type) {
      const [sel, text] = a.type;
      await page.locator(sel).first().click({ timeout: 8000 });
      await page.keyboard.type(text, { delay: 10 });
    } else if (a.check) {
      await page.locator(a.check).first().check({ timeout: 8000 });
    } else if (a.uncheck) {
      await page.locator(a.uncheck).first().uncheck({ timeout: 8000 });
    } else if (a.select) {
      await page.locator(a.select[0]).first().selectOption(a.select[1], { timeout: 8000 });
    } else if (a.waitForText) {
      await page.getByText(a.waitForText, { exact: !!a.exact }).first().waitFor({ timeout: 10000 });
    } else if (a.waitFor) {
      await page.locator(a.waitFor).first().waitFor({ timeout: 10000 });
    } else if (a.press) {
      await page.keyboard.press(a.press);
    } else if (a.scroll) {
      await page.locator(a.scroll).first().scrollIntoViewIfNeeded({ timeout: 8000 });
    } else if (a.settle) {
      await page.waitForTimeout(a.settle);
    } else if (a.reload) {
      await page.reload({ waitUntil: 'domcontentloaded' });
    } else if (a.eval) {
      await page.evaluate(new Function(a.eval)); // eslint-disable-line no-new-func
    } else {
      throw new Error(`unknown recipe action: ${JSON.stringify(a)}`);
    }
    await page.waitForTimeout(250);
  }
}

/**
 * Measure annotation targets. Returns [{ n, x, y, label, found }].
 * x/y are percentages of the viewport. Scrolls so the annotation span fits.
 */
async function measureAnnotations(page, annotations, viewport) {
  if (!annotations || !annotations.length) return [];
  const boxes = await page.evaluate((locators) => {
    window.scrollTo(0, 0);
    return locators.map((loc) => {
      try {
        const el = document.querySelector(loc);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      } catch (e) { return null; }
    });
  }, annotations.map((a) => a.locator));
  await page.waitForTimeout(300);

  const centers = boxes.map((b) => (b ? { cx: b.x + b.w / 2, cy: b.y + b.h / 2 } : null));
  const valid = centers.filter(Boolean);
  if (valid.length) {
    const minY = Math.min(...valid.map((c) => c.cy));
    const maxY = Math.max(...valid.map((c) => c.cy));
    const vh = viewport.height;
    let scrollY = 0;
    if (minY < 0 || maxY > vh) {
      // fit the span; bias the first annotation toward the upper third
      scrollY = Math.max(0, minY - vh * 0.3);
      // if the span is taller than the viewport, anchor on the first annotation
      if (maxY - minY > vh * 0.9) scrollY = Math.max(0, valid[0].cy - vh * 0.3);
      await page.evaluate((y) => window.scrollTo(0, y), Math.round(scrollY));
      await page.waitForTimeout(400);
    }
  }

  const final = await page.evaluate((locators) => locators.map((loc) => {
    try {
      const el = document.querySelector(loc);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    } catch (e) { return null; }
  }), annotations.map((a) => a.locator));

  return annotations.map((a, i) => {
    const c = final[i];
    if (!c) return { n: a.n, label: a.label, found: false };
    return {
      n: a.n, label: a.label, found: true,
      x: Math.round((c.cx / viewport.width) * 1000) / 10,
      y: Math.round((c.cy / viewport.height) * 1000) / 10,
    };
  });
}

async function screenshotJpeg(page, outPath) {
  await page.screenshot({ path: outPath, type: 'jpeg', quality: 70 });
}

module.exports = {
  ROOT, SHELL, readCatalog, buildFixture, createServer, launchBrowser,
  newFixturePage, settle, apiLog, attachErrorCollector, pageErrors,
  applyActions, measureAnnotations, screenshotJpeg,
};
