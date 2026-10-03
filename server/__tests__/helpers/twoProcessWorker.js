'use strict';

/**
 * Forked by __tests__/processStateTwoProcess.test.js.
 *
 * Each fork is a REAL separate Node process with its own pid (hence its own
 * realtimePresence PROC_ID). It exercises the real processState fencing
 * helpers and the real realtimePresence contract against the shared fake
 * Redis, then reports results to the parent over IPC.
 *
 * Env: REDIS_URL (fake Redis), WORKER_TASK (fence|throttle|presence-a|presence-b).
 * Protocol: parent sends {type:'go'} / {type:'go2'}; worker replies
 * {type:'ready'} on boot and {type:'result', ...} after each run.
 */

const TASK = process.env.WORKER_TASK;

async function runFence() {
  const { tryAcquireOnce } = require('../../utils/processState');
  const won = await tryAcquireOnce('e2e-fence', 30, { namespace: 'e2e' });
  return { won };
}

async function runThrottle() {
  const { throttleOnce } = require('../../utils/processState');
  const allowed = await throttleOnce('e2e-throttle', 30);
  return { allowed };
}

async function runPresenceA(phase) {
  const presence = require('../../services/realtimePresence');
  if (phase === 'go') {
    await presence.markOnline('user', 'e2e-user');
    return { announced: true };
  }
  await presence.markOffline('user', 'e2e-user');
  return { withdrawn: true };
}

async function runPresenceB() {
  const presence = require('../../services/realtimePresence');
  await presence.refreshSnapshot();
  return { online: presence.isOnline('user', 'e2e-user') };
}

async function handle(phase) {
  switch (TASK) {
    case 'fence': return runFence();
    case 'throttle': return runThrottle();
    case 'presence-a': return runPresenceA(phase);
    case 'presence-b': return runPresenceB();
    default: throw new Error(`unknown WORKER_TASK: ${TASK}`);
  }
}

process.on('message', async (msg) => {
  if (!msg || (msg.type !== 'go' && msg.type !== 'go2')) return;
  try {
    const result = await handle(msg.type);
    if (process.send) process.send({ type: 'result', phase: msg.type, ...result });
  } catch (err) {
    if (process.send) process.send({ type: 'result', phase: msg.type, error: err.message });
  }
});

if (process.send) process.send({ type: 'ready', task: TASK, pid: process.pid });

// Keep the process alive until the parent kills it.
setInterval(() => {}, 60 * 1000).unref();
