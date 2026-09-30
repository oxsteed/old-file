'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { createInstallPlan, installReconciler, installPaths, BUNDLE_FILES, USER_HOME, SOURCE_ROOT } = require('./install-coolify-host-reconciler.cjs');

const applicationUuid = 'app123';
const absent = () => Object.assign(new Error('missing'), { code: 'ENOENT' });

function fixture({ loaded = false, symlink = null, conflict = null, lintFailure = false } = {}) {
  const files = new Map();
  if (conflict) files.set(conflict, 'existing user data');
  const calls = [];
  const directories = new Set();
  const fsImpl = {
    readFileSync: (file) => {
      if (file.startsWith(`${SOURCE_ROOT}/`)) return fs.readFileSync(file, 'utf8');
      if (!files.has(file)) throw absent();
      return files.get(file);
    },
    lstatSync: (file) => {
      if (file === symlink) return { isSymbolicLink: () => true, isDirectory: () => false };
      if (files.has(file)) return { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true };
      if (directories.has(file) || file === '/' || file === '/Users' || file === USER_HOME) {
        return { isSymbolicLink: () => false, isDirectory: () => true };
      }
      if (file.startsWith(SOURCE_ROOT)) return fs.lstatSync(file);
      throw absent();
    },
    statSync: () => ({ uid: 501 }),
    accessSync: (file) => calls.push(['access', file]),
    mkdirSync: (file, options) => { directories.add(file); calls.push(['mkdir', file, options]); },
    writeFileSync: (file, contents, options) => {
      calls.push(['write', file, options]);
      assert.equal(options.flag, 'wx');
      assert.equal(options.mode, 0o600);
      if (files.has(file)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      files.set(file, contents);
    },
  };
  const run = (program, args, options) => {
    calls.push(['run', program, args, options]);
    return { status: program.endsWith('plutil') ? lintFailure ? 1 : 0 : args[0] === 'print' ? loaded ? 0 : 113 : 0 };
  };
  return { calls, files, options: { applicationUuid, fsImpl, run, uid: 501, userHome: USER_HOME } };
}

test('plan is read-only and generates a scoped five-minute template with fixed safe paths', () => {
  const f = fixture();
  const plan = installReconciler(f.options);
  assert.equal(plan.applied, false);
  assert.equal(f.calls.length, 0);
  assert.equal(plan.intervalSeconds, 300);
  assert.ok(plan.files.every(({ destination }) => destination.startsWith(`${USER_HOME}/Library/`)));
  const plist = plan.files.at(-1).contents;
  assert.match(plist, /<integer>300<\/integer>/);
  assert.match(plist, /<string>--application<\/string>\s*<string>app123<\/string>/);
  assert.match(plist, /<string>--apply<\/string>/);
  assert.ok(!plist.includes(SOURCE_ROOT));
  assert.ok(!/TOKEN|PASSWORD|SECRET|__\w+__/.test(plist));
  assert.ok(plan.files.some(({ source }) => source === `${SOURCE_ROOT}/scripts/sync-coolify-backup-monitor.cjs`));
});

test('generated plist passes the native macOS parser', { skip: process.platform !== 'darwin' }, () => {
  const plan = createInstallPlan({ applicationUuid });
  const output = execFileSync('/usr/bin/plutil', ['-lint', '-'], { input: plan.files.at(-1).contents, encoding: 'utf8', timeout: 10000 });
  assert.match(output, /OK/);
});

test('apply copies only the reviewed dependency bundle and registers a new job without restart', () => {
  const f = fixture();
  const result = installReconciler({ ...f.options, apply: true });
  assert.equal(result.registered, true);
  assert.equal(f.files.size, BUNDLE_FILES.length + 1);
  assert.ok(f.calls.filter(([kind]) => kind === 'write').every(([, file]) => !file.startsWith(SOURCE_ROOT)));
  const launchctl = f.calls.filter(([kind, program]) => kind === 'run' && program.endsWith('launchctl'));
  assert.deepEqual(launchctl.map(([, , args]) => args[0]), ['print', 'bootstrap']);
  assert.deepEqual(launchctl[1][2], ['bootstrap', 'gui/501', installPaths(applicationUuid).plistPath]);
});

test('an identical loaded installation is idempotent and never restarts the job', () => {
  const f = fixture({ loaded: true });
  installReconciler({ ...f.options, apply: true });
  const snapshot = [...f.files];
  const second = installReconciler({ ...f.options, apply: true });
  assert.equal(second.registered, false);
  assert.deepEqual([...f.files], snapshot);
  assert.ok(f.calls.filter(([kind, program]) => kind === 'run' && program.endsWith('launchctl'))
    .every(([, , args]) => args[0] === 'print'));
});

test('bad UUIDs, arbitrary executables, symlink destinations, conflicts, root, and lint errors fail closed', () => {
  for (const applicationUuid of ['../escape', '/tmp/app', '-app', 'unknown', 'a'.repeat(65)]) {
    assert.throws(() => createInstallPlan({ applicationUuid }));
  }
  assert.throws(() => createInstallPlan({ applicationUuid, nodePath: '/tmp/node' }));
  const paths = installPaths(applicationUuid);
  for (const options of [{ symlink: paths.installRoot }, { symlink: paths.plistPath },
    { conflict: `${paths.installRoot}/scripts/provision-release-metadata.cjs` }, { lintFailure: true }]) {
    const f = fixture(options);
    assert.throws(() => installReconciler({ ...f.options, apply: true }));
    assert.equal(f.files.size, options.conflict ? 1 : 0);
    assert.ok(f.calls.every(([kind]) => kind !== 'write'));
  }
  for (const override of [{ uid: 0 }, { userHome: '/tmp/elsewhere' }]) {
    const f = fixture();
    assert.throws(() => installReconciler({ ...f.options, ...override, apply: true }));
    assert.equal(f.calls.length, 0);
  }
});

test('installed copies have a complete Node dependency closure, including Boyle’s sync adapter', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oxsteed-reconciliation-bundle-'));
  try {
    const plan = createInstallPlan({ applicationUuid });
    for (const relative of BUNDLE_FILES) {
      const destination = path.join(directory, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, plan.files.find(({ source }) => source === `${SOURCE_ROOT}/${relative}`).contents);
    }
    const source = `const worker=require(${JSON.stringify(path.join(directory, 'scripts/reconcile-coolify-host.cjs'))});const backup=require(${JSON.stringify(path.join(directory, 'scripts/sync-coolify-backup-monitor.cjs'))});console.log(typeof worker.reconcileHost+','+typeof backup.main);`;
    assert.equal(execFileSync(process.execPath, ['-e', source], { encoding: 'utf8', timeout: 10000 }).trim(), 'function,function');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
