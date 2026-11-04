'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readinessLabels, retryConfig } = require('./configure-web-readiness.cjs');
const budgets = require('../server/config/readinessBudgets.json');
const original = [
  'traefik.http.routers.site.rule=Host(`oxsteed.com`) && PathPrefix(`/`)',
  'traefik.http.routers.site.service=oxsteed-web-sqbntzhvwhbbywhs9prfhw51-health4',
  'traefik.http.routers.site.tls=true',
  'traefik.http.routers.site.tls.certresolver=letsencrypt',
  'traefik.http.routers.site.entrypoints=https',
  'traefik.http.routers.site.middlewares=existing-security',
  'traefik.http.services.oxsteed-web-sqbntzhvwhbbywhs9prfhw51-health4.loadbalancer.healthcheck.path=/ready',
].join('\n');
test('preserves original routing and private health checks, adding bounded GET/HEAD readiness failover only', () => {
  const result = readinessLabels(original);
  for (const line of original.split('\n')) assert.ok(result.labels.split('\n').includes(line.replace('routers.site.', 'routers.site-health5.').replace('-health4', '-health5')));
  assert.match(result.labels, /oxsteed-ready-site-health5.rule=.*Path\(`\/ready`\).*Method\(`GET`\).*Method\(`HEAD`\)/);
  assert.match(result.labels, /oxsteed-ready-site-health5.middlewares=existing-security,oxsteed-ready-retry/);
  assert.match(result.labels, /oxsteed-ready-site-health5.tls.certresolver=letsencrypt/);
  assert.match(result.labels, /oxsteed-ready-site-health5.entrypoints=https/);
  assert.ok(!result.labels.includes('-health4'));
  assert.match(result.labels, /routers.site-health5.priority=1/);
  assert.match(result.labels, /oxsteed-ready-site-health5.priority=5001/);
  assert.equal(result.routers, 1);
  assert.match(result.labels, /loadbalancer.healthcheck.timeout=15s/);
  assert.ok(budgets.proxyHealthTimeoutMs > budgets.backgroundProbeTimeoutMs + budgets.backgroundConfirmationTimeoutMs);
  assert.deepEqual(retryConfig.status, ['503']);
  assert.equal(retryConfig.retryNonIdempotentMethod, false);
  assert.equal(retryConfig.attempts, 3);
  assert.equal(readinessLabels(result.labels).labels, result.labels);
});
test('replaces only the managed health deadline and preserves unrelated services', () => {
  const prefix = 'traefik.http.services.oxsteed-web-sqbntzhvwhbbywhs9prfhw51-health5.loadbalancer.healthcheck';
  const input = original + `\n${prefix.replace('-health5', '-health4')}.timeout=3s\ntraefik.http.services.other.loadbalancer.healthcheck.timeout=3s`;
  const result = readinessLabels(input);
  assert.equal(result.labels.split('\n').filter(line => line.startsWith(`${prefix}.timeout=`)).length, 1);
  assert.ok(result.labels.includes(`${prefix}.timeout=15s`));
  assert.ok(result.labels.includes('traefik.http.services.other.loadbalancer.healthcheck.timeout=3s'));
});
test('versions production-style router names without sharing old service definitions', () => {
  const source = original.replaceAll('routers.site.', 'routers.https-3-app-health4.') + '\ntraefik.http.routers.https-3-app-health4.priority=220';
  const result = readinessLabels(source);
  assert.match(result.labels, /routers.https-3-app-health5.priority=221/);
  assert.match(result.labels, /routers.https-3-app-health5.service=oxsteed-web-sqbntzhvwhbbywhs9prfhw51-health5/);
  assert.ok(!result.labels.includes('-health4'));
  assert.equal(readinessLabels(result.labels).labels, result.labels);
  assert.throws(() => readinessLabels(source + '\ntraefik.http.services.oxsteed-web-sqbntzhvwhbbywhs9prfhw51-health5.loadbalancer.healthcheck.path=/ready'));
});
test('refuses unexpected hosts, paths, services and missing routing', () => {
  for (const input of ['', original.replace('oxsteed.com', 'other.invalid'), original.replace('PathPrefix(`/`)', 'PathPrefix(`/admin`)'), original.replace('site.service=oxsteed-web-sqbntzhvwhbbywhs9prfhw51-health4', 'site.service=other'), original.replace('healthcheck.path=/ready', 'healthcheck.path=/health')]) assert.throws(() => readinessLabels(input));
});
