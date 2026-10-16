/**
 * spike.cjs - SOP screenshot spike: prove the full-App fixture bundle renders
 * real pages with mocked API/i18n, then capture 3 screens x 2 viewports.
 *
 * Usage: node client/scripts/sop/spike.cjs
 * Output: /tmp/sop-spike/*.jpg + API log dump.
 *
 * Workaround note: uses the Playwright headless shell via executablePath
 * (Google Chrome is not installed here). Never commit a channel:'chrome'
 * reference; this file lives in scripts/sop/ tooling only.
 */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..', '..');
const SHELL = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const OUT = '/tmp/sop-spike';

const API_MOCK = `
window.__sopApiLog = [];
function __sopLog(method, url) {
  try { window.__sopApiLog.push(method + ' ' + String(url).split('?')[0]); } catch (e) {}
}
function __sopRespond(method, url, data) {
  const raw = String(url || '');
  const p = raw.split('?')[0];
  __sopLog(method, raw);
  if (p === '/auth/me' || p === 'auth/me') {
    const user = window.__sopUser || null;
    if (!user) { const e = new Error('Unauthorized'); e.response = { status: 401 }; throw e; }
    return { data: { user } };
  }
  if (p === '/consent/status') return { data: { outstanding: [] } };
  if (method === 'post' && p === '/consent/accept') return { data: { ok: true } };
  if (p === '/launch-visibility') return { data: {} };
  return { data: method === 'get' ? [] : {} };
}
const __later = (fn) => Promise.resolve().then(fn);
const api = {
  get: (url, config) => __later(() => __sopRespond('get', url)),
  post: (url, data, config) => __later(() => __sopRespond('post', url, data)),
  put: (url, data, config) => __later(() => __sopRespond('put', url, data)),
  patch: (url, data, config) => __later(() => __sopRespond('patch', url, data)),
  delete: (url, config) => __later(() => __sopRespond('delete', url)),
  request: (config) => __later(() => __sopRespond((config && config.method) || 'get', config && config.url)),
  interceptors: { request: { use() {} }, response: { use() {} } },
  defaults: { headers: { common: {} } },
};
export default api;
`;

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

const STRIPE_MOCK = `export function loadStripe(){ return Promise.resolve(null); }`;

const ENTRY = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './src/App';
createRoot(document.getElementById('root')).render(<App />);
window.__sopAppMounted = true;
`;

const HIDE_CHROME_CSS = `
.cookie-consent-banner{display:none!important;}
`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/locales/en.json'), 'utf8'));

  console.log('Building fixture bundle...');
  const bundle = await build({
    stdin: { resolveDir: ROOT, loader: 'jsx', contents: ENTRY },
    bundle: true, write: false, outdir: 'fixture', format: 'esm', splitting: true,
    jsx: 'automatic',
    loader: { '.css': 'css', '.woff2': 'dataurl', '.woff': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' },
    define: { 'import.meta.env': '{}' },
    plugins: [{
      name: 'sop-fixtures',
      setup(plugin) {
        plugin.onResolve({ filter: /api\/axios$/ }, () => ({ path: 'api', namespace: 'fixture' }));
        plugin.onResolve({ filter: /(?:^|\/)i18n$/ }, () => ({ path: 'i18n', namespace: 'fixture' }));
        plugin.onResolve({ filter: /^@stripe\/stripe-js(?:\/pure)?$/ }, () => ({ path: 'stripe', namespace: 'fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: { api: API_MOCK, i18n: I18N_MOCK, stripe: STRIPE_MOCK }[args.path],
          loader: 'js', resolveDir: ROOT,
        }));
      },
    }],
  });
  const files = bundle.outputFiles;
  const entryJs = files.find((f) => f.path.endsWith('/stdin.js'));
  const cssFile = files.find((f) => f.path.endsWith('.css'));
  const byBase = new Map(files.map((f) => [path.basename(f.path), f]));
  console.log(`Bundle OK: ${files.length} files, entry ${(entryJs.contents.length / 1024).toFixed(0)}KB`);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const base = path.basename(url.pathname);
    if (url.pathname === '/app.js') {
      res.setHeader('Content-Type', 'text/javascript'); res.end(entryJs.contents); return;
    }
    if (url.pathname === '/app.css') {
      res.setHeader('Content-Type', 'text/css'); res.end(cssFile ? cssFile.contents : ''); return;
    }
    if (url.pathname === '/tailwind.css') {
      res.setHeader('Content-Type', 'text/css'); res.end(fs.readFileSync('/tmp/sop-tailwind.css')); return;
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
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  console.log('Serving on', port);

  const user = {
    id: 'sop-user-1', email: 'sop.customer@example.com', first_name: 'Sop', last_name: 'Customer',
    role: 'customer', email_verified: true, didit_status: 'verified', onboarding_step: 'active',
  };

  const browser = await chromium.launch({ headless: true, executablePath: SHELL });
  const shots = [
    { url: '/login', viewport: { width: 1360, height: 900 }, user: null, name: 'login-desktop' },
    { url: '/login', viewport: { width: 390, height: 844 }, user: null, name: 'login-mobile' },
    { url: '/dashboard', viewport: { width: 1360, height: 900 }, user, name: 'dashboard-desktop' },
    { url: '/dashboard', viewport: { width: 390, height: 844 }, user, name: 'dashboard-mobile' },
    { url: '/jobs', viewport: { width: 1360, height: 900 }, user, name: 'jobs-desktop' },
    { url: '/jobs', viewport: { width: 390, height: 844 }, user, name: 'jobs-mobile' },
  ];

  for (const shot of shots) {
    const page = await browser.newPage({ viewport: shot.viewport });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
    await page.addInitScript((u) => {
      try { localStorage.setItem('theme', 'light'); } catch (e) {}
      window.__sopUser = u;
    }, shot.user);
    await page.goto(`http://127.0.0.1:${port}${shot.url}`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(() => window.__sopAppMounted === true, null, { timeout: 15000 });
    } catch (e) { console.log(shot.name, 'MOUNT TIMEOUT'); }
    // settle: wait until API calls stop arriving
    let lastCount = -1, quiet = 0;
    for (let i = 0; i < 40 && quiet < 3; i++) {
      await page.waitForTimeout(400);
      const n = await page.evaluate(() => (window.__sopApiLog || []).length).catch(() => -1);
      if (n === lastCount) quiet++; else { quiet = 0; lastCount = n; }
    }
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const title = await page.title().catch(() => '');
    const apiLog = await page.evaluate(() => [...new Set(window.__sopApiLog || [])]).catch(() => []);
    await page.screenshot({ path: path.join(OUT, `${shot.name}.jpg`), type: 'jpeg', quality: 70 });
    console.log(`--- ${shot.name}: theme=${theme} title="${title}" apiCalls=${apiLog.length} pageerrors=${errors.length}`);
    if (errors.length) console.log('  errors:', errors.slice(0, 3).join(' | '));
    console.log('  api:', apiLog.slice(0, 12).join(', '));
    await page.close();
  }

  await browser.close();
  server.close();
  console.log('Spike done. Images in', OUT);
}

main().catch((e) => { console.error('SPIKE FAILED:', e); process.exit(1); });
