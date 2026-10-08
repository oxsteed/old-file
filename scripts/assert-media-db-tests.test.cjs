const test = require('node:test');
const assert = require('node:assert/strict');
const { assertMediaResults, REQUIRED } = require('./assert-media-db-tests.cjs');
const report = () => ({ testResults: REQUIRED.map(name => ({ name, status: 'passed',
  assertionResults: [{ status: 'passed' }, { status: 'passed' }] })) });
test('requires actual successful Media database test execution', () => {
  assert.equal(assertMediaResults(report()), 2);
  const skipped = report(); skipped.testResults[1].assertionResults[0].status = 'pending';
  assert.throws(() => assertMediaResults(skipped), /did not run successfully/);
  const missing = report(); missing.testResults.pop();
  assert.throws(() => assertMediaResults(missing), /did not run successfully/);
});
