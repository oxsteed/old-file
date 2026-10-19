'use strict';

/**
 * Route scope inventory (analytics scope report, Area 4).
 *
 * Loads every router under server/routes, walks its Express stack and reports,
 * for each route whose path carries a tenant parameter (:businessId,
 * :restaurantId, ...), which scope gate protects it. Used by:
 *   - __tests__/routeScopeGuard.test.js (fails when a tenant route has neither
 *     a scope gate nor an explicit scopeExempt marker), and
 *   - `node scripts/scope/routeInventory.js --markdown` (inventory doc).
 *
 * Gates are recognized by the `scopeGate` property that the shared middleware
 * factories set on the functions they return (see middleware/scopeGates.js and
 * middleware/requireBusinessAccess.js), never by function name.
 */

const fs = require('fs');
const path = require('path');

const TENANT_PARAMS = ['businessId', 'restaurantId', 'bizId', 'business_id', 'restaurant_id'];
const TENANT_RE = new RegExp(`:(${TENANT_PARAMS.join('|')})(?![A-Za-z0-9_])`);
const ROUTES_DIR = path.join(__dirname, '..', '..', 'routes');
const CONTROLLERS_DIR = path.join(__dirname, '..', '..', 'controllers');

function routerOf(mod) {
  if (!mod) return [];
  if (typeof mod === 'function' && Array.isArray(mod.stack)) return [['default', mod]];
  const out = [];
  for (const [k, v] of Object.entries(mod)) {
    if (typeof v === 'function' && Array.isArray(v.stack)) out.push([k, v]);
  }
  return out;
}

function layerPrefix(layer) {
  // Express 4 keeps the mount path only as a regexp; recover simple literals.
  const src = layer.regexp && layer.regexp.source;
  if (!src || src === '^\\/?(?=\\/|$)') return '';
  const m = src.match(/^\^((?:\\\/[^\\?(]+|\\\/\(\?:\\\/\(\[\^\\\/\]\+\?\)\))+)\\\/\?\(\?=\\\/\|\$\)$/);
  if (!m) return `{${src}}`;
  let keyIdx = 0;
  return m[1].replace(/\(\?:\\\/\(\[\^\\\/\]\+\?\)\)/g, () => `/:${(layer.keys[keyIdx++] || {}).name || 'param'}`).replace(/\\\//g, '/');
}

function gateOf(fn) {
  if (!fn) return null;
  return fn.scopeGate || null;
}

// A router.use(prefix, fn) layer only applies to routes under its prefix, so
// each inherited middleware is tested against the path it would see.
function appliesTo(useLayer, relPath) {
  if (!useLayer.regexp || useLayer.regexp.fast_slash) return true;
  try { return useLayer.regexp.test(relPath); } catch { return false; }
}

function collectFromStack(stack, prefix, inherited, out, file, exportName) {
  const uses = [];
  for (const layer of stack) {
    if (layer.route) {
      const local = uses.filter((u) => appliesTo(u, layer.route.path));
      const chain = [...inherited, ...local.map((u) => u.handle)];
      const handlers = layer.route.stack.map((s) => s.handle);
      const full = prefix + layer.route.path;
      out.push({
        file,
        exportName,
        path: full,
        methods: Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]).map((m) => m.toUpperCase()),
        middleware: [...chain, ...handlers],
        middlewareNames: [...chain, ...handlers].map((h) => h.name || 'anonymous'),
        params: full.match(/:([A-Za-z0-9_]+)/g)?.map((p) => p.slice(1)) || [],
        handler: handlers[handlers.length - 1],
      });
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      const childPrefix = layerPrefix(layer);
      const local = uses.filter((u) => appliesTo(u, childPrefix || '/'));
      collectFromStack(layer.handle.stack, prefix + childPrefix, [...inherited, ...local.map((u) => u.handle)], out, file, exportName);
    } else {
      uses.push(layer);
    }
  }
}

/** router.param() callbacks also gate every route using that parameter. */
function paramGates(router) {
  const gates = {};
  for (const [name, fns] of Object.entries(router.params || {})) {
    for (const fn of fns) {
      const g = gateOf(fn) || gateOf(fn.__scopeTarget);
      if (g) gates[name] = g;
    }
  }
  return gates;
}

