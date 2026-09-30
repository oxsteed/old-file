'use strict';
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
async function main(args) {
  if (args.length !== 2 || args[0] !== '--runtime-image' || !/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]+$/.test(args[1]))
    throw new Error('Usage: node scripts/verify-backup-monitor-postgres.cjs --runtime-image EXISTING_APP_IMAGE');
  const name = `oxsteed-backup-monitor-test-${randomUUID()}`;
  const docker = (args, options = {}) => spawnSync('docker', ['--context', 'colima', ...args], { encoding: 'utf8', timeout: 20000, ...options });
  let created = false;
  try {
    // No published port, attached network, persistent volume, password, or production write.
    created = true;
    const started = docker(['run', '-d', '--pull=never', '--name', name, '--network', 'none',
      '--tmpfs', '/var/lib/postgresql/data:rw', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
      'postgres:15-alpine', '-c', 'listen_addresses=127.0.0.1'], { timeout: 60000 });
    if (started.status !== 0) throw new Error('Disposable PostgreSQL could not start');
    created = true;
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (docker(['exec', name, 'pg_isready', '-U', 'postgres']).status === 0) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('Disposable PostgreSQL not ready');
    const tested = docker(['run', '--rm', '--pull=never', '--network', `container:${name}`,
      '--mount', `type=bind,source=${resolve(__dirname, '..')},target=/workspace,readonly`,
      '-e', 'NODE_PATH=/app/server/node_modules', '-e', 'OXSTEED_DISPOSABLE_BACKUP_TEST=true',
      '-e', 'LOG_LEVEL=error', '--entrypoint', 'node', args[1], '/workspace/server/scripts/verify-backup-monitor-postgres.cjs'],
    { timeout: 60000, maxBuffer: 1024 * 1024 });
    process.stdout.write(tested.stdout || '');
    if (tested.status !== 0) { process.stderr.write(tested.stderr || ''); throw new Error('Real PostgreSQL backup tests failed'); }
  } finally {
    if (created) {
      const removed = docker(['rm', '-f', name]);
      if (removed.status !== 0 && !removed.stderr?.includes('No such container')) throw new Error(`Disposable test cleanup required: ${name}`);
      console.log('Removed disposable synthetic PostgreSQL container and its temporary data');
    }
  }
}
main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
