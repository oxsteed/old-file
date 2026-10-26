#!/usr/bin/env node
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const MIGRATION_DIRS = ['server/migrations/', 'server/migrations-clickhouse/'];
const sqlFile = file => MIGRATION_DIRS.some(dir => file.startsWith(dir)) && file.endsWith('.sql');

function violations(before, after) {
  const errors = [];
  for (const [name, contents] of before) {
    if (after.get(name) !== contents) errors.push(`Existing migration changed or removed: ${name}`);
  }
  for (const dir of MIGRATION_DIRS) {
    const existing = [...before.keys()].filter(file => file.startsWith(dir)).sort();
    const last = existing.at(-1);
    const prefixes = new Set(existing.map(file => file.slice(dir.length).match(/^[A-Z]?\d+/)?.[0]));
    for (const name of after.keys()) {
      if (!name.startsWith(dir) || before.has(name)) continue;
      const prefix = name.slice(dir.length).match(/^[A-Z]?\d+/)?.[0];
      if (!prefix || prefixes.has(prefix)) errors.push(`New migration needs an unused numeric prefix: ${name}`);
      if (last && name <= last) errors.push(`New migration must sort after ${last}: ${name}`);
      prefixes.add(prefix);
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
  const errors = violations(snapshot(base), snapshot(head));
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('Migration history is immutable; new filenames append in runner order.');
}
module.exports = { violations };
