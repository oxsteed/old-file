'use strict';

// --plan is read-only. --apply is a future explicit installation action; it
// never deletes files, overwrites a different installed bundle, or restarts
// a loaded job. All destinations are fixed descendants of this user's home.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { validateApplicationUuid, validateRuntime } = require('./provision-release-metadata.cjs');

const USER_HOME = '/Users/oxsteed';
const SOURCE_ROOT = '/Users/oxsteed/Documents/GitHub/6';
const INSTALL_PARENT = `${USER_HOME}/Library/Application Support/OxSteed/host-reconciliation`;
const AGENTS_DIRECTORY = `${USER_HOME}/Library/LaunchAgents`;
const NODE_PATHS = ['/usr/local/bin/node', '/opt/homebrew/bin/node'];
const BUNDLE_FILES = [
  'scripts/reconcile-coolify-host.cjs',
  'scripts/provision-release-metadata.cjs',
  'scripts/reconcile-rejected-web-candidates.cjs',
  'server/utils/release.js',
  'scripts/sync-coolify-backup-monitor.cjs',
  'server/services/coolifyBackupEvidence.js',
  'server/services/restoreVerificationProfiles.js',
  'server/scripts/export-coolify-backup-evidence.sql',
];

function escapeXml(value) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
}

function installPaths(applicationUuid) {
  validateApplicationUuid(applicationUuid);
  const label = `com.oxsteed.host-reconciliation.${applicationUuid}`;
  const installRoot = `${INSTALL_PARENT}/${applicationUuid}`;
  return { label, installRoot, plistPath: `${AGENTS_DIRECTORY}/${label}.plist`,
    stdoutPath: `${installRoot}/reconciliation.out.log`, stderrPath: `${installRoot}/reconciliation.err.log` };
}

function createInstallPlan({ applicationUuid, runtime = 'compose', backgroundApplicationUuid, nodePath = NODE_PATHS[0], fsImpl = fs } = {}) {
  if (path.resolve(__dirname, '..') !== SOURCE_ROOT || !NODE_PATHS.includes(nodePath)) {
    throw new Error('Use the reviewed checkout and an allowlisted absolute Node path.');
  }
  const paths = installPaths(applicationUuid);
  validateRuntime(runtime);
  if (runtime === 'web') {
    validateApplicationUuid(backgroundApplicationUuid);
    if (backgroundApplicationUuid === applicationUuid) throw new Error('Web fallback must identify the existing background resource.');
  }
  const intervalSeconds = runtime === 'web' ? 5 : 300;
  const substitutions = { LABEL: paths.label, NODE: nodePath,
    SCRIPT: `${paths.installRoot}/scripts/reconcile-coolify-host.cjs`, APPLICATION_UUID: applicationUuid,
    INSTALL_ROOT: paths.installRoot, STDOUT: paths.stdoutPath, STDERR: paths.stderrPath, RUNTIME: runtime,
    INTERVAL: String(intervalSeconds), BACKGROUND_APPLICATION: backgroundApplicationUuid || '' };
  const template = fsImpl.readFileSync(`${SOURCE_ROOT}/scripts/com.oxsteed.host-reconciliation.plist`, 'utf8');
  const plist = template.replace(/__([A-Z_]+)__/g, (_, key) => {
    if (!Object.hasOwn(substitutions, key)) throw new Error('Unknown installer template field.');
    return escapeXml(substitutions[key]);
  });
  const files = BUNDLE_FILES.map((relative) => ({
    source: `${SOURCE_ROOT}/${relative}`, destination: `${paths.installRoot}/${relative}`,
    contents: fsImpl.readFileSync(`${SOURCE_ROOT}/${relative}`, 'utf8'),
  }));
  files.push({ destination: paths.plistPath, contents: plist });
  return { applicationUuid, runtime, backgroundApplicationUuid, nodePath, ...paths, intervalSeconds, files };
}

function assertNoSymlinks(target, fsImpl) {
  if (!path.isAbsolute(target) || path.normalize(target) !== target || !target.startsWith(`${USER_HOME}/`)) {
    throw new Error('Unsafe installation path.');
  }
  let current = '/';
  const segments = target.slice(1).split('/');
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let stat;
    try { stat = fsImpl.lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink() || (index < segments.length - 1 && !stat.isDirectory())) {
      throw new Error('Installation paths must not contain symlinks or non-directory parents.');
    }
  }
}

