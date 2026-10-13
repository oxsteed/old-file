// Parity: the client schema (src/shared/jobSchema.js) and the server copy
// (server/validation/jobSchema.js) must accept, reject, normalize and diff
// every input identically, or the UI and API disagree about valid jobs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as client from '../src/shared/jobSchema.js';

const require = createRequire(import.meta.url);
const server = require('../../server/validation/jobSchema.js');
const NOW = Date.parse('2026-10-12T12:00:00Z');

test('rules, field lists and limits are identical', () => {
  assert.deepEqual(client.JOB_FIELD_RULES, server.JOB_FIELD_RULES);
  assert.deepEqual([...client.EDITABLE_FIELDS], [...server.EDITABLE_FIELDS]);
  assert.deepEqual([...client.MATERIAL_FIELDS], [...server.MATERIAL_FIELDS]);
  assert.deepEqual([...client.LOCKED_AFTER_ACCEPTANCE], [...server.LOCKED_AFTER_ACCEPTANCE]);
  assert.equal(client.MAX_BUDGET_CENTS, server.MAX_BUDGET_CENTS);
});

const current = {
  title: 'Replace the broken fence panel', description: 'x'.repeat(60), budget_type: 'fixed',
  budget_min_cents: 20000, budget_max_cents: 20000, location_city: 'Austin', location_country: 'US',
  location_lat: 30.2, location_lng: -97.7, scheduled_start_at: null, scheduled_precision: null, urgency: 'asap',
};
const inputs = [
  {}, { title: null }, { title: 'short' }, { title: 'x'.repeat(300) }, { description: 'Long enough? '.repeat(5) },
  { budget_type: 'range', budget_min_cents: 50000, budget_max_cents: 100 }, { budget_min_cents: -1 },
  { budget_min_cents: 1e12 }, { budget_min_cents: '12.5' }, { budget: '250' }, { budget_min: '', budget_max: '300' },
  { budget_type: 'open', budget_min_cents: 500 }, { urgency: 'whenever' }, { priority: 'urgent' }, { priority: 'normal' },
  { scheduled_date: '2026-10-20' }, { scheduled_date: '2026-10-20', scheduled_time: '14:30' }, { scheduled_date: '', scheduled_time: '' },
  { scheduled_start_at: '2020-01-01T00:00:00Z' }, { scheduled_start_at: 'not a date' }, { location_lat: 30 },
  { location_lat: 30, location_lng: -97 }, { location_lat: 120, location_lng: 0 }, { location_lat: null, location_lng: null },
  { requirements: '[{"type":"license"}]' }, { required_skills: Array.from({ length: 25 }, (_, i) => ({ id: i })) },
  { category: 'Plumbing' }, { status: 'completed', client_id: 'x' }, { notes: '  trimmed  ' }, { location_city: '' },
];

test('normalize, validate and diff agree on every fixture in both modes', () => {
  for (const mode of ['merge', 'legacy']) {
    for (const input of inputs) {
      const a = client.normalizeJobInput(input, { mode, current });
      const b = server.normalizeJobInput(input, { mode, current });
      assert.deepEqual(a, b, `normalize ${mode} ${JSON.stringify(input)}`);
      for (const validateMode of ['edit', 'create']) {
        assert.deepEqual(
          client.validateJobFields(a.patch, { mode: validateMode, current, now: NOW }),
          server.validateJobFields(b.patch, { mode: validateMode, current, now: NOW }),
          `validate ${mode}/${validateMode} ${JSON.stringify(input)}`,
        );
      }
      const changes = client.diffJobFields(current, a.patch);
      assert.deepEqual(changes, server.diffJobFields(current, b.patch));
      assert.equal(client.isMaterialChange(changes), server.isMaterialChange(changes));
    }
  }
});

test('error values are stable codes', () => {
  const errors = client.validateJobFields({ title: 'short', budget_min_cents: -1, location_lat: 1 }, { mode: 'edit', current, now: NOW });
  assert.deepEqual(errors, { title: 'too_short', budget_min_cents: 'budget_negative', location_lat: 'coordinates_pair' });
});
