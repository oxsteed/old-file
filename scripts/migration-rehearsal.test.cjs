'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rehearseMigrations, parseArgs, listMigrations, buildVerifySql } = require('./migration-rehearsal.cjs');

test('lists migration files in sorted order', () => {
  const files = listMigrations();
  assert.ok(files.length > 600, `expected 600+ migrations, got ${files.length}`);
  assert.ok(files.every((f) => f.endsWith('.sql')));
  const sorted = [...files].sort();
  assert.deepEqual(files, sorted);
  assert.ok(files.some((f) => f.startsWith('601_')), 'new guard migrations are listed');
});

test('parseArgs handles from/keep/timeout-ms/help', () => {
  assert.deepEqual(parseArgs(['--from', '590', '--keep']), { from: '590', keep: true, timeoutMs: 600000 });
  assert.deepEqual(parseArgs([]), { from: null, keep: false, timeoutMs: 600000 });
  assert.equal(parseArgs(['--timeout-ms', '5000']).timeoutMs, 5000);
  assert.equal(parseArgs(['--help']).help, true);
});

test('buildVerifySql covers all five new guard triggers and legacy value scans', () => {
  const sql = buildVerifySql();
  for (const trigger of [
    'payout_transaction_state_integrity_guard',
    'booking_request_state_integrity_guard',
    'marketplace_order_state_integrity_guard',
    'delivery_payment_state_integrity_guard',
    'purchase_order_state_integrity_guard',
  ]) {
    assert.ok(sql.includes(trigger), `missing trigger check for ${trigger}`);
  }
  assert.ok(sql.includes('FROM payout_transactions'));
  assert.ok(sql.includes('FROM booking_requests'));
  assert.ok(sql.includes('FROM marketplace_orders'));
  assert.ok(sql.includes('FROM delivery_payments'));
  assert.ok(sql.includes('FROM purchase_orders'));
});

function fakeExec(responses) {
  const calls = [];
  return {
    calls,
    impl: (command, args, options, cb) => {
      calls.push({ command, args, options });
      const key = `${command} ${args[0] || ''}`;
      const responder = responses.find(([pattern]) => key === pattern.trim())
        || responses.find(([pattern]) => key.startsWith(pattern));
      if (!responder) return cb(new Error(`unexpected call: ${key}`));
      const [, handler] = responder;
      handler(cb, { command, args, options });
    },
  };
}

test('returns exitCode 2 when docker is unavailable and no REHEARSAL_DATABASE_URL', async () => {
  const fake = fakeExec([['docker info', (cb) => {
    const err = new Error('Cannot connect to the Docker daemon');
    cb(err, '', 'Cannot connect to the Docker daemon');
  }]]);
  const logs = [];
  const report = await rehearseMigrations({
    env: {},
    argv: [],
    execImpl: fake.impl,
    log: (t) => logs.push(t),
    now: () => 0,
  });
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 2);
  assert.equal(report.reason, 'docker-unavailable');
});

