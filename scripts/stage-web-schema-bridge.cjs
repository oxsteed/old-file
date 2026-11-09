'use strict';

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const plan = require('../deploy/web-schema-bridge.json');

const dir = 'server/migrations';
const staged = path.join(__dirname, '../reviewed-migrations');

function stage() {
  if (plan.version !== 1 || !/^[a-f0-9]{40}$/.test(plan.baseCommit)
      || !/^ghcr\.io\/oxsteed\/old-file-web@sha256:[a-f0-9]{64}$/.test(plan.baseImage)) {
    throw new Error('Schema bridge requires a pinned serving release');
  }
  const changes = execFileSync('git', ['diff', '--name-status', '--no-renames', plan.baseCommit,
    'HEAD', '--', dir], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
  const entries = Object.entries(plan.migrations);
  const expected = entries.map(([file]) => `A\t${dir}/${file}`).sort();
  if (!expected.length || JSON.stringify(changes) !== JSON.stringify(expected)) {
    throw new Error('The candidate migration delta does not match the reviewed schema bridge plan');
  }
  const sources = entries.map(([file, hash]) => {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(file)) throw new Error('Invalid reviewed migration name');
    const sql = fs.readFileSync(path.join(__dirname, '..', dir, file));
    if (createHash('sha256').update(sql).digest('hex') !== hash) {
      throw new Error(`Reviewed migration source changed: ${file}`);
    }
    return [file, sql];
  });
  fs.mkdirSync(staged);
  for (const [file, sql] of sources) fs.writeFileSync(path.join(staged, file), sql, { flag: 'wx' });
}

stage();
