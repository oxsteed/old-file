'use strict';

// Review P1-344 / P2-573 / P3-790 / P3-869 / P3-871 / P3-872: production runs
// only the API process unless a dedicated worker (node workerMain.js) is
// deployed. DEDICATED_WORKER_PROCESS=true declares that the worker runs, so the
// API skips the scheduled workers and may queue async payment captures.
// Unset (the default) means the API runs everything itself.
function dedicatedWorkerProcess() {
  return String(process.env.DEDICATED_WORKER_PROCESS || '').trim().toLowerCase() === 'true';
}

module.exports = { dedicatedWorkerProcess };
