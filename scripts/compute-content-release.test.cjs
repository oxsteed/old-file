'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { collectFiles, computeContentRelease } = require('./compute-content-release.cjs');

test('computes a deterministic content release from the application source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxsteed-release-'));
  try {
    fs.mkdirSync(path.join(root, 'server'), { recursive: true });
    fs.mkdirSync(path.join(root, 'client'), { recursive: true });
    fs.writeFileSync(path.join(root, 'server', 'index.js'), 'server');
    fs.writeFileSync(path.join(root, 'client', 'index.html'), 'client');

    const first = computeContentRelease(root);
    assert.match(first, /^content-[0-9a-f]{16}$/);
    assert.equal(computeContentRelease(root), first);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('excludes runtime, build, dependency, and environment files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxsteed-release-'));
  try {
    fs.mkdirSync(path.join(root, 'server', 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(root, 'client', 'dist'), { recursive: true });
    fs.mkdirSync(path.join(root, 'client', 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'server', 'keep.js'), 'keep');
    fs.writeFileSync(path.join(root, 'server', '.env'), 'secret');
    fs.writeFileSync(path.join(root, 'server', '.env.test'), 'secret');
    fs.writeFileSync(path.join(root, 'server', 'runtime', 'generated.txt'), 'ignored');
    fs.writeFileSync(path.join(root, 'client', 'dist', 'bundle.js'), 'ignored');
    fs.writeFileSync(path.join(root, 'client', 'node_modules', 'pkg', 'index.js'), 'ignored');

    assert.deepEqual(collectFiles(root), ['server/keep.js']);
    const before = computeContentRelease(root);
    fs.writeFileSync(path.join(root, 'client', 'dist', 'bundle.js'), 'changed but ignored');
    fs.writeFileSync(path.join(root, 'server', '.env.test'), 'changed but ignored');
    assert.equal(computeContentRelease(root), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
