'use strict';
// Group 4 rest (items 179, 180): the customer is notified of a new progress
// update (not on a retried request) and of a changed completion handover.
const raw = process.env.ACCESS_TEST_DATABASE_URL;
if (raw) {
  const parsed = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || !/^\/(credit_statement_test|pa_g\d+)$/.test(parsed.pathname)) throw new Error('Disposable database required');
  process.env.DATABASE_URL = raw;
}
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
const crypto = require('crypto');
const pool = require('../db');
const work = require('../services/helperWorkService');
const { sendNotification } = require('../services/notificationService');
const { NOTIFICATION_TYPES } = require('../utils/notificationTypeCatalog');
const describeDb = raw ? describe : describe.skip;
const helper = crypto.randomUUID(), client = crypto.randomUUID();
let jobId;
const calls = (type) => sendNotification.mock.calls.map(([a]) => a).filter((a) => a.type === type);

describeDb('Group 4 rest: progress and handover notices (179, 180)', () => {
  beforeAll(async () => {
    for (const id of [helper, client]) {
      await pool.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,id_verified,terms_accepted,terms_accepted_at,terms_version)
        VALUES($1,$2,'x','Notice','Fixture','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'g4r-test')`, [id, `g4n-${id}@example.invalid`]);
    }
    await pool.query(`INSERT INTO access_grants(user_id,capability,subject_type,subject_key,status,provenance,policy_version)
      VALUES($1,'helper.offer_services','self','self','active','legacy_backfill','helper-policy-1')`, [helper]);
    const { rows: [job] } = await pool.query(`INSERT INTO jobs(client_id,assigned_helper_id,title,description,status) VALUES($1,$2,'Notice job','Fixture','in_progress') RETURNING id`, [client, helper]);
    jobId = job.id;
  });
  afterAll(async () => {
    if (jobId) await pool.query('DELETE FROM jobs WHERE id=$1', [jobId]);
    await pool.query('DELETE FROM access_grants WHERE user_id = ANY($1::uuid[])', [[helper, client]]);
    await pool.end();
  });

  test('179: a new progress update notifies the customer once; a retry does not', async () => {
    const body = { body: 'Halfway done', requestId: crypto.randomUUID() };
    const first = await work.publish(jobId, helper, body);
    await work.publish(jobId, helper, body);
    const sent = calls('helper_progress_update');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ userId: client, idempotencyKey: `helper-progress:${first.id}` });
  });

  test('180: handover notifies only when it is set or changed', async () => {
    const base = { checklist: [], private_notes: 'secret', aftercare: '' };
    await work.save(jobId, helper, { ...base, expectedVersion: 0, handover: '' });
    expect(calls('helper_handover_updated')).toHaveLength(0);
    await work.save(jobId, helper, { ...base, expectedVersion: 1, handover: 'Replaced the valve' });
    await work.save(jobId, helper, { ...base, expectedVersion: 2, handover: 'Replaced the valve', private_notes: 'edit' });
    const sent = calls('helper_handover_updated');
    expect(sent).toHaveLength(1);
    expect(sent[0].userId).toBe(client);
    expect(JSON.stringify(sent[0])).not.toContain('secret');
  });

  test('catalog: both notice types are cataloged and have copy', () => {
    const types = new Set(NOTIFICATION_TYPES.map((e) => e.type));
    const { jobLifecycleNotifications } = require('../utils/jobLifecycleNotificationTemplates');
    for (const type of ['helper_progress_update', 'helper_handover_updated', 'review_response_posted']) {
      expect(types.has(type)).toBe(true);
      expect(jobLifecycleNotifications[type].title.ar).toBeTruthy();
    }
  });
});
