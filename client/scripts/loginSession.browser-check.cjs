// Real Login + AuthProvider + Axios flow against a synthetic HTTP service.
// No production credentials, accounts, or browser sessions are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');

async function fixture({ refreshable = false, legacyOnly = false, refreshFailure = null } = {}) {
  const user = { id: 'synthetic', first_name: 'Synthetic', last_name: 'Person',
    email_verified: true, didit_status: 'verified', role: 'helper', onboarding_completed: true };
  const calls = [];
  let accessExpired = false;
  let refreshCount = 0;
  let meFailure = null;
  let delayedMe = null;
  const mocks = {
    'react-i18next': `export const useTranslation=()=>({t:key=>key});`,
    './LanguageContext': `const syncLanguageFromServer=()=>{};
      export const useLanguage=()=>({syncLanguageFromServer});`,
    '../components/AuthNavbar': `export default ()=>null;`,
    '../components/Footer': `export default ()=>null;`,
    './PageShell': `export default ({children})=>children;`,
    '@simplewebauthn/browser': `export const startAuthentication=async()=>({id:'synthetic-passkey'});`,
  };
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {BrowserRouter,Routes,Route} from 'react-router-dom';
      import {AuthProvider,useAuth} from './src/context/AuthContext.jsx';
      import Login from './src/pages/Login.jsx';
      import ProtectedRoute from './src/components/ProtectedRoute.jsx';
      import SessionRecoveryBoundary from './src/components/SessionRecoveryBoundary.jsx';
      function Controls(){const auth=useAuth();window.fixtureAuth=auth;return null;}
      function Dashboard(){const {user}=useAuth();return <main><h1>Helper dashboard</h1>
        <p data-user>{user?.id||'Not authenticated'}</p></main>;}
      createRoot(document.getElementById('root')).render(<BrowserRouter><AuthProvider>
        <Controls/><SessionRecoveryBoundary><Routes><Route path="/login" element={<Login/>}/>
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard/></ProtectedRoute>}/></Routes></SessionRecoveryBoundary>
      </AuthProvider></BrowserRouter>);
    ` },
    bundle: true, write: false, jsx: 'automatic', define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
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
      const failure = meFailure;
      if (delayedMe) await delayedMe;
      if (failure) { res.statusCode = failure;res.end('{"error":"Synthetic unavailable"}');return; }
      if (accessExpired || !req.headers.cookie?.includes('fixture_access=valid')) {
        res.statusCode = 401;res.end('{"error":"No token provided"}');return;
      }
      res.end(JSON.stringify({ user }));return;
    }
    if (url.pathname === '/api/auth/refresh') {
      if (!refreshable) {
        res.statusCode = 401;res.end('{"error":"No refresh session","code":"no_token"}');return;
      }
      if (refreshFailure) {
        res.statusCode = refreshFailure.status;
        res.end(JSON.stringify({error:'Synthetic refresh rejection',code:refreshFailure.code}));return;
      }
      if (body.refreshToken) {
        if (!legacyOnly || body.refreshToken !== 'synthetic-legacy-valid') {
          res.statusCode = 401;res.end('{"error":"Session reuse detected","code":"token_reuse"}');return;
        }
        legacyOnly = false;
      } else if (!req.headers.cookie?.includes('fixture_rt=valid')) {
        res.statusCode = 401;res.end('{"error":"Refresh token is required","code":"no_token"}');return;
      }
      refreshCount += 1;accessExpired = false;
      res.setHeader('Set-Cookie', ['fixture_access=valid; HttpOnly; SameSite=Lax; Path=/',
        'fixture_rt=valid; HttpOnly; SameSite=Lax; Path=/']);
      res.end(JSON.stringify({ user, accessToken:'synthetic-access',refreshToken:`synthetic-rotated-${refreshCount}` }));return;
    }
    if (url.pathname === '/api/auth/login' && (!body.email || !body.password)) {
      res.statusCode = 400;res.end('{"error":"Missing credentials"}');return;
    }
    if (url.pathname === '/api/passkeys/authentication/options') {
      res.end('{"options":{},"token":"synthetic-challenge"}');return;
    }
    if (url.pathname === '/api/auth/login' || url.pathname === '/api/passkeys/authentication/verify') {
      res.setHeader('Set-Cookie', ['fixture_access=valid; HttpOnly; SameSite=Lax; Path=/',
        'fixture_rt=valid; HttpOnly; SameSite=Lax; Path=/']);
      res.end(JSON.stringify({ user, accessToken: 'synthetic-response-token',refreshToken:'synthetic-refresh-token' }));return;
    }
    res.statusCode = 404;res.end('{"error":"Unexpected fixture request"}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  return { browser, calls, url: `http://127.0.0.1:${server.address().port}`,
    expireAccess() { accessExpired = true; },
    setMeFailure(status) { meFailure = status; },
    setRefreshFailure(failure) { refreshFailure = failure; },
    delayMe() { let release;delayedMe = new Promise(resolve => { release = resolve; });return () => { delayedMe = null;release(); }; },
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
    await page.evaluate(()=>localStorage.setItem('refreshToken','synthetic-legacy-revoked'));
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/dashboard');
    assert.equal(await page.locator('[data-user]').innerText(), 'synthetic');
    assert.equal(env.calls.filter(call => call.path === '/api/auth/login').length, 1);
    assert.equal(env.calls.find(call => call.path === '/api/auth/login').body.email, 'synthetic@example.invalid');
    assert.equal(await page.evaluate(()=>localStorage.getItem('refreshToken')),null);
    assert.deepEqual(errors, []);
    // A reload still recognizes the cookie-established session.
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-user]')?.textContent === 'synthetic');
  } finally { await env.close(); }
});

