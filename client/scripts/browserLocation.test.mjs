import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const bundle = await build({ entryPoints: ['src/utils/browserLocation.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' });

function fixture(geolocation) {
  let now = 0;
  const module = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports,
    navigator: { geolocation }, Date: { now: () => now },
  });
  return { ...module.exports, advance: ms => { now += ms; } };
}

test('concurrent refreshes share the pending request and legacy callers receive coordinates', async () => {
  const calls = [];
  const api = fixture({ getCurrentPosition: (success, failure, options) => calls.push({ success, failure, options }) });
  const first = api.getSharedBrowserLocationResult();
  const second = api.getSharedBrowserLocationResult(true);
  const legacy = api.getSharedBrowserLocation(true);
  assert.equal(first, second);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.timeout, 15000);
  calls[0].success({ coords: { latitude: 39.9, longitude: -83.8 } });
  assert.equal((await first).coords.lat, 39.9);
  assert.equal((await legacy).lng, -83.8);
  const refresh = api.getSharedBrowserLocationResult(true);
  assert.equal(calls.length, 2);
  calls[1].success({ coords: { latitude: 40, longitude: -84 } });
  await refresh;
});

test('each geolocation failure is distinguishable and a subsequent request can recover', async () => {
  for (const [code, expected] of [[1, 'permission_denied'], [2, 'position_unavailable'], [3, 'timeout'], [99, 'unknown']]) {
    let calls = 0;
    const api = fixture({ getCurrentPosition: (success, failure) => {
      calls += 1;
      if (calls === 1) failure({ code });
      else success({ coords: { latitude: 40, longitude: -84 } });
    } });
    assert.equal((await api.getSharedBrowserLocationResult()).error, expected);
    assert.equal((await api.getSharedBrowserLocationResult()).coords.lat, 40);
    assert.equal(calls, 2);
  }
});

test('synchronous browser errors settle normally and do not leave the request stuck', async () => {
  let calls = 0;
  const api = fixture({ getCurrentPosition: (success) => {
    if (++calls === 1) throw new Error('Synthetic browser failure');
    success({ coords: { latitude: 40, longitude: -84 } });
  } });
  assert.equal((await api.getSharedBrowserLocationResult()).error, 'unknown');
  assert.equal((await api.getSharedBrowserLocationResult(true)).coords.lat, 40);
  assert.equal((await fixture(undefined).getSharedBrowserLocationResult()).error, 'unsupported');
});

test('successful coordinates expire after ten minutes', async () => {
  let calls = 0;
  const api = fixture({ getCurrentPosition: success => {
    calls += 1;
    success({ coords: { latitude: 40 + calls, longitude: -84 } });
  } });
  assert.equal((await api.getSharedBrowserLocationResult()).coords.lat, 41);
  api.advance(599999);
  assert.equal((await api.getSharedBrowserLocationResult()).coords.lat, 41);
  api.advance(1);
  assert.equal((await api.getSharedBrowserLocationResult()).coords.lat, 42);
  assert.equal(calls, 2);
});
