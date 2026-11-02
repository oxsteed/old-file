'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Only a reviewed bridge image contains this immutable manifest. Normal
// releases still reject every migration absent from their own SQL catalog.
function loadCompatibility(file = path.join(__dirname, '../migration-compatibility.json')) {
  if (!fs.existsSync(file)) return {};
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.version !== 1 || !manifest.migrations || Array.isArray(manifest.migrations)
      || typeof manifest.migrations !== 'object') throw new Error('Invalid migration compatibility manifest');
  for (const [name, checksum] of Object.entries(manifest.migrations)) {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name) || !/^[a-f0-9]{64}$/.test(checksum)) {
      throw new Error('Invalid migration compatibility entry');
    }
  }
  return manifest.migrations;
}

function filterReviewedFutureMigrations(rows, expected, approved = loadCompatibility()) {
  const required = new Set(expected);
  const names = new Set();
  // Do not let filtering hide duplicate or incomplete migration metadata.
  for (const row of rows) {
    if (names.has(row.filename)) return rows;
    names.add(row.filename);
  }
  return rows.filter(row => required.has(row.filename)
    || !Object.hasOwn(approved, row.filename)
    || row.status !== 'applied'
    || row.checksum !== approved[row.filename]);
}

module.exports = { loadCompatibility, filterReviewedFutureMigrations };
