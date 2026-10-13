#!/usr/bin/env node
// Generates the server CommonJS copies of the shared client ESM modules
// (money, countries). Run after editing client/src/shared/{money,countries}.js;
// client/scripts/paymentLayers.test.mjs fails when the copies drift.
'use strict';
const fs = require('fs');
const path = require('path');

const MODULES = ['money', 'countries'];
const root = path.resolve(__dirname, '..', '..');

function toCjs(source, name) {
  const exported = [];
  const body = source.replace(/^export (const|function) (\w+)/gm, (_, kind, id) => {
    exported.push(id);
    return `${kind} ${id}`;
  });
  return `'use strict';\n// GENERATED from client/src/shared/${name}.js by server/scripts/generate-shared-cjs.cjs. Do not edit.\n${body}\nmodule.exports = { ${exported.join(', ')} };\n`;
}

function generate({ check = false } = {}) {
  let drift = false;
  for (const name of MODULES) {
    const source = fs.readFileSync(path.join(root, 'client/src/shared', `${name}.js`), 'utf8');
    const target = path.join(root, 'server/validation', `${name}.js`);
    const output = toCjs(source, name);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (current !== output) {
      drift = true;
      if (!check) fs.writeFileSync(target, output);
    }
  }
  return drift;
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const drift = generate({ check });
  if (check && drift) {
    console.error('Shared CJS copies are stale. Run: node server/scripts/generate-shared-cjs.cjs');
    process.exit(1);
  }
}

module.exports = { generate, toCjs };
