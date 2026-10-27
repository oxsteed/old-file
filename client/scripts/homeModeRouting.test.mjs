import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalizeLaunchDashboardMode } from '../src/utils/launchScope.js';
import { dashboardKeyForMode } from '../src/utils/modeAccess.js';
import { navbarMode } from '../src/utils/navbarNavigation.js';

const require = createRequire(import.meta.url);
function component(file, imports) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const code = transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports,
    require: name => name in imports ? imports[name] : require(name) });
  return module.exports.default;
}

test('home selects the active mode without rendering the wrong landing page or bypassing verification', () => {
  let auth = { user: null, loading: true };
  const imports = {
    '../context/AuthContext': { useAuth: () => auth },
    '../utils/launchScope': { normalizeLaunchDashboardMode },
    '../utils/modeAccess': { dashboardKeyForMode },
    './RouteErrorBoundary': { __esModule: true, default: ({ children }) => children },
    'react-router-dom': { useLocation: () => ({ pathname: '/' }),
      Navigate: ({ to }) => React.createElement('i', { 'data-redirect': to }) },
  };
  imports['./ProtectedRoute'] = { __esModule: true, default: component('components/ProtectedRoute.jsx', imports) };
  const Home = component('components/ModeHomeRoute.jsx', imports);
  const rendered = [];
  const page = name => () => { rendered.push(name); return React.createElement('h1', null, name); };
  const props = { DiscoveryPage: page('discovery'), DashboardPage: page('work'), LoadingState: page('verifying') };
  const render = () => { rendered.length = 0; return renderToStaticMarkup(React.createElement(Home, props)); };
  render(); assert.deepEqual(rendered, ['verifying']);
  auth = { user: null, loading: false };
  render(); assert.deepEqual(rendered, ['discovery']);
  const base = { id: 1, role: 'helper', email_verified: true, didit_status: 'verified' };
  // Active customer mode wins over an older helper role value.
  auth.user = { ...base, default_mode: 'customer' };
  render(); assert.deepEqual(rendered, ['discovery']);
  for (const default_mode of ['helper', 'business_owner', 'business_manager', 'business_representative', 'business_employee', 'business_support_agent', 'admin']) {
    auth.user = { ...base, default_mode };
    render(); assert.deepEqual(rendered, ['work'], default_mode);
  }
  auth.user = { ...base, role: 'helper_pro' };
  render(); assert.deepEqual(rendered, ['work'], 'legacy provider accounts');
  auth.user = { ...base, default_mode: 'business_owner', email_verified: false };
  assert.match(render(), /data-redirect="\/verify-email"/);
  assert.deepEqual(rendered, []);
  auth.user = { ...base, default_mode: 'business_owner', didit_status: 'pending' };
  assert.match(render(), /data-redirect="\/verify-identity"/);
  assert.deepEqual(rendered, []);
});

test('customer discovery exposes bookings while helper actions follow the active mode', () => {
  let user;
  const Hero = component('components/Hero.jsx', {
    '../context/AuthContext': { useAuth: () => ({ user }) },
    '../utils/navbarNavigation': { navbarMode },
    'react-i18next': { useTranslation: () => ({ t: key => key }) },
    './PrefetchLink': { __esModule: true, default: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children) },
  });
  const render = () => renderToStaticMarkup(React.createElement(Hero));
  user = { role: 'helper', default_mode: 'customer' };
  let html = render();
  assert.match(html, /href="\/my-bookings"/);
  assert.match(html, /href="\/post-job"/);
  assert.doesNotMatch(html, /href="\/jobs"/);
  user = { role: 'helper', default_mode: 'helper' };
  html = render();
  assert.match(html, /href="\/jobs"/);
  assert.match(html, /href="\/helper-dashboard"/);
  user = null;
  html = render();
  assert.match(html, /href="\/join"/);
  assert.match(html, /href="\/helpers"/);
  assert.doesNotMatch(html, /href="\/my-bookings"/);
});