function controllerIndex() {
  const index = new Map();
  for (const [file, entry] of Object.entries(require.cache)) {
    if (!file.startsWith(CONTROLLERS_DIR) || !entry || !entry.exports) continue;
    const rel = path.relative(path.join(__dirname, '..', '..'), file);
    const exp = entry.exports;
    if (typeof exp === 'object' || typeof exp === 'function') {
      for (const [k, v] of Object.entries(exp)) if (typeof v === 'function' && !index.has(v)) index.set(v, `${rel}#${k}`);
    }
  }
  return index;
}

function collectRoutes({ files } = {}) {
  const list = files || fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js')).map((f) => path.join(ROUTES_DIR, f));
  const routes = [];
  const errors = [];
  for (const abs of list) {
    const rel = path.relative(path.join(__dirname, '..', '..'), abs);
    let mod;
    try { mod = require(abs); } catch (err) { errors.push({ file: rel, error: err.message.split('\n')[0] }); continue; }
    for (const [exportName, router] of routerOf(mod)) {
      const out = [];
      collectFromStack(router.stack, '', [], out, rel, exportName);
      const pg = paramGates(router);
      for (const r of out) r.paramGates = r.params.filter((p) => pg[p]).map((p) => ({ param: p, gate: pg[p] }));
      routes.push(...out);
    }
  }
  const ctrl = controllerIndex();
  for (const r of routes) {
    r.tenantParams = r.params.filter((p) => TENANT_PARAMS.includes(p));
    r.gates = [
      ...r.middleware.map(gateOf).filter(Boolean),
      ...r.paramGates.map((g) => g.gate),
    ];
    r.handlerRef = ctrl.get(r.handler) || (r.handler && r.handler.name ? `${r.file}#${r.handler.name}` : `${r.file}#inline`);
  }
  return { routes, errors };
}

function tenantRoutes(all) {
  return all.filter((r) => TENANT_RE.test(r.path) || r.tenantParams.length);
}

// Inline (controller-level) checks recognized in the handler source, for the
// inventory only. The guard never trusts these; it requires a route gate.
const INLINE_CHECKS = [
  ['restaurant-wrapper', /requireRestaurantAccess\(|resolveRestaurantAccess\(|isRestaurantOwner\(/],
  ['legacy-business-helper', /\b(ownedBusiness|canEditProfile|canAccessBusinessTeam|canManageBusinessFinance|canAccessBusiness)\(/],
  ['support-employer', /\b(canManageBusiness|canAccessBusiness|userCanManageBusiness|userCanAdministrateBusiness|userCanAccessBusinessConversations|canManageAgent)\(/],
  ['inline-business-members', /business_members/],
  ['resolve-business', /resolveBusinessAccess\(/],
  ['admin-role', /req\.user\??\.role\s*[!=]==?\s*['"](admin|super_admin)/],
];
function inlineChecks(fn) {
  if (typeof fn !== 'function') return [];
  const src = Function.prototype.toString.call(fn);
  return INLINE_CHECKS.filter(([, re]) => re.test(src)).map(([k]) => k);
}

function classify(route) {
  const kinds = route.gates.map((g) => g.kind);
  if (kinds.some((k) => k !== 'exempt')) return 'gated';
  if (kinds.includes('exempt')) return 'exempt';
  return 'ungated';
}

module.exports = { collectRoutes, tenantRoutes, classify, inlineChecks, TENANT_PARAMS };

if (require.main === module) {
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'inventory-only-secret-'.padEnd(64, 'x');
  const { routes, errors } = collectRoutes();
  const tenant = tenantRoutes(routes);
  const rows = tenant.map((r) => ({
    file: r.file, method: r.methods.join(','), path: r.path, status: classify(r),
    gates: r.gates.map((g) => g.kind + (g.detail ? `:${g.detail}` : '')).join(' + '),
    handler: r.handlerRef,
    inline: inlineChecks(r.handler).join(','),
    middlewareNames: r.middlewareNames.join(' > '),
  }));
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ errors, rows }, null, 2));
  } else {
    const by = {};
    for (const r of rows) (by[r.status] ||= 0, by[r.status]++);
    console.log(JSON.stringify({ total: rows.length, ...by, errors }, null, 2));
    for (const r of rows.filter((x) => x.status === 'ungated')) console.log(`${r.file} ${r.method} ${r.path} -> ${r.handler}`);
  }
  setTimeout(() => process.exit(0), 50);
}
