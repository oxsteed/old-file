import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOperationsDesk } from '../src/pages/food/merchantOperationsDesk.js';

const managerTools = ['screens', 'hosting', 'checklists', 'inventory', 'sops', 'training', 'audits', 'hq', 'brand-hq', 'accounting', 'store-hub', 'reports', 'help'];
const displayTools = ['screens'];

test('display staff do not activate a manager tool named in the ops query', () => {
  assert.deepEqual(resolveOperationsDesk('inventory', displayTools), {
    active: 'screens',
    rewrite: true,
    nextOps: 'screens',
  });
  assert.deepEqual(resolveOperationsDesk('hq', displayTools), {
    active: 'screens',
    rewrite: true,
    nextOps: 'screens',
  });
  assert.deepEqual(resolveOperationsDesk('screens', displayTools), {
    active: 'screens',
    rewrite: false,
    nextOps: 'screens',
  });
  assert.deepEqual(resolveOperationsDesk(null, displayTools), {
    active: 'screens',
    rewrite: false,
    nextOps: 'screens',
  });
});

test('managers keep a permitted tool and an unknown ops value returns to the board', () => {
  assert.deepEqual(resolveOperationsDesk('inventory', managerTools), {
    active: 'inventory',
    rewrite: false,
    nextOps: 'inventory',
  });
  assert.deepEqual(resolveOperationsDesk('not-a-tool', managerTools), {
    active: null,
    rewrite: true,
    nextOps: null,
  });
  assert.deepEqual(resolveOperationsDesk(null, managerTools), {
    active: null,
    rewrite: false,
    nextOps: null,
  });
});
