'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { reconcileHost, syncBackup } = require('./reconcile-coolify-host.cjs');

const applicationUuid = 'app123';
const container = { containerId: 'a'.repeat(64), name: '/app-app123-current', project: applicationUuid,
  service: 'app', running: true };

test('Boyle’s adapter is invoked with --apply --app-container NAME and sanitized failures', () => {
  const calls = [];
  syncBackup('app-app123-current', (program, args, options) => calls.push({ program, args, options }));
  assert.equal(calls[0].program, process.execPath);
  assert.match(calls[0].args[0], /\/scripts\/sync-coolify-backup-monitor\.cjs$/);
  assert.deepEqual(calls[0].args.slice(1), ['--apply', '--app-container', 'app-app123-current']);
  assert.equal(calls[0].options.timeout, 55000);
  assert.throws(() => syncBackup('app-app123-current', () => { throw new Error('private transport payload'); }),
    (error) => error.message === 'Backup synchronization failed.');
});

function fixture({ provisionError = false, backupError = false, replacement = false } = {}) {
  const calls = [];
  let inspectCount = 0;
  return { calls, options: { applicationUuid, apply: true,
    docker: (args) => {
      calls.push(['docker', args]);
      if (args[0] === 'ps') return 'a'.repeat(12);
      if (args[0] === 'inspect') {
        inspectCount += 1;
        return JSON.stringify(inspectCount > 1 && replacement ? { ...container, name: '/app-app123-new' } : container);
      }
      throw new Error('unexpected');
    },
    provision: (options) => {
      calls.push(['provision', options]);
      if (provisionError) throw new Error('secret transport error');
      return { changed: false, canProvision: true, missing: [] };
    },
    backupSync: (name) => {
      calls.push(['backup', name]);
      if (backupError) throw new Error('secret backup error');
    },
  } };
}

test('each scheduled cycle provisions and uses Boyle’s discovered container interface', () => {
  const f = fixture();
  const report = reconcileHost(f.options);
  assert.equal(report.ok, true);
  assert.deepEqual(f.calls.find(([kind]) => kind === 'backup'), ['backup', 'app-app123-current']);
  const provision = f.calls.find(([kind]) => kind === 'provision')[1];
  assert.equal(provision.applicationUuid, applicationUuid);
  assert.equal(provision.expectedContainerId, container.containerId);
  assert.equal(provision.checkOnly, false);
  assert.equal(report.release.changed, false);
});

test('check mode does not apply release records or invoke backup delivery', () => {
  const f = fixture();
  const report = reconcileHost({ ...f.options, apply: false });
  assert.equal(report.applied, false);
  assert.equal(f.calls.find(([kind]) => kind === 'provision')[1].checkOnly, true);
  assert.ok(f.calls.every(([kind]) => kind !== 'backup'));
});

test('metadata failure still attempts backup synchronization and redacts errors', () => {
  const f = fixture({ provisionError: true });
  const report = reconcileHost(f.options);
  assert.equal(report.ok, false);
  assert.equal(report.backup.ok, true);
  assert.ok(f.calls.some(([kind]) => kind === 'backup'));
  assert.ok(!JSON.stringify(report).includes('secret'));
});

test('backup failure preserves successful metadata and returns a retryable failure', () => {
  const report = reconcileHost(fixture({ backupError: true }).options);
  assert.equal(report.ok, false);
  assert.equal(report.release.ok, true);
  assert.equal(report.backup.ok, false);
  assert.ok(!JSON.stringify(report).includes('secret'));
});

test('replacement, ambiguous selection, wrong application, and bad UUID cannot receive backup writes', () => {
  const f = fixture({ replacement: true });
  assert.equal(reconcileHost(f.options).backup.ok, false);
  assert.ok(f.calls.every(([kind]) => kind !== 'backup'));
  for (const output of ['', `${'a'.repeat(12)}\n${'b'.repeat(12)}`]) {
    const bad = fixture();
    assert.throws(() => reconcileHost({ ...bad.options, docker: () => output }));
    assert.equal(bad.calls.length, 0);
  }
  for (const applicationUuid of ['../other', 'a/b', 'unknown', '', '-other']) {
    const bad = fixture();
    assert.throws(() => reconcileHost({ ...bad.options, applicationUuid }));
    assert.equal(bad.calls.length, 0);
  }
});
