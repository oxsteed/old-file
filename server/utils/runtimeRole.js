'use strict';

function runtimeRole(env = process.env) {
  const role = String(env.OXSTEED_RUNTIME_ROLE || 'combined').trim();
  if (!['combined', 'web'].includes(role)) throw new Error('Invalid OXSTEED_RUNTIME_ROLE.');
  return role;
}

function runsBackgroundWorkers(env = process.env) {
  return runtimeRole(env) === 'combined';
}

module.exports = { runtimeRole, runsBackgroundWorkers };
