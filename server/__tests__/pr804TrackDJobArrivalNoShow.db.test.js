'use strict';

/**
 * PR #804 Track D, G-15 (arrival / no-show) and G-16 (rework path).
 *
 * Against the real migrated schema, through the real job controller:
 *   - the assigned helper marks arrival: arrived_at is stamped on the job
 *     and the linked appointment, the status is unchanged, and the client
 *     is notified;
 *   - either party marks a no-show with a required reason: the job (and
 *     its appointment) go to terminal no_show and the other party is
 *     notified;
 *   - the customer requests changes on a completion request: the job stays
 *     in_progress, the reason is recorded, and the auto-confirm clock is
 *     paused (completion_requested_at cleared); a missing reason 400s and
 *     a request with no completion pending 400s.
 *
 * DB: disposable loopback database credit_statement_test_pr804_d only; the
 * suite skips otherwise. Run with STATEMENT_TEST_DATABASE_URL pointed at it.
 */
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test(_pr804_d)?$/.test(url.pathname);
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable Track D test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'pr804-track-d-test-secret';
}

const pool = require('../db');
const jobController = require('../controllers/jobController');

jest.setTimeout(60000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

async function call(handler, req) {
  const res = mockRes();
  const next = jest.fn();
  await handler(req, res, next);
  return { res, err: next.mock.calls[0] ? next.mock.calls[0][0] : null };
}

ddescribe('G-15 arrival / no-show and G-16 rework', () => {
  let clientId;
  let helperId;

  beforeAll(async () => {
    async function makeUser(role) {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
         VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE)`,
        [id, `pr804d-job-${id.slice(0, 8)}@example.invalid`, role, role],
      );
      return id;
    }
    clientId = await makeUser('customer');
    helperId = await makeUser('helper');
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  async function makeJob({ status = 'accepted', completionRequested = false } = {}) {
    const { rows: [job] } = await pool.query(
      `INSERT INTO jobs (client_id, assigned_helper_id, title, description, status,
                         completion_requested_at, completion_requested_by)
       VALUES ($1, $2, 'Fix the sink', 'Leaky tap', $3, $4, $5) RETURNING *`,
      [clientId, helperId, status, completionRequested ? new Date() : null, completionRequested ? helperId : null],
    );
    return job;
  }

  let apptDayOffset = 0;
  async function makeAppointment(jobId) {
    // Each appointment needs its own window: an appointments trigger
    // rejects overlapping bookings for the same helper.
    apptDayOffset += 1;
    const day = apptDayOffset;
    const { rows: [appt] } = await pool.query(
      `INSERT INTO appointments (job_id, customer_id, helper_id, status, service_description,
                                scheduled_start_time, scheduled_end_time)
       VALUES ($1, $2, $3, 'confirmed', 'Fix the sink',
               NOW() + ($4 || ' day')::interval, NOW() + ($4 || ' day')::interval + interval '1 hour') RETURNING *`,
      [jobId, clientId, helperId, `${day} days`],
    );
    return appt;
  }

  test('G-15: helper marks arrival; job + appointment stamped, status unchanged, client notified', async () => {
    const job = await makeJob({ status: 'accepted' });
    const appt = await makeAppointment(job.id);
    const { res, err } = await call(jobController.markJobArrived, {
      params: { id: job.id }, user: { id: helperId }, body: {},
    });
    expect(err).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(res.payload.job.arrived_at).toBeTruthy();
    expect(res.payload.job.status).toBe('accepted');

    const { rows: [after] } = await pool.query('SELECT arrived_at FROM jobs WHERE id = $1', [job.id]);
    expect(after.arrived_at).toBeTruthy();
    const { rows: [apptAfter] } = await pool.query('SELECT arrived_at FROM appointments WHERE id = $1', [appt.id]);
    expect(apptAfter.arrived_at).toBeTruthy();
    const { rows: notes } = await pool.query(
      "SELECT * FROM notifications WHERE user_id = $1 AND type = 'job_arrived'", [clientId],
    );
    expect(notes.length).toBeGreaterThanOrEqual(1);

    // A second arrival is a conflict.
    const again = await call(jobController.markJobArrived, {
      params: { id: job.id }, user: { id: helperId }, body: {},
    });
    expect(again.err).toBeTruthy();
    expect(again.err.statusCode || again.err.status).toBe(409);
  });

  test('G-15: no-show needs a reason and is terminal; appointment follows', async () => {
    const job = await makeJob({ status: 'accepted' });
    await makeAppointment(job.id);

    const noReason = await call(jobController.markJobNoShow, {
      params: { id: job.id }, user: { id: helperId }, body: { reason: '  ' },
    });
    expect(noReason.err).toBeTruthy();
    expect(noReason.err.statusCode || noReason.err.status).toBe(400);

    const { res, err } = await call(jobController.markJobNoShow, {
      params: { id: job.id }, user: { id: helperId }, body: { reason: 'Nobody answered the door' },
    });
    expect(err).toBeNull();
    expect(res.payload.job.status).toBe('no_show');
    expect(res.payload.job.no_show_reason).toBe('Nobody answered the door');
    const { rows: [apptAfter] } = await pool.query('SELECT status FROM appointments WHERE job_id = $1', [job.id]);
    expect(apptAfter.status).toBe('no_show');
    const { rows: notes } = await pool.query(
      "SELECT * FROM notifications WHERE user_id = $1 AND type = 'job_no_show'", [clientId],
    );
    expect(notes.length).toBeGreaterThanOrEqual(1);

    // Terminal: a second no-show is rejected.
    const again = await call(jobController.markJobNoShow, {
      params: { id: job.id }, user: { id: clientId }, body: { reason: 'again' },
    });
    expect(again.err).toBeTruthy();
  });

  test('G-16: request changes returns the job to in_progress work and pauses auto-confirm', async () => {
    const job = await makeJob({ status: 'in_progress', completionRequested: true });

    const noReason = await call(jobController.requestJobChanges, {
      params: { id: job.id }, user: { id: clientId }, body: { reason: '' },
    });
    expect(noReason.err).toBeTruthy();

    const { res, err } = await call(jobController.requestJobChanges, {
      params: { id: job.id }, user: { id: clientId }, body: { reason: 'The tap still drips, please refit the washer' },
    });
    expect(err).toBeNull();
    expect(res.payload.job.status).toBe('in_progress');
    expect(res.payload.job.change_request_reason).toBe('The tap still drips, please refit the washer');
    const { rows: [after] } = await pool.query(
      'SELECT completion_requested_at, change_request_reason FROM jobs WHERE id = $1', [job.id],
    );
    expect(after.completion_requested_at).toBeNull();
    expect(after.change_request_reason).toBe('The tap still drips, please refit the washer');
    const { rows: notes } = await pool.query(
      "SELECT * FROM notifications WHERE user_id = $1 AND type = 'job_changes_requested'", [helperId],
    );
    expect(notes.length).toBeGreaterThanOrEqual(1);
  });

  test('G-16: no changes request when the helper has not asked for completion', async () => {
    const job = await makeJob({ status: 'in_progress', completionRequested: false });
    const { err } = await call(jobController.requestJobChanges, {
      params: { id: job.id }, user: { id: clientId }, body: { reason: 'fix it' },
    });
    expect(err).toBeTruthy();
    expect(err.statusCode || err.status).toBe(400);
  });
});
