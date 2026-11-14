import test from 'node:test';
import assert from 'node:assert/strict';
import { selectOpenJobs } from './deliveryDriverJobs.js';

const USER_ID = 'driver-1';
const OTHER_ID = 'customer-9';

function postedJob(overrides = {}) {
  return {
    id: 1,
    status: 'posted',
    marketplace_available: true,
    customer_user_id: OTHER_ID,
    ...overrides,
  };
}

test('offline driver sees no open jobs', () => {
  const jobs = [postedJob()];
  // false, null, and undefined all mean offline: profiles created before
  // the availability flag existed carry no value.
  for (const available of [false, null, undefined]) {
    assert.deepEqual(
      selectOpenJobs(jobs, { helperMode: true, available, userId: USER_ID }),
      [],
    );
  }
});

test('online helper sees posted, marketplace-available jobs from other customers', () => {
  const jobs = [
    postedJob({ id: 1 }),
    postedJob({ id: 2, status: 'assigned' }),
    postedJob({ id: 3, marketplace_available: false }),
    postedJob({ id: 4, customer_user_id: USER_ID }),
  ];
  assert.deepEqual(
    selectOpenJobs(jobs, { helperMode: true, available: true, userId: USER_ID })
      .map((job) => job.id),
    [1],
  );
});

test('non-helper sees no open jobs even when online', () => {
  assert.deepEqual(
    selectOpenJobs([postedJob()], { helperMode: false, available: true, userId: USER_ID }),
    [],
  );
});
