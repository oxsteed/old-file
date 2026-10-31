'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readinessLabels, retryConfig } = require('./configure-web-readiness.cjs');
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
  for (const line of original.split('\n')) assert.ok(result.labels.split('\n').includes(line));
  assert.match(result.labels, /oxsteed-ready-site.rule=.*Path\(`\/ready`\).*Method\(`GET`\).*Method\(`HEAD`\)/);
  assert.match(result.labels, /oxsteed-ready-site.middlewares=existing-security,oxsteed-ready-retry/);
  assert.match(result.labels, /oxsteed-ready-site.tls.certresolver=letsencrypt/);
  assert.match(result.labels, /oxsteed-ready-site.entrypoints=https/);
  assert.equal(result.routers, 1);
  assert.deepEqual(retryConfig.status, ['503']);
  assert.equal(retryConfig.retryNonIdempotentMethod, false);
  assert.equal(retryConfig.attempts, 3);
  assert.equal(readinessLabels(result.labels).labels, result.labels);
});
test('refuses unexpected hosts, paths, services and missing routing', () => {
  for (const input of ['', original.replace('oxsteed.com', 'other.invalid'), original.replace('PathPrefix(`/`)', 'PathPrefix(`/admin`)'), original.replace('site.service=oxsteed-web-sqbntzhvwhbbywhs9prfhw51-health4', 'site.service=other')]) assert.throws(() => readinessLabels(input));
});
