'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED = [
  'statementJobService.test.js', 'statementJobReclaim.test.js',
  'statementAdmin.db.test.js', 'statementInvestigation.test.js', 'adminGrantLookup.test.js',
  'statementIssuance.test.js', 'statementSettlementIssuance.test.js',
  'statementAmendment.test.js', 'statementSettlement.test.js', 'statementRecovery.test.js',
];

function assertRequiredResults(report) {
  for (const file of REQUIRED) {
    const suite = report.testResults.find((result) => path.basename(result.name) === file);
    if (!suite || suite.status !== 'passed' || suite.assertionResults.length < 2) {
      throw new Error(`Required DB suite did not execute successfully: ${file}`);
    }
    const skipped = suite.assertionResults.filter((test) => test.status !== 'passed');
    if (skipped.length) throw new Error(`Required DB suite has skipped/failed tests: ${file}`);
  }
  return REQUIRED.length;
}

if (require.main === module) {
  const count = assertRequiredResults(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
  console.log(`Verified ${count} required statement/admin DB suites with no skipped tests`);
}
module.exports = { REQUIRED, assertRequiredResults };
