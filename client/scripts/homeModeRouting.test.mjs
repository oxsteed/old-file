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
import * as accessProjection from '../src/utils/accessProjection.js';

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
  let projection = null;
  const imports = {
    '../context/AuthContext': { useAuth: () => auth },
    '../utils/launchScope': { normalizeLaunchDashboardMode },
    '../utils/modeAccess': { dashboardKeyForMode },
    '../utils/accessProjection': accessProjection,
    '../hooks/useAccessProjection': { __esModule: true, default: () => projection },
    'react-i18next': { useTranslation: () => ({ t: key => key }) },
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

  // WP-015: with the projection on, the preference is honoured only while
  // access backs it; removed access falls back to personal Home with a notice.
  const on = (personal, organizations = []) => ({ flags: { accessProjection: true }, access: { personal, organizations } });
  auth.user = { ...base, default_mode: 'helper' };
  projection = on(['customer', 'helper.offer_services']);
  render(); assert.deepEqual(rendered, ['work'], 'approved helper keeps the dashboard');
  projection = on(['customer']);
  let html = render(); assert.deepEqual(rendered, ['discovery'], 'revoked helper sees personal Home');
  assert.match(html, /role="status"[^>]*>progressiveAccess\.home\.accessChanged/);
  auth.user = { ...base, default_mode: 'business_owner' };
  projection = on(['customer'], [{ type: 'business', id: '7', role: 'owner' }]);
  render(); assert.deepEqual(rendered, ['work'], 'canonical owner keeps the business dashboard');
  auth.user = { ...base, default_mode: 'customer' };
  projection = on(['customer', 'helper.offer_services']);
  html = render(); assert.deepEqual(rendered, ['discovery'], 'an approval never replaces the dashboard choice');
  assert.doesNotMatch(html, /role="status"/);
  auth.user = { ...base, default_mode: 'helper' };
  projection = { flags: { accessProjection: false }, access: { personal: ['customer'] } };
  render(); assert.deepEqual(rendered, ['work'], 'flag off: legacy behaviour');
  auth.user = { ...base, role: 'admin', default_mode: 'admin' };
  projection = on(['customer']);
  render(); assert.deepEqual(rendered, ['work'], 'staff roles are not projected');
  projection = null;
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
