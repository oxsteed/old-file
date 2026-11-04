'use strict';

// Cost audit 2026-11-04 items 1-3: the fleet tick runs due tasks
// concurrently with per-task overlap guards, so one slow or failing task
// neither starves nor blocks the rest.

const { registerTask, tick, TASKS } = require('../jobs/customer360Upgrades');

jest.setTimeout(30000);

test('due tasks run concurrently and a failing task does not block the rest', async () => {
  const started = [];
  const finished = [];
  const before = TASKS.length;
  const slow = async () => {
    started.push('slow');
    await new Promise((r) => setTimeout(r, 300));
    finished.push('slow');
  };
  const fast = async () => {
    started.push('fast');
    finished.push('fast');
  };
  const failing = async () => {
    started.push('failing');
    throw new Error('boom');
  };
  registerTask('cost-audit-probe-slow', 0, slow);
  registerTask('cost-audit-probe-fast', 0, fast);
  registerTask('cost-audit-probe-failing', 0, failing);
  try {
    await tick();
  } finally {
    TASKS.splice(before);
  }
  // All three probes ran despite the failure, and the fast task finished
  // before the slow task: a serial loop would have finished slow first
  // (registration order) or not at all after the throw.
  expect(started).toEqual(expect.arrayContaining(['slow', 'fast', 'failing']));
  expect(finished).toEqual(expect.arrayContaining(['slow', 'fast']));
  expect(finished.indexOf('fast')).toBeLessThan(finished.indexOf('slow'));
});
