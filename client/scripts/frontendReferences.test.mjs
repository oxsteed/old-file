import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import ts from 'typescript';
import { scanReferences } from './verify-frontend-references.mjs';

function scan(code) {
  const file = path.resolve('reference-fixture.jsx');
  return scanReferences([file], { target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX, types: [] }, new Map([[file, code]])).findings;
}

test('reference gate catches missing JSX icons, handler names, and shorthand values', () => {
  const findings = scan(`export function Page() {
    const click = () => Object.values(MISSING_CATALOG);
    const item = { missingValue };
    return <MissingIcon onClick={click} item={item} />;
  }`);
  assert.deepEqual(findings.map(row => row.name).sort(), ['MISSING_CATALOG', 'MissingIcon', 'missingValue'].sort());
  assert.ok(findings.every(row => row.kind === 'undefined-reference'));
});

test('reference gate catches eager dependency and memo reads before state initialization', () => {
  const findings = scan(`import { useEffect, useState, useMemo } from 'react';
    export function Page() {
      useEffect(() => { console.log(items); }, [items]);
      const total = useMemo(() => items.length, []);
      const [items] = useState([]);
      return <div>{total}</div>;
    }`);
  assert.equal(findings.length, 2);
  assert.ok(findings.every(row => row.name === 'items' && row.kind === 'read-before-initialization'));
});

test('reference gate allows properties, aliases, intrinsic JSX, browser guards and deferred captures', () => {
  assert.deepEqual(scan(`import { useEffect, useState, useRef } from 'react';
    export function Page({ data: records }) {
      const run = () => items.length;
      const storedFunction = useRef(() => items.length);
      useEffect(() => { run(); }, []);
      const [items] = useState(records);
      const { length: size } = items;
      return <div title={typeof OptionalBrowserGlobal}>{size}</div>;
    }`), []);
});

test('typeof is not an escape from a lexical initialization error', () => {
  const findings = scan(`export function Page() {
    const detected = typeof items;
    const items = [];
    return detected;
  }`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'read-before-initialization');
});
