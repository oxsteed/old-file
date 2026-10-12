// Real Login + AuthProvider + Axios flow against a synthetic HTTP service.
// No production credentials, accounts, or browser sessions are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');

async function fixture() {
  const user = { id: 'synthetic', first_name: 'Synthetic', last_name: 'Person',
    email_verified: true, didit_status: 'verified', role: 'helper', onboarding_completed: true };
  const calls = [];
  const mocks = {
    'react-i18next': `export const useTranslation=()=>({t:key=>key});`,
    './LanguageContext': `const syncLanguageFromServer=()=>{};
      export const useLanguage=()=>({syncLanguageFromServer});`,
    '../components/AuthNavbar': `export default ()=>null;`,
    '../components/Footer': `export default ()=>null;`,
    '@simplewebauthn/browser': `export const startAuthentication=async()=>({id:'synthetic-passkey'});`,
  };
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {BrowserRouter,Routes,Route} from 'react-router-dom';
      import {AuthProvider,useAuth} from './src/context/AuthContext.jsx';
      import Login from './src/pages/Login.jsx';
      function Dashboard(){const {user}=useAuth();return <main><h1>Helper dashboard</h1>
        <p data-user>{user?.id||'Not authenticated'}</p></main>;}
      createRoot(document.getElementById('root')).render(<BrowserRouter><AuthProvider>
        <Routes><Route path="/login" element={<Login/>}/>
        <Route path="/dashboard" element={<Dashboard/>}/></Routes>
      </AuthProvider></BrowserRouter>);
    ` },
    bundle: true, write: false, jsx: 'automatic', define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'synthetic-login-services', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => mocks[args.path]
        ? { path: args.path, namespace: 'fixture' } : undefined);
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }));
    } }],
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/app.js') {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');res.end(bundle.outputFiles[0].contents);return;
    }
    if (!url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');return;
    }
    let raw = '';for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ path: url.pathname, method: req.method, body });
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/api/auth/me') {
      if (!req.headers.cookie?.includes('fixture_access=valid')) {
        res.statusCode = 401;res.end('{"error":"No token provided"}');return;
      }
      res.end(JSON.stringify({ user }));return;
    }
    if (url.pathname === '/api/auth/refresh') {
      res.statusCode = 401;res.end('{"error":"No refresh session"}');return;
    }
    if (url.pathname === '/api/auth/login' && (!body.email || !body.password)) {
      res.statusCode = 400;res.end('{"error":"Missing credentials"}');return;
    }
    if (url.pathname === '/api/passkeys/authentication/options') {
      res.end('{"options":{},"token":"synthetic-challenge"}');return;
    }
    if (url.pathname === '/api/auth/login' || url.pathname === '/api/passkeys/authentication/verify') {
      res.setHeader('Set-Cookie', 'fixture_access=valid; HttpOnly; SameSite=Lax; Path=/');
      res.end(JSON.stringify({ user, accessToken: 'synthetic-response-token' }));return;
    }
    res.statusCode = 404;res.end('{"error":"Unexpected fixture request"}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  return { browser, calls, url: `http://127.0.0.1:${server.address().port}`,
    async close() { await browser.close();await new Promise(resolve => server.close(resolve)); } };
}

test('password login reaches the authenticated dashboard with exactly one credential request', async () => {
  const env = await fixture();
  try {
    const page = await env.browser.newPage();
    const errors = [];page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${env.url}/login`);
    await page.locator('#email').waitFor({ timeout: 5000 }).catch(() => {
      throw new Error(`Login fixture failed to render: ${JSON.stringify(errors)}`);
    });
    await page.locator('#email').fill('synthetic@example.invalid');
    await page.locator('#password').fill('Synthetic-password1');
    await page.locator('#terms-agree').check();
    await page.locator('#signature-name').fill('Synthetic Person');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/dashboard');
    assert.equal(await page.locator('[data-user]').innerText(), 'synthetic');
    assert.equal(env.calls.filter(call => call.path === '/api/auth/login').length, 1);
    assert.equal(env.calls.find(call => call.path === '/api/auth/login').body.email, 'synthetic@example.invalid');
    assert.deepEqual(errors, []);
    // A reload still recognizes the cookie-established session.
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-user]')?.textContent === 'synthetic');
  } finally { await env.close(); }
});

test('passkey login hydrates shared authentication without posting its response to password login', async () => {
  const env = await fixture();
  try {
    const page = await env.browser.newPage();
    const errors = [];page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${env.url}/login`);
    await page.locator('#email').waitFor({ timeout: 5000 }).catch(() => {
      throw new Error(`Login fixture failed to render: ${JSON.stringify(errors)}`);
    });
    await page.locator('#email').fill('synthetic@example.invalid');
    await page.getByRole('button', { name: 'login.signInWithPasskey' }).click();
    await page.waitForURL('**/dashboard');
    assert.equal(await page.locator('[data-user]').innerText(), 'synthetic');
    assert.equal(env.calls.filter(call => call.path === '/api/auth/login').length, 0);
    assert.equal(env.calls.filter(call => call.path === '/api/passkeys/authentication/verify').length, 1);
    assert.deepEqual(errors, []);
  } finally { await env.close(); }
});
