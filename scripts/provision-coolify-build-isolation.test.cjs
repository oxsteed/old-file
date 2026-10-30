'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLimits, application } = require('./provision-coolify-build-isolation.cjs');
const limits = { Memory: 2300 * 1024 * 1024, MemorySwap: 2300 * 1024 * 1024, CpuQuota: 100000, CpuPeriod: 100000, CpuShares: 256 };
test('refuses an unbounded or conflicting builder without replacing it', () => {
  validateLimits({ HostConfig: limits });
  for (const key of Object.keys(limits)) {
    assert.throws(() => validateLimits({ HostConfig: { ...limits, [key]: 0 } }), /unexpected resource limits/);
  }
});
test('checks build-only configuration and refuses a foreign resource or runtime setting', () => {
  const good = { application: 'sqbntzhvwhbbywhs9prfhw51', buildOnly: true, builder: 'oxsteed-web-bounded' };
  const run = row => () => 'OXSTEED_RESULT:' + JSON.stringify(row);
  assert.deepEqual(application(false, run(good)), good);
  for (const row of [{ ...good, application: 'other' }, { ...good, buildOnly: false }, { ...good, builder: 'other' }]) {
    assert.throws(() => application(false, run(row)), /not configured/);
  }
});
