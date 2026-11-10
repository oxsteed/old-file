// F-11 regression: CI never hands the admin login to pull_request runs, and
// every third-party action is pinned to a full commit SHA.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workflowsDir = path.resolve(here, '../../.github/workflows');
const workflows = fs.readdirSync(workflowsDir)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => ({ name: f, text: fs.readFileSync(path.join(workflowsDir, f), 'utf8') }));

function jobBlocks(text) {
  const jobsAt = text.indexOf('\njobs:\n');
  const body = text.slice(jobsAt + 7);
  const blocks = {};
  let current = null;
  for (const line of body.split('\n')) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) { current = m[1]; blocks[current] = ''; continue; }
    if (current) blocks[current] += `${line}\n`;
  }
  return blocks;
}

test('every action is pinned to a commit SHA', () => {
  for (const { name, text } of workflows) {
    for (const m of text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)) {
      const ref = m[1];
      if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
      assert.match(ref, /@[0-9a-f]{40}$/, `${name}: ${ref} must be pinned by SHA`);
    }
  }
});

test('admin E2E credentials live only in the push/dispatch-only environment job', () => {
  const ci = workflows.find((w) => w.name === 'ci.yml');
  assert.ok(ci, 'ci.yml present');
  const blocks = jobBlocks(ci.text);
  for (const [job, body] of Object.entries(blocks)) {
    if (!/OXSTEED_E2E_/.test(body)) continue;
    assert.equal(job, 'admin-authenticated', `${job} must not receive OXSTEED_E2E_* secrets`);
    assert.match(body, /^\s{4}if:\s*github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'\s*$/m);
    assert.match(body, /^\s{4}environment:\s*\S+/m);
  }
  assert.ok(blocks['admin-authenticated'], 'admin-authenticated job exists');
});

test('the live CI database URL is withheld from pull_request runs', () => {
  for (const { name, text } of workflows) {
    for (const m of text.matchAll(/^.*secrets\.CI_DATABASE_URL.*$/gm)) {
      assert.match(m[0], /github\.event_name != 'pull_request' &&/, `${name}: CI_DATABASE_URL must be gated`);
    }
  }
});
