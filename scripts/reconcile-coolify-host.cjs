'use strict';

// Scheduled on the MacBook, independently of GitHub/Coolify deployment triggers.
// No dotenv, API token, or Docker socket inside the application is required.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { findApplicationContainer, provisionReleaseMetadata, validateApplicationUuid, runDocker } = require('./provision-release-metadata.cjs');

function syncBackup(containerName, run = execFileSync) {
  try {
    run(process.execPath, [path.join(__dirname, 'sync-coolify-backup-monitor.cjs'),
      '--apply', '--app-container', containerName], {
      encoding: 'utf8', timeout: 55000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('Backup synchronization failed.');
  }
}

function reconcileHost({ applicationUuid, apply = false, docker = runDocker,
  provision = provisionReleaseMetadata, backupSync = syncBackup } = {}) {
  validateApplicationUuid(applicationUuid);
  // Discover exactly one running app for this resource. Refuse rolling-deploy
  // ambiguity; the next five-minute cycle retries without picking an old app.
  const container = findApplicationContainer({ applicationUuid, docker });
  const report = { applicationUuid, containerName: container.name, containerId: container.containerId,
    applied: apply, release: { ok: false }, backup: { ok: false, skipped: !apply } };
  try {
    const metadata = provision({ applicationUuid, docker, expectedContainerId: container.containerId, checkOnly: !apply });
    report.release = { ok: true, changed: metadata.changed, canProvision: metadata.canProvision, missing: metadata.missing };
  } catch {
    report.release = { ok: false, error: 'Release metadata reconciliation failed; retry next cycle.' };
  }
  if (apply) {
    try {
      // Recheck immediately before Boyle's delivery, including the container
      // name. Never redirect a report to a replacement or another application.
      const current = findApplicationContainer({ applicationUuid, docker });
      if (current.containerId !== container.containerId || current.name !== container.name) throw new Error('changed');
      backupSync(container.name);
      report.backup = { ok: true, skipped: false };
    } catch {
      report.backup = { ok: false, skipped: false, error: 'Backup synchronization failed; retry next cycle.' };
    }
  }
  report.ok = report.release.ok && (report.backup.ok || report.backup.skipped);
  return report;
}

module.exports = { reconcileHost, syncBackup };

if (require.main === module) {
  const [mode, flag, applicationUuid, ...extra] = process.argv.slice(2);
  try {
    if (!['--check', '--apply'].includes(mode) || flag !== '--application' || extra.length) {
      throw new Error('Usage: node scripts/reconcile-coolify-host.cjs --check|--apply --application <uuid>');
    }
    const report = reconcileHost({ applicationUuid, apply: mode === '--apply' });
    console.log(JSON.stringify(report));
    if (!report.ok) process.exitCode = 1;
  } catch {
    console.error('Host reconciliation failed; verify the application UUID and Colima availability.');
    process.exitCode = 1;
  }
}