test('unavailable startup keeps the destination unverified until a visible retry succeeds', async () => {
  const env = await fixture({ refreshable:true });
  try {
    const page = await env.browser.newPage();
    await seedCookieSession(page, env.url);
    env.setMeFailure(503);
    await page.goto(`${env.url}/dashboard`);
    await page.getByRole('heading',{name:'sessionRecovery.title'}).waitFor();
    assert.ok(page.url().endsWith('/dashboard'));
    assert.equal(await page.locator('[data-user]').count(), 0);
    assert.equal(await page.locator('#email').count(), 0);
    env.setMeFailure(null);
    await page.getByRole('button',{name:'sessionRecovery.retry'}).click();
    await page.getByRole('heading',{name:'Helper dashboard'}).waitFor();
    assert.equal(await page.locator('[data-user]').innerText(), 'synthetic');
  } finally { await env.close(); }
});

test('transient explicit refresh preserves the verified user; real expiry still clears it', async () => {
  const env = await fixture({refreshable:true});
  try {
    const page = await env.browser.newPage();
    await seedCookieSession(page, env.url);
    await page.goto(`${env.url}/dashboard`);
    await page.locator('[data-user]').waitFor();
    for (const status of [408,429,503]) {
      env.setRefreshFailure({status,code:'temporary'});
      await page.evaluate(()=>window.fixtureAuth.refreshSession().catch(()=>{}));
      assert.equal(await page.locator('[data-user]').innerText(),'synthetic');
    }
    env.setRefreshFailure({status:401,code:'revoked'});
    await page.evaluate(()=>window.fixtureAuth.refreshSession().catch(()=>{}));
    await page.waitForURL('**/login');
    assert.equal(await page.locator('[data-user]').count(),0);
  } finally { await env.close(); }
});

test('an older verification failure cannot clear a newer verified account', async () => {
  const env = await fixture({refreshable:true});
  try {
    const page = await env.browser.newPage();
    await seedCookieSession(page, env.url);
    await page.goto(`${env.url}/dashboard`);
    await page.locator('[data-user]').waitFor();
    env.setMeFailure(403);
    const release = env.delayMe();
    const before = env.calls.length;
    await page.evaluate(()=>{window.pendingVerification=window.fixtureAuth.refreshUser().catch(()=>{});});
    await page.waitForTimeout(100);
    assert.ok(env.calls.slice(before).some(call=>call.path==='/api/auth/me'));
    await page.evaluate(()=>window.fixtureAuth.setUser({id:'new-account',role:'helper',email_verified:true,didit_status:'verified'}));
    release();
    await page.evaluate(()=>window.pendingVerification);
    assert.equal(await page.locator('[data-user]').innerText(),'new-account');
  } finally { await env.close(); }
});

