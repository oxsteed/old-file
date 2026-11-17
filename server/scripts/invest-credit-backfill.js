#!/usr/bin/env node
'use strict';

/**
 * Backfill Credit lots for pre-existing wallet balances.
 *   node scripts/invest-credit-backfill.js --dry-run            counts only
 *   node scripts/invest-credit-backfill.js --apply [--batch 500]
 * Prints counts only (no personal identifiers).
 *
 * Rule: provably completed top-ups become `purchased` settled lots; every
 * other cent becomes an `unknown` lot (ineligible). Never claim a balance
 * is eligible that the records cannot prove.
 */

const args = process.argv.slice(2);
const mode = args.includes('--apply') ? 'apply' : 'dry_run';
const num = (flag) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : null; };

(async () => {
  const { runInvestCreditBackfill } = require('../services/invest/backfill');
  const pool = require('../db');
  try {
    const run = await runInvestCreditBackfill({ mode, batchSize: num('--batch') || 500 });
    process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`invest credit backfill failed: ${e.message}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
