'use strict';

/**
 * V2-P1-06 — process-state inventory gate.
 *
 * Fails CI when a mutated module-scope Map/Set (or contract TTL cache) is
 * found in the server source without a matching classification entry in
 * utils/processStateRegistry.js, and when a registry entry no longer
 * matches any declaration in source (stale entry).
 *
 * Unmutated declarations (immutable lookup constants) are auto-classified
 * as constants and need no entry.
 */

const fs = require('fs');
const path = require('path');

const { getProcessStateRegistry, CLASSIFICATIONS } = require('../utils/processState');
require('../utils/processStateRegistry');

const SERVER_ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = [
  'controllers', 'services', 'middleware', 'utils', 'modules',
  'bootstrap', 'realtime', 'routes', 'jobs',
];
const SCAN_FILES = ['workerMain.js', 'migrate.js'];
const SKIP_DIRS = new Set(['node_modules', '__tests__', '__mocks__']);

// Module-scope declaration: starts at column 0.
const DECL_RE = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+(?:Map|Set)\s*\(|createTtlCache\s*\()/;

function mutationRe(name) {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\.\\s*(?:set|add|delete|clear)\\s*\\(`);
}

function scanServer() {
  const found = []; // { file, name, mutated }
  const visit = (absPath, relPath) => {
    const src = fs.readFileSync(absPath, 'utf8');
    const lines = src.split('\n');
    for (const line of lines) {
      const m = DECL_RE.exec(line);
      if (!m) continue;
      const name = m[1];
      found.push({ file: relPath, name, mutated: mutationRe(name).test(src) });
    }
  };
  for (const dir of SCAN_DIRS) {
    const abs = path.join(SERVER_ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    const stack = [abs];
    while (stack.length) {
      const cur = stack.pop();
      for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) stack.push(path.join(cur, entry.name));
        } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
          const absPath = path.join(cur, entry.name);
          visit(absPath, path.relative(SERVER_ROOT, absPath));
        }
      }
    }
  }
  for (const f of SCAN_FILES) {
    const absPath = path.join(SERVER_ROOT, f);
    if (fs.existsSync(absPath)) visit(absPath, f);
  }
  return found;
}

describe('process-state inventory (V2-P1-06)', () => {
  let found;
  let registry;

  beforeAll(() => {
    found = scanServer();
    registry = getProcessStateRegistry();
  });

  test('every mutated module-scope Map/Set/TTL-cache is registered with a classification', () => {
    const missing = found
      .filter((f) => f.mutated)
      .filter((f) => !registry.some((e) => e.file === f.file && e.name === f.name))
      .map((f) => `${f.file}#${f.name}`);
    expect(missing).toEqual([]);
  });

  test('every registry entry matches a real declaration in source (no stale entries)', () => {
    const stale = registry
      .filter((e) => !found.some((f) => f.file === e.file && f.name === e.name))
      .map((e) => `${e.file}#${e.name}`);
    expect(stale).toEqual([]);
  });

  test('registry entries carry a valid classification, shared target, and rationale', () => {
    const validClassifications = new Set(Object.values(CLASSIFICATIONS));
    for (const e of getProcessStateRegistry()) {
      expect(validClassifications.has(e.classification)).toBe(true);
      expect(['redis', 'postgres', 'none']).toContain(e.shared);
      expect(typeof e.rationale).toBe('string');
      expect(e.rationale.trim().length).toBeGreaterThan(0);
    }
  });

  test('no authoritative lease/throttle/idempotency state remains in-process', () => {
    const forbidden = getProcessStateRegistry().filter(
      (e) =>
        ['lease', 'throttle', 'idempotency'].includes(e.classification) &&
        e.shared === 'none' &&
        e.file !== 'utils/processState.js'
    );
    // utils/processState.js#memoryFences is the documented single-process
    // fallback for the fencing helpers; everything else in these classes
    // must be Redis/PostgreSQL-backed.
    expect(forbidden.map((e) => `${e.file}#${e.name}`)).toEqual([]);
  });

  test('inventory is non-trivial: the scan actually finds stateful declarations', () => {
    expect(found.filter((f) => f.mutated).length).toBeGreaterThan(10);
  });
});