function installReconciler({ applicationUuid, runtime = 'compose', backgroundApplicationUuid, nodePath = NODE_PATHS[0], apply = false,
  fsImpl = fs, run = spawnSync, uid = process.getuid(), userHome = os.homedir() } = {}) {
  const plan = createInstallPlan({ applicationUuid, runtime, backgroundApplicationUuid, nodePath, fsImpl });
  if (!apply) return { ...plan, applied: false };
  if (userHome !== USER_HOME || !Number.isInteger(uid) || uid <= 0 || fsImpl.statSync(USER_HOME).uid !== uid) {
    throw new Error('Install only as the owner of the fixed user home, never as root.');
  }
  fsImpl.accessSync(nodePath, fs.constants.X_OK);
  // Preflight the entire bundle before creating anything. A changed bundle
  // requires a separately reviewed update; this installer never overwrites it.
  for (const file of plan.files) {
    if (file.source) assertNoSymlinks(file.source, fsImpl);
    assertNoSymlinks(file.destination, fsImpl);
    try {
      if (!fsImpl.lstatSync(file.destination).isFile() || fsImpl.readFileSync(file.destination, 'utf8') !== file.contents) {
        throw new Error('A different installed file already exists; nothing was overwritten.');
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const log of [plan.stdoutPath, plan.stderrPath]) assertNoSymlinks(log, fsImpl);
  const lint = run('/usr/bin/plutil', ['-lint', '-'], { input: plan.files.at(-1).contents, encoding: 'utf8', timeout: 10000 });
  if (lint.error || lint.status !== 0) throw new Error('Generated launchd configuration failed validation.');
  for (const file of plan.files) {
    fsImpl.mkdirSync(path.dirname(file.destination), { recursive: true, mode: 0o700 });
    // wx protects against replacement between preflight and writing.
    try { fsImpl.writeFileSync(file.destination, file.contents, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code !== 'EEXIST' || fsImpl.readFileSync(file.destination, 'utf8') !== file.contents) throw error;
    }
  }
  const domain = `gui/${uid}`;
  const status = run('/bin/launchctl', ['print', `${domain}/${plan.label}`], { encoding: 'utf8', timeout: 10000 });
  if (status.error) throw new Error('Could not inspect the launchd user domain.');
  let registered = false;
  if (status.status !== 0) {
    const loaded = run('/bin/launchctl', ['bootstrap', domain, plan.plistPath], { encoding: 'utf8', timeout: 10000 });
    if (loaded.error || loaded.status !== 0) throw new Error('LaunchAgent registration failed; reviewed files were preserved.');
    registered = true;
  }
  return { applicationUuid, runtime, label: plan.label, plistPath: plan.plistPath, installRoot: plan.installRoot,
    intervalSeconds: plan.intervalSeconds, applied: true, registered };
}

module.exports = { createInstallPlan, installReconciler, installPaths, assertNoSymlinks, BUNDLE_FILES, USER_HOME, SOURCE_ROOT };

if (require.main === module) {
  const [mode, flag, applicationUuid, ...rest] = process.argv.slice(2);
  try {
    const options = {};
    for (let i = 0; i < rest.length; i += 2) {
      const key = rest[i] === '--runtime' ? 'runtime' : rest[i] === '--node-path' ? 'nodePath'
        : rest[i] === '--background-application' ? 'backgroundApplicationUuid' : null;
      if (!key || !rest[i + 1] || options[key]) throw new Error('Invalid installer options');
      options[key] = rest[i + 1];
    }
    if (!['--plan', '--apply'].includes(mode) || flag !== '--application' ||
        rest.length % 2 !== 0) {
      throw new Error('Usage: node scripts/install-coolify-host-reconciler.cjs --plan|--apply --application <uuid> [--node-path /usr/local/bin/node|/opt/homebrew/bin/node] [--runtime compose|web]');
    }
    const result = installReconciler({ applicationUuid, ...options, apply: mode === '--apply' });
    // Output destinations and generated public configuration only, never
    // copied backup evidence/source contents or process environments.
    console.log(JSON.stringify({ ...result, files: result.files?.map(({ source, destination }) => ({ source, destination })),
      plist: result.files?.at(-1).contents }, null, 2));
  } catch {
    console.error('Host reconciler installation failed; check the validated paths, file conflicts, and user domain.');
    process.exitCode = 1;
  }
}
