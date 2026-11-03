'use strict';

const { readFileSync } = require('node:fs');
const { verifyMigrationSnapshot } = require('../services/webSchemaPreflight');

try {
  const snapshot = JSON.parse(readFileSync(0, 'utf8'));
  console.log(JSON.stringify(verifyMigrationSnapshot(snapshot)));
} catch (error) {
  if (error.code === 'WEB_SCHEMA_NOT_READY') {
    console.log(JSON.stringify({ ok: false, counts: error.counts }));
  } else {
    console.error('Candidate schema could not be checked.');
    process.exitCode = 1;
  }
}
