import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = {
  location: {
    hostname: '127.0.0.1',
    origin: 'http://127.0.0.1:32922',
  },
};

const { resolveRealtimeBaseUrl, realtimeNamespaceUrl } = await import('../src/lib/realtime.js');

test('uses the current loopback origin for static isolated deployments', () => {
  assert.equal(resolveRealtimeBaseUrl(), 'http://127.0.0.1:32922');
  assert.equal(realtimeNamespaceUrl('chat'), 'http://127.0.0.1:32922/chat');
});

test('normalizes a namespace without changing the base origin', () => {
  assert.equal(realtimeNamespaceUrl('/support/'), 'http://127.0.0.1:32922/support');
});
