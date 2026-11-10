'use strict';

function runtimeRole(env = process.env) {
  const role = String(env.OXSTEED_RUNTIME_ROLE || 'combined').trim();
  if (!['combined', 'web'].includes(role)) throw new Error('Invalid OXSTEED_RUNTIME_ROLE.');
  return role;
}

function runsBackgroundWorkers(env = process.env) {
  return runtimeRole(env) === 'combined';
}

const WORKER_ACTIVATION_FILE = '/run/oxsteed-worker-active';

function usesManagedWorkerHandoff(env = process.env) {
  if (env.OXSTEED_MANAGED_WORKER !== 'true') return false;
  if (!runsBackgroundWorkers(env)) throw new Error('Managed worker handoff requires the combined runtime.');
  return true;
}

module.exports = { runtimeRole, runsBackgroundWorkers, usesManagedWorkerHandoff, WORKER_ACTIVATION_FILE };
