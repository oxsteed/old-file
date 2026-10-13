import test from 'node:test';
import assert from 'node:assert/strict';
import { safeHttpUrl } from '../src/utils/safeHref.js';

test('safeHttpUrl keeps http(s) and drops dangerous schemes', () => {
  assert.equal(safeHttpUrl('https://cdn.example.com/a.pdf'), 'https://cdn.example.com/a.pdf');
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl(' JaVaScRiPt:alert(1)'), null);
  assert.equal(safeHttpUrl('data:text/html,<script>1</script>'), null);
  assert.equal(safeHttpUrl('//evil.example.com/x'), null);
  assert.equal(safeHttpUrl('https://user:pw@evil.example.com/'), null);
  assert.equal(safeHttpUrl(null), null);
});
