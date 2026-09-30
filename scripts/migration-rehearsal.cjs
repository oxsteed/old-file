'use strict';

/**
 * Migration rehearsal: apply every server migration against a disposable
 * production-like PostgreSQL and verify the run, without touching the real
 * database.
 *
 * Usage:
 *   node scripts/migration-rehearsal.cjs [--from <n>] [--keep] [--timeout-ms <ms>]
 *
 * Modes:
 *   fresh (default)   start an empty postgres:16-alpine container, run the full
 *                     migration chain, verify guard triggers exist.
 *   catch-up          --from <n> applies migrations 001..n first, then the rest,
 *                     simulating a production database catching up after lag.
 *
 * Set REHEARSAL_DATABASE_URL to rehearse against an existing database instead
 * of starting a container (the script never writes outside the target DB).
 * --keep leaves the container running for manual inspection.
 *
 * Exit codes: 0 all migrations applied and verified, 1 rehearsal failed,
 * 2 environment unusable (no docker and no REHEARSAL_DATABASE_URL).
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'server', 'migrations');

function listMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function parseArgs(argv) {
  const args = { from: null, keep: false, timeoutMs: 10 * 60 * 1000 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--from' && argv[i + 1]) args.from = argv[i + 1];
    else if (argv[i] === '--keep') args.keep = true;
    else if (argv[i] === '--timeout-ms' && argv[i + 1]) args.timeoutMs = Number(argv[i + 1]);
    else if (argv[i] === '--help') args.help = true;
  }
  return args;
}

function execAsync(execImpl, command, args, options) {
  return new Promise((resolve, reject) => {
    execImpl(command, args, options, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    });
  });
}

const GUARD_CHECKS = [
  { table: 'payout_transactions', trigger: 'payout_transaction_state_integrity_guard', column: 'transaction_status', known: ['initiated', 'processing', 'completed', 'failed', 'refunded'] },
  { table: 'booking_requests', trigger: 'booking_request_state_integrity_guard', column: 'status', known: ['pending', 'accepted', 'declined', 'expired', 'cancelled', 'accepted_cancelled', 'counter_proposed'] },
  { table: 'marketplace_orders', trigger: 'marketplace_order_state_integrity_guard', column: 'status', known: ['pending', 'paid', 'processing', 'completed', 'cancelled', 'refunded'] },
  { table: 'delivery_payments', trigger: 'delivery_payment_state_integrity_guard', column: 'status', known: ['pending', 'paid', 'failed', 'refunded', 'cancelled'] },
  { table: 'purchase_orders', trigger: 'purchase_order_state_integrity_guard', column: 'status', known: ['draft', 'quoted', 'approved', 'awaiting_deposit', 'deposit_collected', 'placed_with_supplier', 'in_production', 'production_complete', 'ready_for_pickup', 'in_transit', 'customs_review', 'cleared', 'warehoused', 'allocated', 'fulfilled', 'closed', 'cancelled'] },
  { table: 'delivery_jobs', trigger: 'delivery_state_integrity_guard', column: 'status', known: null },
  { table: 'food_orders', trigger: 'food_order_terminal_integrity_guard', column: 'status', known: null },
  { table: 'support_tickets', trigger: 'support_ticket_terminal_integrity_guard', column: 'status', known: null },
];

function buildVerifySql() {
  const parts = [];
  for (const check of GUARD_CHECKS) {
    if (check.trigger) {
      parts.push(
        `SELECT '${check.trigger}' AS trigger_name, COUNT(*) AS found FROM pg_trigger WHERE tgname = '${check.trigger}' AND tgenabled = 'O'`
      );
    }
    if (check.known) {
      const list = check.known.map((v) => `'${v}'`).join(',');
      parts.push(
        `SELECT '${check.table}' AS table_name, COUNT(*) AS unexpected_rows FROM ${check.table} WHERE ${check.column}::text NOT IN (${list})`
      );
    }
  }
  return parts.join(';\n') + ';';
}

async function runQuery(psqlEnv, databaseUrl, sql, execImpl) {
  const { stdout } = await execAsync(execImpl, 'psql', [databaseUrl, '-tA', '-F', ',', '-c', sql], { env: psqlEnv, timeout: 60000 });
  return stdout.trim();
}

async function rehearseMigrations({
  env = process.env,
  argv = process.argv.slice(2),
  execImpl = execFile,
  log = console.log,
  now = Date.now,
} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    log('Usage: node scripts/migration-rehearsal.cjs [--from <migration-number>] [--keep] [--timeout-ms <ms>]');
    return { ok: true, helped: true };
  }

  const files = listMigrations();
  if (!files.length) throw new Error(`No migrations found in ${MIGRATIONS_DIR}`);

  let fromIndex = 0;
  if (args.from) {
    fromIndex = files.findIndex((f) => f.startsWith(String(args.from)));
    if (fromIndex < 0) throw new Error(`Migration starting with "${args.from}" not found`);
  }
  const firstBatch = files.slice(0, fromIndex + (args.from ? 0 : files.length));
  const secondBatch = args.from ? files.slice(fromIndex) : [];
  const mode = args.from ? `catch-up from ${args.from}` : 'fresh';

  let databaseUrl = env.REHEARSAL_DATABASE_URL;
  let containerId = null;
  const startedAt = now();

  try {
    if (!databaseUrl) {
      try {
        await execAsync(execImpl, 'docker', ['info'], { timeout: 15000 });
      } catch {
        return { ok: false, exitCode: 2, reason: 'docker-unavailable', message: 'Docker is unavailable and REHEARSAL_DATABASE_URL is not set; cannot rehearse migrations.' };
      }
      const password = `rehearsal-${Math.floor(now() / 1000)}`;
      const name = `oxsteed-migration-rehearsal-${Math.floor(now() / 1000)}`;
      log(`Starting disposable postgres container ${name}...`);
      const run = await execAsync(execImpl, 'docker', [
        'run', '--rm', '-d', '--name', name,
        '-e', `POSTGRES_PASSWORD=${password}`,
        '-e', 'POSTGRES_DB=oxsteed_rehearsal',
        'postgres:16-alpine',
      ], { timeout: 120000 });
      containerId = run.stdout.trim();
      databaseUrl = `postgres://postgres:${password}@localhost:5432/oxsteed_rehearsal`;
      // Wait for readiness.
      let ready = false;
      for (let i = 0; i < 30; i += 1) {
        try {
          await execAsync(execImpl, 'docker', ['exec', containerId, 'pg_isready', '-U', 'postgres'], { timeout: 10000 });
          ready = true;
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (!ready) throw new Error('Rehearsal postgres container never became ready');
    } else {
      log('Using REHEARSAL_DATABASE_URL target.');
    }

    const migrateEnv = { ...env, DATABASE_URL: databaseUrl };
    const applied = [];
    const failures = [];

    async function applyBatch(batch, label) {
      for (const file of batch) {
        const t0 = now();
        try {
          await execAsync(execImpl, 'node', [path.join(REPO_ROOT, 'server', 'migrate.js')], { env: migrateEnv, timeout: args.timeoutMs });
          applied.push({ file, ms: now() - t0, label });
        } catch (err) {
          failures.push({ file, label, error: String((err && err.stderr) || (err && err.message) || err).slice(0, 2000) });
          throw new Error(`Migration ${file} failed during ${label} rehearsal`);
        }
      }
    }

    log(`Rehearsing ${files.length} migrations (${mode})...`);
    if (args.from) {
      log(`Phase 1: applying ${firstBatch.length} migrations up to ${args.from}...`);
      await applyBatch(firstBatch, 'baseline');
      log(`Phase 2: catch-up applying ${secondBatch.length} migrations...`);
      await applyBatch(secondBatch, 'catch-up');
    } else {
      await applyBatch(files, 'fresh');
    }

    // Post-run verification: guard triggers present and enabled, no
    // out-of-enum legacy rows in the newly guarded money tables.
    log('Verifying guard triggers and legacy value shapes...');
    const verifySql = buildVerifySql();
    const verifyOut = await runQuery(migrateEnv, databaseUrl, verifySql, execImpl);
    const missing = [];
    for (const check of GUARD_CHECKS) {
      if (check.trigger && !verifyOut.includes(check.trigger)) missing.push(check.trigger);
    }
    const unexpected = [];
    for (const line of verifyOut.split('\n')) {
      // psql -tA -F, rows look like: payout_transactions,0
      const [name, count] = line.split(',');
      if (name && count !== undefined && !name.endsWith('_guard') && Number(count) > 0) {
        unexpected.push(`${name}: ${count} rows outside the documented enum`);
      }
    }

    const durationMs = now() - startedAt;
    const report = {
      ok: missing.length === 0 && failures.length === 0,
      mode,
      migrationsApplied: applied.length,
      totalMigrations: files.length,
      durationMs,
      missingTriggers: missing,
      unexpectedLegacyValues: unexpected,
      failures,
    };

    log(`Rehearsal ${report.ok ? 'PASSED' : 'FAILED'}: ${applied.length}/${files.length} migrations in ${(durationMs / 1000).toFixed(1)}s.`);
    if (missing.length) log(`Missing triggers: ${missing.join(', ')}`);
    for (const u of unexpected) log(`Legacy data note: ${u}`);

    return report;
  } finally {
    if (containerId && !args.keep) {
      try {
        await execAsync(execImpl, 'docker', ['rm', '-f', containerId], { timeout: 30000 });
        log('Rehearsal container removed.');
      } catch (err) {
        log(`Warning: could not remove rehearsal container ${containerId}: ${err.message}`);
      }
    } else if (containerId && args.keep) {
      log(`Container kept for inspection: ${containerId}`);
    }
  }
}

if (require.main === module) {
  rehearseMigrations().then(
    (report) => process.exit(report.ok ? 0 : report.exitCode === 2 ? 2 : 1),
    (err) => { console.error(`Migration rehearsal failed: ${err.message}`); process.exit(1); },
  );
}

module.exports = { rehearseMigrations, parseArgs, listMigrations, buildVerifySql };