test('fresh rehearsal applies all migrations then verifies guards', async () => {
  const total = listMigrations().length;
  const verifyOutput = [
    'payout_transaction_state_integrity_guard,1',
    'booking_request_state_integrity_guard,1',
    'marketplace_order_state_integrity_guard,1',
    'delivery_payment_state_integrity_guard,1',
    'purchase_order_state_integrity_guard,1',
    'delivery_state_integrity_guard,1',
    'food_order_terminal_integrity_guard,1',
    'support_ticket_terminal_integrity_guard,1',
    'payout_transactions,0',
    'booking_requests,0',
    'marketplace_orders,0',
    'delivery_payments,0',
    'purchase_orders,0',
  ].join('\n');
  const fake = fakeExec([
    ['docker info', (cb) => cb(null, 'Server: Docker', '')],
    ['docker run', (cb) => cb(null, 'container-abc123\n', '')],
    ['docker port', (cb) => cb(null, '127.0.0.1:55440\n', '')],
    ['docker exec', (cb) => cb(null, '/var/run/postgresql:5432 - accepting connections\n', '')],
    ['node ', (cb) => cb(null, 'migrations done\n', '')],
    ['node -e', (cb) => cb(null, `${verifyOutput}\n`, '')],
    ['docker rm', (cb) => cb(null, 'container-abc123\n', '')],
  ]);
  const logs = [];
  let clock = 0;
  const report = await rehearseMigrations({
    env: {},
    argv: [],
    execImpl: fake.impl,
    log: (t) => logs.push(t),
    now: () => clock,
  });
  assert.equal(report.ok, true);
  assert.equal(report.mode, 'fresh');
  assert.equal(report.migrationsApplied, total);
  assert.deepEqual(report.missingTriggers, []);
  assert.deepEqual(report.unexpectedLegacyValues, []);
  const nodeCalls = fake.calls.filter((c) => c.command === 'node' && c.args[0] !== '-e');
  assert.equal(nodeCalls.length, 2, 'one bounded migration run, one checksum replay');
  assert.deepEqual(nodeCalls[0].args.slice(1), ['--through', listMigrations().at(-1)]);
  assert.equal(nodeCalls[1].args.length, 1);
  const dockerRun = fake.calls.find(c => c.command === 'docker' && c.args[0] === 'run');
  assert.ok(dockerRun.args.includes('127.0.0.1::5432'));
  assert.ok(dockerRun.args.includes('postgis/postgis:16-3.4-alpine'));
  assert.match(nodeCalls[0].options.env.DATABASE_URL, /127\.0\.0\.1:55440/);
  assert.ok(fake.calls.some((c) => c.command === 'docker' && c.args[0] === 'rm'), 'container cleaned up');
});

test('catch-up rehearsal splits baseline and catch-up phases', async () => {
  const files = listMigrations();
  const splitFile = files.find((f) => f.startsWith('590_'));
  assert.ok(splitFile, 'expected a 590 migration for the split test');
  const phases = [];
  const fake = fakeExec([
    ['docker info', (cb) => cb(null, 'ok', '')],
    ['docker run', (cb) => cb(null, 'container-x\n', '')],
    ['docker port', (cb) => cb(null, '127.0.0.1:55440\n', '')],
    ['docker exec', (cb) => cb(null, 'accepting connections\n', '')],
    ['node ', (cb, call) => {
      phases.push(call.args.slice(1));
      cb(null, 'ok\n', '');
    }],
    ['node -e', (cb) => cb(null, 'payout_transaction_state_integrity_guard,1\nbooking_request_state_integrity_guard,1\nmarketplace_order_state_integrity_guard,1\ndelivery_payment_state_integrity_guard,1\npurchase_order_state_integrity_guard,1\ndelivery_state_integrity_guard,1\nfood_order_terminal_integrity_guard,1\nsupport_ticket_terminal_integrity_guard,1\npayout_transactions,0\n', '')],
    ['docker rm', (cb) => cb(null, 'container-x\n', '')],
  ]);
  const report = await rehearseMigrations({
    env: {},
    argv: ['--from', '590'],
    execImpl: fake.impl,
    log: () => {},
    now: () => 0,
  });
  assert.equal(report.ok, true);
  assert.ok(report.mode.startsWith('catch-up'), `mode was ${report.mode}`);
  assert.equal(report.migrationsApplied, files.length);
  const splitIndex = files.indexOf(splitFile);
  assert.deepEqual(phases, [
    ['--through', files[splitIndex - 1]], ['--through', files.at(-1)], [],
  ]);
});

test('flags missing triggers and unexpected legacy values', async () => {
  const fake = fakeExec([
    ['docker info', (cb) => cb(null, 'ok', '')],
    ['docker run', (cb) => cb(null, 'container-x\n', '')],
    ['docker port', (cb) => cb(null, '127.0.0.1:55440\n', '')],
    ['docker exec', (cb) => cb(null, 'accepting connections\n', '')],
    ['node ', (cb) => cb(null, 'ok\n', '')],
    ['node -e', (cb) => cb(null, 'booking_requests,3\n', '')],
    ['docker rm', (cb) => cb(null, 'container-x\n', '')],
  ]);
  const report = await rehearseMigrations({
    env: {},
    argv: [],
    execImpl: fake.impl,
    log: () => {},
    now: () => 0,
  });
  assert.equal(report.ok, false);
  assert.ok(report.missingTriggers.includes('payout_transaction_state_integrity_guard'));
  assert.ok(report.unexpectedLegacyValues.some((u) => u.startsWith('booking_requests: 3')));
});

