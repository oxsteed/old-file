import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaLinkRequiresLogin } from './mediaLinkGuestGate.js';

test('transactional linked-entity CTAs require login; view does not', () => {
  const base = { available: true, canonical_url: '/restaurants/1' };
  assert.equal(mediaLinkRequiresLogin({ ...base, cta: 'order' }), true);
  assert.equal(mediaLinkRequiresLogin({ ...base, cta: 'book' }), true);
  assert.equal(mediaLinkRequiresLogin({ ...base, cta: 'view' }), false);
  assert.equal(mediaLinkRequiresLogin({ ...base, cta: 'View' }), false);
  assert.equal(mediaLinkRequiresLogin({ available: false, canonical_url: '/x', cta: 'order' }), false);
});