async function seedLegacyStorage(page, token) {
  await page.addInitScript(value => {
    if (!localStorage.getItem('fixture-seeded')) {
      localStorage.setItem('refreshToken', value);
      localStorage.setItem('accessToken', 'synthetic-legacy-access');
      localStorage.setItem('fixture-seeded', '1');
    }
  }, token);
}

async function seedCookieSession(page, url) {
  await page.context().addCookies(['fixture_access', 'fixture_rt'].map(name => ({
    name,value:'valid',url,httpOnly:true,sameSite:'Lax',
  })));
}

test('expired access uses the fresh cookie instead of stale legacy storage across repeated reloads', async () => {
  const env = await fixture({ refreshable:true });
  try {
    const page = await env.browser.newPage();
    await seedCookieSession(page, env.url);
    await seedLegacyStorage(page, 'synthetic-legacy-revoked');
    env.expireAccess();
    await page.goto(`${env.url}/dashboard`);
    await page.getByRole('heading',{name:'Helper dashboard'}).waitFor();
    assert.equal(await page.locator('[data-user]').innerText(),'synthetic');
    env.expireAccess();await page.reload();
    await page.getByRole('heading',{name:'Helper dashboard'}).waitFor();
    const refreshes = env.calls.filter(call=>call.path==='/api/auth/refresh');
    assert.equal(refreshes.length,2);
    assert.ok(refreshes.every(call=>!call.body.refreshToken));
    assert.equal(await page.evaluate(()=>localStorage.getItem('refreshToken')),null);
    assert.equal(await page.evaluate(()=>localStorage.getItem('accessToken')),null);
  } finally { await env.close(); }
});

test('legacy-only sessions migrate once, then use the cookie on the next access expiry', async () => {
  const env = await fixture({ refreshable:true,legacyOnly:true });
  try {
    const page = await env.browser.newPage();
    await seedLegacyStorage(page,'synthetic-legacy-valid');
    await page.goto(`${env.url}/dashboard`);
    await page.getByRole('heading',{name:'Helper dashboard'}).waitFor();
    env.expireAccess();await page.reload();
    await page.getByRole('heading',{name:'Helper dashboard'}).waitFor();
    const refreshes = env.calls.filter(call=>call.path==='/api/auth/refresh');
    assert.deepEqual(refreshes.map(call=>call.body),[{}, {refreshToken:'synthetic-legacy-valid'}, {}]);
  } finally { await env.close(); }
});

test('reuse detection does not fall back to a legacy token or bypass protected routes', async () => {
  const env = await fixture({ refreshable:true,refreshFailure:{status:401,code:'token_reuse'} });
  try {
    const page = await env.browser.newPage();
    await seedLegacyStorage(page,'synthetic-legacy-valid');
    await page.goto(`${env.url}/dashboard`);
    await page.waitForURL('**/login');
    assert.deepEqual(env.calls.filter(call=>call.path==='/api/auth/refresh').map(call=>call.body),[{}]);
    assert.equal(await page.evaluate(()=>localStorage.getItem('refreshToken')),null);
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
    await page.evaluate(()=>localStorage.setItem('refreshToken','synthetic-legacy-revoked'));
    // P1-113: passkey sign-in needs the same agreement + signature as password sign-in.
    await page.getByRole('button', { name: 'login.signInWithPasskey' }).click();
    assert.equal(env.calls.filter(call => call.path.startsWith('/api/passkeys/authentication')).length, 0);
    await page.locator('#terms-agree').check();
    await page.locator('#signature-name').fill('Synthetic Person');
    await page.getByRole('button', { name: 'login.signInWithPasskey' }).click();
    await page.waitForURL('**/dashboard');
    assert.equal(await page.locator('[data-user]').innerText(), 'synthetic');
    assert.equal(env.calls.filter(call => call.path === '/api/auth/login').length, 0);
    assert.equal(env.calls.filter(call => call.path === '/api/passkeys/authentication/verify').length, 1);
    assert.equal(await page.evaluate(()=>localStorage.getItem('refreshToken')),null);
    assert.deepEqual(errors, []);
  } finally { await env.close(); }
});