test('--keep leaves the rehearsal container running', async () => {
  const fake = fakeExec([
    ['docker info', (cb) => cb(null, 'ok', '')],
    ['docker run', (cb) => cb(null, 'container-keep\n', '')],
    ['docker port', (cb) => cb(null, '127.0.0.1:55440\n', '')],
    ['docker exec', (cb) => cb(null, 'accepting connections\n', '')],
    ['node ', (cb) => cb(null, 'ok\n', '')],
    ['node -e', (cb) => cb(null, 'payout_transaction_state_integrity_guard,1\nbooking_request_state_integrity_guard,1\nmarketplace_order_state_integrity_guard,1\ndelivery_payment_state_integrity_guard,1\npurchase_order_state_integrity_guard,1\ndelivery_state_integrity_guard,1\nfood_order_terminal_integrity_guard,1\nsupport_ticket_terminal_integrity_guard,1\npayout_transactions,0\nbooking_requests,0\nmarketplace_orders,0\ndelivery_payments,0\npurchase_orders,0\n', '')],
  ]);
  const logs = [];
  const report = await rehearseMigrations({
    env: {},
    argv: ['--keep'],
    execImpl: fake.impl,
    log: (t) => logs.push(t),
    now: () => 0,
  });
  assert.equal(report.ok, true);
  assert.ok(!fake.calls.some((c) => c.args[0] === 'rm'), 'container must not be removed with --keep');
  assert.ok(logs.some((l) => l.includes('kept for inspection')));
});

const guardRows = [
  'payout_transaction_state_integrity_guard,1',
  'booking_request_state_integrity_guard,1',
  'marketplace_order_state_integrity_guard,1',
  'delivery_payment_state_integrity_guard,1',
  'purchase_order_state_integrity_guard,1',
  'delivery_state_integrity_guard,1',
  'food_order_terminal_integrity_guard,1',
  'support_ticket_terminal_integrity_guard,1',
].join('\n');

for (const [name, output, expectedMissing, expectedUnexpected] of [
  ['a named but disabled guard', guardRows.replace('payout_transaction_state_integrity_guard,1', 'payout_transaction_state_integrity_guard,0'), ['payout_transaction_state_integrity_guard'], []],
  ['unexpected legacy states with all guards present', `${guardRows}\nbooking_requests,2`, [], ['booking_requests: 2 rows outside the documented enum']],
]) {
  test(`fails verification for ${name}`, async () => {
    const fake = fakeExec([
      ['node ', cb => cb(null, 'ok', '')],
      ['node -e', cb => cb(null, output, '')],
    ]);
    const report = await rehearseMigrations({
      env: { REHEARSAL_DATABASE_URL: 'postgresql://synthetic@127.0.0.1:55440/rehearsal' },
      argv: [], execImpl: fake.impl, log: () => {}, now: () => 0,
    });
    assert.equal(report.ok, false);
    assert.deepEqual(report.missingTriggers, expectedMissing);
    assert.deepEqual(report.unexpectedLegacyValues, expectedUnexpected);
    assert.ok(fake.calls.every(call => call.command === 'node'), 'explicit target does not create or remove a container');
  });
}

test('migration failure rejects and removes its own disposable container', async () => {
  const fake = fakeExec([
    ['docker info', cb => cb(null, 'ok', '')],
    ['docker run', cb => cb(null, 'synthetic-container\n', '')],
    ['docker port', cb => cb(null, '127.0.0.1:55440\n', '')],
    ['docker exec', cb => cb(null, 'ready', '')],
    ['node ', cb => cb(new Error('migration rejected'), '', 'migration rejected')],
    ['docker rm', cb => cb(null, 'removed', '')],
  ]);
  await assert.rejects(rehearseMigrations({ env: {}, argv: [], execImpl: fake.impl, log: () => {}, now: () => 0 }), /failed during fresh rehearsal/);
  assert.deepEqual(fake.calls.at(-1).args, ['rm', '-f', 'synthetic-container']);
});
