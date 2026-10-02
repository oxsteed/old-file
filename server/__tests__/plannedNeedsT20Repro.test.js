'use strict';

/**
 * Reproduction tests for audit findings T20-F01 and T20-F02.
 *
 * T20-F01: cancelAutopublish moved activating_soon back to planned but did not
 * set is_paused, so the scheduler re-promoted the need on the next run. The
 * admin's "don't auto-publish" intent was not durable.
 *
 * T20-F02: the scheduler selected publish candidates, then in the per-row
 * transaction re-checked only published_job_id under FOR UPDATE. A need
 * cancelled (or paused) after candidate selection but before the lock was
 * still published. The fix revalidates status + pause under the lock.
 */

const { mockQuery, resetMocks } = require('./setup');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('T20-F01: cancelAutopublish establishes a durable pause', () => {
  test('cancelling auto-publish sets is_paused', async () => {
    const moderation = require('../controllers/businessModerationController');
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'n1', title: 'Fix sink', status: 'activating_soon' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'n1' }] })   // UPDATE ... RETURNING id
      .mockResolvedValueOnce({ rows: [] });              // logAdminAction insert

    const res = makeRes();
    await moderation.cancelAutopublish(
      { params: { id: 'n1' }, body: { reason: 'customer asked' }, user: { id: 9 } },
      res
    );

    const updateCall = mockQuery.mock.calls.find(c => c[0].includes('UPDATE planned_needs'));
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toMatch(/is_paused\s*=\s*TRUE/i);
    expect(updateCall[0]).toMatch(/status\s*=\s*'planned'/i);
  });
});

describe('T20-F02: scheduler revalidates eligibility under lock', () => {
  // The scheduler module exposes tryPublishPlannedNeed for testing.
  const { tryPublishPlannedNeed } = require('../jobs/plannedNeedsScheduler');

  test('a need cancelled after selection is not published', async () => {
    // FOR UPDATE re-read sees status='cancelled' (admin cancelled between
    // candidate selection and the row lock).
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'n2', published_job_id: null, status: 'cancelled', is_paused: false }],
      });

    const result = await tryPublishPlannedNeed({
      id: 'n2', user_id: 'u1', title: 'Mow lawn', category: 'other',
      estimated_cost: 50, due_date: '2026-10-10', preferred_helper_id: null,
    });

    expect(result.published).toBe(false);
    expect(result.reason).toMatch(/not eligible/i);
    // No job INSERT may have happened.
    const inserts = mockQuery.mock.calls.filter(c => c[0].includes('INSERT INTO jobs'));
    expect(inserts).toHaveLength(0);
  });

  test('a need paused after selection is not published', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'n3', published_job_id: null, status: 'planned', is_paused: true }],
      });

    const result = await tryPublishPlannedNeed({
      id: 'n3', user_id: 'u1', title: 'Fix fence', category: 'other',
      estimated_cost: 80, due_date: '2026-10-10', preferred_helper_id: null,
    });

    expect(result.published).toBe(false);
    const inserts = mockQuery.mock.calls.filter(c => c[0].includes('INSERT INTO jobs'));
    expect(inserts).toHaveLength(0);
  });

  test('an eligible need is still published', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'n4', published_job_id: null, status: 'planned', is_paused: false }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'job-1' }] })  // INSERT job
      .mockResolvedValueOnce({ rows: [] });                // UPDATE planned_needs

    const result = await tryPublishPlannedNeed({
      id: 'n4', user_id: 'u1', title: 'Paint room', category: 'other',
      estimated_cost: 100, due_date: '2026-10-10', preferred_helper_id: null,
      location_city: 'Columbus', location_state: 'OH', location_zip: '43085',
    });

    expect(result.published).toBe(true);
    expect(result.jobId).toBe('job-1');
  });
});
