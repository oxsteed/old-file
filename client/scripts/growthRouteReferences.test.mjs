import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { routePageReferences } from './growthRouteReferences.mjs';

const pages = source => routePageReferences(ts.createSourceFile('fixture.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX));

test('instrumentation follows lazy pages through a mode route component', () => {
  const refs = pages('<Route element={<Guarded>{isStatusHost ? <StatusPage /> : <ModeHomeRoute DiscoveryPage={HomePage} DashboardPage={SmartDashboard} LoadingState={Loading} />}</Guarded>} />');
  for (const page of ['StatusPage','HomePage','SmartDashboard','ModeHomeRoute']) assert.ok(refs.has(page), page);
  assert.equal(refs.has('isStatusHost'), false);
});

test('instrumentation ignores capitalized text and string attribute values', () => {
  const refs = pages('<Route element={<PublicPage title="PrivatePage">HiddenPage</PublicPage>} />');
  assert.ok(refs.has('PublicPage'));
  assert.equal(refs.has('PrivatePage'), false);
  assert.equal(refs.has('HiddenPage'), false);
});
