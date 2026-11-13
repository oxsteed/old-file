#!/usr/bin/env node
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  compareMigrationFiles,
  isValidTimestampMigration,
  migrationPrefix,
} = require(path.join(__dirname, '..', 'server', 'migrationOrder.js'));

const SERVER_DIR = 'server/migrations/';
const CLICKHOUSE_DIR = 'server/migrations-clickhouse/';
const MIGRATION_DIRS = [SERVER_DIR, CLICKHOUSE_DIR];
const sqlFile = file => MIGRATION_DIRS.some(dir => file.startsWith(dir)) && file.endsWith('.sql');

// PR #699 merged two out-of-order migrations. Its push failed this check,
// and neither filename was recorded in production. Allow only the exact
// byte-preserving rename of both files from that failed baseline.
const REPAIR_BASE = 'd11ee1568168de95474eb9bc839a4b76a647b10f';
const RETIMESTAMPED = [
  ['20261109020000_stripe_chargebacks_payment_intent_index.sql',
    '20261109231751_stripe_chargebacks_payment_intent_index.sql', '5e7a6dbc1e9ad0a4a1a955a50a86339f0373320b'],
  ['20261109020100_payout_transactions_completed_at.sql',
    '20261109231752_payout_transactions_completed_at.sql', '85a2fe3faed37ce159592aab72671c2b530fd912'],
];

// server/migrations runs in NUMERIC prefix order (Q11, server/migrationOrder.js)
// and new files must use a YYYYMMDDHHMMSS_ timestamp prefix. ClickHouse
// migrations keep their own letter-prefixed text order.
function orderFor(dir) {
  if (dir === SERVER_DIR) {
    // Unprefixed names cannot be ordered; place them last so they are
    // reported as violations instead of throwing.
    return (a, b) => {
      const okA = /^\d/.test(a);
      const okB = /^\d/.test(b);
      if (okA && okB) return compareMigrationFiles(a, b);
      if (okA !== okB) return okA ? -1 : 1;
      return a < b ? -1 : a > b ? 1 : 0;
    };
  }
  return (a, b) => (a < b ? -1 : a > b ? 1 : 0);
}

function prefixOf(dir, base) {
  if (dir === SERVER_DIR) {
    try { return migrationPrefix(base).toString(); } catch { return null; }
  }
  return base.match(/^[A-Z]?\d+/)?.[0] || null;
}

function violations(before, after, baseSha) {
  if (baseSha === REPAIR_BASE && RETIMESTAMPED.every(([oldName, newName, blob]) =>
    before.get(SERVER_DIR + oldName) === blob && !after.has(SERVER_DIR + oldName)
      && !before.has(SERVER_DIR + newName) && after.get(SERVER_DIR + newName) === blob
  )) {
    before = new Map(before);
    for (const [oldName] of RETIMESTAMPED) before.delete(SERVER_DIR + oldName);
  }
  const errors = [];
  for (const [name, contents] of before) {
    if (after.get(name) !== contents) errors.push(`Existing migration changed or removed: ${name}`);
  }
  for (const dir of MIGRATION_DIRS) {
    const compare = orderFor(dir);
    const existing = [...before.keys()]
      .filter(file => file.startsWith(dir))
      .map(file => file.slice(dir.length))
      .sort(compare);
    const last = existing.at(-1);
    const prefixes = new Set(existing.map(base => prefixOf(dir, base)));
    const added = [...after.keys()]
      .filter(name => name.startsWith(dir) && !before.has(name))
      .map(name => name.slice(dir.length))
      .sort(compare);
    for (const base of added) {
      const name = dir + base;
      const prefix = prefixOf(dir, base);
      if (!prefix || prefixes.has(prefix)) errors.push(`New migration needs an unused numeric prefix: ${name}`);
      if (dir === SERVER_DIR && !isValidTimestampMigration(base)) {
        errors.push(`New migration must be named YYYYMMDDHHMMSS_name.sql (UTC timestamp): ${name}`);
      }
      if (last && compare(base, last) <= 0) errors.push(`New migration must sort after ${dir}${last}: ${name}`);
      prefixes.add(prefix);
    }
  }
  return errors;
}
// A pg_constraint guard that matches only conname can see a same-named
// constraint in another schema and silently skip adding the FK/unique/check
// in the target schema (migration 994: cash_tips_restaurant_location_fk was
// skipped in test schemas because public already had the name). New
// migrations must also match conrelid (scoped to the table, e.g.
// conrelid = 'table'::regclass or a JOIN on pg_class) or connamespace.
// Pre-existing unscoped guards are grandfathered: callers only scan files
// added after the base snapshot, never the existing tree.
function pgConstraintGuardViolations(files) {
  const errors = [];
  for (const [name, contents] of files) {
    // Strip comments so a mention in a comment cannot trip or mask the check.
    const sql = String(contents)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, ' ');
    // Check each statement that touches pg_constraint. DO blocks hold
    // several guard statements, so split their bodies on ';' too.
    const chunks = [];
    const doBlock = /DO\s+\$\$([\s\S]*?)END\s+\$\$/gi;
    let match;
    while ((match = doBlock.exec(sql))) chunks.push(...match[1].split(';'));
    chunks.push(...sql.replace(/DO\s+\$\$[\s\S]*?END\s+\$\$/gi, ' ').split(';'));
    for (const chunk of chunks) {
      if (/pg_constraint/i.test(chunk) && !/conrelid|connamespace/i.test(chunk)) {
        errors.push(`New migration ${name} has an unscoped pg_constraint guard (matches conname only): scope it with conrelid (e.g. conrelid = 'table'::regclass) or connamespace`);
        break;
      }
    }
  }
  return errors;
}
function snapshot(ref) {
  if (!/^[a-f0-9]{40}$/.test(ref)) throw new Error('A full Git commit SHA is required');
  const rows = execFileSync('git', ['ls-tree', '-r', '--format=%(objectname) %(path)', ref, '--', ...MIGRATION_DIRS], { encoding: 'utf8' }).trim().split('\n');
  return new Map(rows.map(row => [row.slice(41), row.slice(0, 40)]).filter(([file]) => sqlFile(file)));
}
if (require.main === module) {
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const base = process.argv[2] || event.pull_request?.base?.sha || event.before;
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const before = snapshot(base);
  const after = snapshot(head);
  const errors = violations(before, after, base);
  // New migrations only: scan the added files at head for unscoped
  // pg_constraint guards. Existing unscoped guards are grandfathered.
  const addedContents = new Map();
  for (const [name] of after) {
    if (!before.has(name)) addedContents.set(name, execFileSync('git', ['show', `${head}:${name}`], { encoding: 'utf8' }));
  }
  errors.push(...pgConstraintGuardViolations(addedContents));
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('Migration history is immutable; new filenames append in runner order.');
}
module.exports = { violations, pgConstraintGuardViolations };
