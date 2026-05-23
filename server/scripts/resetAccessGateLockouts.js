#!/usr/bin/env node
/**
 * Emergency CLI lockout reset.
 *
 * Usage:
 *   node server/scripts/resetAccessGateLockouts.js                # interactive
 *   node server/scripts/resetAccessGateLockouts.js --list         # list active
 *   node server/scripts/resetAccessGateLockouts.js --lift <id>    # lift one
 *   node server/scripts/resetAccessGateLockouts.js --lift-all     # nuke all
 *
 * Requires the same DATABASE_URL the server uses. Designed for the case
 * where every super-admin has locked themselves out of /admin/login and
 * cannot reach the in-app "Lift" button.
 *
 * Every lift is written to the lockout row's audit columns with
 * lift_source = 'cli' so the trail survives.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const readline = require('readline');
const rateLimit = require('../services/accessGateRateLimitService');

function arg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? true;
}

async function listActive() {
  const items = await rateLimit.listActiveLockouts({ limit: 500 });
  if (!items.length) {
    console.log('No active lockouts.');
    return items;
  }
  console.log(`Active lockouts (${items.length}):`);
  console.log('  ID  | IP                    | Name (claimed)          | Fails | Locked until');
  console.log('  ----+-----------------------+-------------------------+-------+----------------------');
  for (const row of items) {
    const id = String(row.id).padEnd(4);
    const ip = String(row.ip).padEnd(21);
    const name = String(row.displayName || row.normalizedName).slice(0, 23).padEnd(23);
    const fails = String(row.failCount).padEnd(5);
    const until = new Date(row.lockedUntil).toISOString();
    console.log(`  ${id}| ${ip} | ${name} | ${fails} | ${until}`);
  }
  return items;
}

async function liftOne(id, reason = 'CLI emergency lift') {
  const lifted = await rateLimit.liftLockout({
    lockoutId: Number(id),
    byUserId: null,
    reason,
    source: 'cli',
  });
  if (!lifted) {
    console.error(`Lockout ${id} not found or already lifted.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Lifted lockout ${id} (ip=${lifted.ip}, name=${lifted.normalizedName}).`);
}

async function liftAll(reason) {
  const n = await rateLimit.liftAllActiveLockouts({ byUserId: null, reason, source: 'cli' });
  console.log(`Lifted ${n} active lockout${n === 1 ? '' : 's'}.`);
}

async function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

async function interactive() {
  const items = await listActive();
  if (!items.length) return;
  const answer = (await prompt('\nLift which ID? (number, "all", or blank to cancel) ')).trim();
  if (!answer) {
    console.log('Cancelled.');
    return;
  }
  const reason = (await prompt('Reason (optional): ')).trim() || 'CLI emergency lift';
  if (answer.toLowerCase() === 'all') {
    await liftAll(reason);
  } else if (/^\d+$/.test(answer)) {
    await liftOne(answer, reason);
  } else {
    console.error('Invalid input.');
    process.exitCode = 1;
  }
}

(async () => {
  try {
    if (arg('--list')) {
      await listActive();
    } else if (arg('--lift-all')) {
      await liftAll('CLI bulk lift');
    } else if (arg('--lift')) {
      const id = arg('--lift');
      if (id === true) {
        console.error('Usage: --lift <id>');
        process.exit(1);
      }
      await liftOne(id);
    } else {
      await interactive();
    }
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    // pg pool keeps process alive; exit cleanly
    setTimeout(() => process.exit(process.exitCode || 0), 200);
  }
})();
