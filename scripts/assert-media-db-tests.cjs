'use strict';
const fs = require('node:fs');
const path = require('node:path');
const REQUIRED = ['mediaVisibilityDb.test.js', 'mediaDraftAttachmentsDb.test.js'];
function assertMediaResults(report) {
  for (const file of REQUIRED) {
    const suite = report.testResults?.find(result => path.basename(result.name) === file);
    if (!suite || suite.status !== 'passed' || suite.assertionResults?.length < 2
        || suite.assertionResults.some(test => test.status !== 'passed')) {
      throw new Error(`Required Media database cases did not run successfully: ${file}`);
    }
  }
  return REQUIRED.length;
}
if (require.main === module) {
  console.log(`Verified ${assertMediaResults(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')))} required Media database suites without skips`);
}
module.exports = { assertMediaResults, REQUIRED };
