#!/usr/bin/env node
'use strict';

/**
 * Progressive access legacy backfill.
 *   node scripts/access-backfill.js --dry-run            counts only
 *   node scripts/access-backfill.js --apply [--batch 500]
 *   node scripts/access-backfill.js --apply --resume <runId>
 * Prints counts only (no personal identifiers).
 */

const args = process.argv.slice(2);
const mode = args.includes('--apply') ? 'apply' : 'dry_run';
const num = (flag) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : null; };

(async () => {
  const { runBackfill } = require('../services/access/backfill');
  const pool = require('../db');
  try {
    const run = await runBackfill({ mode, batchSize: num('--batch') || 500, resumeRunId: num('--resume') });
    process.stdout.write(`${JSON.stringify({ runId: run.id, mode: run.mode, status: run.status, counts: run.counts }, null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`backfill failed: ${e.message}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
