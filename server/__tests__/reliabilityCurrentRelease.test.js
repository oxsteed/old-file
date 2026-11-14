'use strict';

/**
 * Domain 7 #4 — a failed deploy / worker handoff has no admin-visible signal.
 *
 * Investigation (see the fix): the release controller and the handoff
 * script run host-side on the production Mac under launchd
 * (scripts/install-web-release-observer.cjs, 60s interval). They have no
 * database access — neither script imports pg or reads DATABASE_URL — and
 * the observer state file (~/Library/Application Support/OxSteed/
 * web-release/state.json, mode 0600) is not visible to the server
 * container, so the server cannot read the controller's failure statuses
 * (waiting_for_schema_apply, worker_release_requires_rolling_target)
 * directly, and no DB credential may be invented for the host scripts.
 *
 * Feasible path, built here: surface the release identity on the
 * Reliability page. GET /admin/super/reliability/current-release returns
 * the running release metadata (the same getReleaseMetadata() behind
 * /ready) alongside the last recorded release_history row and the last
 * known-good ('deployed') row, with a mismatch flag when the running
 * build is not the last recorded deployment — exactly the live instance
 * on record, where the controller reported
 * worker_release_requires_rolling_target and the Reliability page kept
 * showing the previous manual row as current with no signal.
 *
 * Recording a failed release from the host remains a follow-up: it needs
 * an authenticated deploy-report channel (a credential Emile provisions
 * on the host), not a credential invented in this change.
 */

jest.mock('../utils/release', () => ({
  getReleaseMetadata: jest.fn(),
}));

const { mockQuery, resetMocks } = require('./setup');
const { getReleaseMetadata } = require('../utils/release');
const { getCurrentRelease } = require('../controllers/reliabilityController');

const RUNNING = {
  release: 'release-2026-11-13',
  gitSha: 'aabbccddeeff00112233445566778899aabbccdd',
  imageDigest: null,
  deploymentId: 'dep-1',
};

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.body = payload; return res; });
  return res;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  getReleaseMetadata.mockReturnValue({ ...RUNNING });
});

test('running release matching the last recorded deployment reports no mismatch', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 1, version: 'v2.14.0', commit_sha: RUNNING.gitSha, status: 'deployed', deployed_at: '2026-11-13T00:00:00.000Z' }] })
    .mockResolvedValueOnce({ rows: [{ id: 1, version: 'v2.14.0', commit_sha: RUNNING.gitSha, status: 'deployed', deployed_at: '2026-11-13T00:00:00.000Z' }] });
  const res = mockRes();

  await getCurrentRelease({}, res);

  expect(res.statusCode).toBe(200);
  expect(res.body.current).toEqual(RUNNING);
  expect(res.body.lastRecorded.commit_sha).toBe(RUNNING.gitSha);
  expect(res.body.lastKnownGood.commit_sha).toBe(RUNNING.gitSha);
  expect(res.body.mismatch).toBe(false);
});

test('running release older than the last recorded deployment reports a mismatch', async () => {
  const recorded = { id: 2, version: 'v2.15.0', commit_sha: '2f988901a2f988901a2f988901a2f988901a2f988901a', status: 'deployed', deployed_at: '2026-11-13T01:00:00.000Z' };
  mockQuery
    .mockResolvedValueOnce({ rows: [recorded] })
    .mockResolvedValueOnce({ rows: [recorded] });
  const res = mockRes();

  await getCurrentRelease({}, res);

  expect(res.body.mismatch).toBe(true);
  expect(res.body.lastKnownGood.commit_sha).toBe(recorded.commit_sha);
  expect(res.body.current.gitSha).toBe(RUNNING.gitSha);
});

test('a short recorded SHA that is a prefix of the running SHA is not a mismatch', async () => {
  const short = { id: 1, version: 'v2.14.0', commit_sha: RUNNING.gitSha.slice(0, 12), status: 'deployed', deployed_at: '2026-11-13T00:00:00.000Z' };
  mockQuery
    .mockResolvedValueOnce({ rows: [short] })
    .mockResolvedValueOnce({ rows: [short] });
  const res = mockRes();

  await getCurrentRelease({}, res);

  expect(res.body.mismatch).toBe(false);
});

test('no recorded releases yields nulls and no mismatch', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
  const res = mockRes();

  await getCurrentRelease({}, res);

  expect(res.body).toMatchObject({ lastRecorded: null, lastKnownGood: null, mismatch: false });
  expect(res.body.current).toEqual(RUNNING);
});

test('a history read failure fails closed with 500', async () => {
  mockQuery.mockRejectedValue(new Error('database down'));
  const res = mockRes();

  await getCurrentRelease({}, res);

  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.body.code).toBe('current_release_unavailable');
});
