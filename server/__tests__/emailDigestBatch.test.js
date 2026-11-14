'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { sendEmail } = require('../utils/email');
const { processSingleUserDigest } = require('../jobs/emailDigestBatch');

beforeEach(() => {
  resetMocks();
  sendEmail.mockClear();
  sendEmail.mockResolvedValue({ success: true, id: 'digest-1' });
});

test('delivers a localized digest and marks rows sent only after provider success', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ email: 'a@example.com', first_name: 'Ana', preferred_language: 'es' }] })
    .mockResolvedValueOnce({ rows: [{ id: 4, title: 'Nuevo trabajo', body: 'Revisa tu trabajo', created_at: new Date().toISOString() }] })
    .mockResolvedValueOnce({ rows: [] });

  await expect(processSingleUserDigest('user-1', 'daily')).resolves.toBe(true);

  expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
    to: 'a@example.com',
    idempotencyKey: expect.stringMatching(/^email-digest:daily:user-1:/),
  }));
  expect(mockQuery.mock.calls[2][0]).toContain('UPDATE email_digest_queue');
});

test('leaves digest rows queued when delivery fails', async () => {
  sendEmail.mockResolvedValueOnce({ success: false, error: 'provider down' });
  mockQuery
    .mockResolvedValueOnce({ rows: [{ email: 'a@example.com', first_name: 'Ana', preferred_language: 'en' }] })
    .mockResolvedValueOnce({ rows: [{ id: 4, title: 'Update', body: 'Body', created_at: new Date().toISOString() }] });

  await expect(processSingleUserDigest('user-1', 'daily')).resolves.toBe(false);
  // Item 28: the failed send now also records a delivery attempt (third
  // query) toward the dead-letter threshold; the rows stay unsent.
  expect(mockQuery).toHaveBeenCalledTimes(3);
  expect(mockQuery.mock.calls[2][0]).toContain('attempt_count');
  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('SET sent_at = CURRENT_TIMESTAMP'))).toBe(false);
});

test('digest pagination reaches users beyond 1000 using bounded provider batches', async () => {
  const email = require('../utils/email');
  // The job reads this function at module load; use isolateModules for the
  // batch transport seam while retaining the same shared database mock.
  email.sendEmailBatch = jest.fn(async messages => messages.map((_, i) => ({ id: String(i) })));
  let processEmailDigest;
  jest.isolateModules(() => { ({ processEmailDigest } = require('../jobs/emailDigestBatch')); });
  const users = Array.from({ length: 1101 }, (_, i) => ({ user_id: `00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}` }));
  let pages = 0;
  mockQuery.mockImplementation(async (sql, params=[]) => {
    if (sql.includes('MAX(id)')) return { rows: [{id:2000}] };
    if (sql.includes('SELECT DISTINCT edq.user_id')) {
      const start=params[1] ? users.findIndex(u=>u.user_id===params[1])+1 : 0;
      pages++; return { rows:users.slice(start,start+100) };
    }
    if (sql.includes('SELECT email, first_name')) return { rows:[{email:`${params[0]}@example.test`,first_name:'Test',preferred_language:'en'}] };
    if (sql.includes('LEFT JOIN notifications')) return { rows:[{id:users.findIndex(u=>u.user_id===params[0])+1,title:'Update',body:'Body',created_at:new Date().toISOString()}] };
    return {rows:[]};
  });
  const result=await processEmailDigest('daily');
  expect(result).toEqual({processed:1101,failed:0});
  expect(pages).toBe(13);
  expect(email.sendEmailBatch).toHaveBeenCalledTimes(12);
  expect(email.sendEmailBatch.mock.calls.every(([messages])=>messages.length<=100)).toBe(true);
  expect(sendEmail).not.toHaveBeenCalled();
});

test('batch purges stale rows and never selects dead-lettered rows', async () => {
  // Item 28: deleted/unsubscribed users' rows were rescanned forever and
  // failing rows had no dead-letter or expiry.
  const email = require('../utils/email');
  email.sendEmailBatch = jest.fn(async (messages) => messages.map((_, i) => ({ id: String(i) })));
  let processEmailDigest;
  jest.isolateModules(() => { ({ processEmailDigest } = require('../jobs/emailDigestBatch')); });
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('DELETE FROM email_digest_queue')) return { rows: [], rowCount: 2 };
    if (sql.includes('MAX(id)')) return { rows: [{ id: 2000 }] };
    if (sql.includes('SELECT DISTINCT edq.user_id')) return { rows: [] };
    return { rows: [] };
  });
  const result = await processEmailDigest('daily');
  expect(result).toEqual({ processed: 0, failed: 0 });
  const purgeCalls = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('DELETE FROM email_digest_queue'));
  expect(purgeCalls).toHaveLength(1);
  expect(purgeCalls[0][0]).toContain('deleted_at IS NOT NULL');
  expect(purgeCalls[0][0]).toContain('unsubscribe_all = TRUE');
  const selectCalls = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('SELECT DISTINCT edq.user_id'));
  expect(selectCalls).toHaveLength(1);
  expect(selectCalls[0][0]).toContain('dead_lettered_at IS NULL');
});

test('a failed batch send records a delivery attempt (dead-letter path)', async () => {
  const email = require('../utils/email');
  email.sendEmailBatch = jest.fn(async () => { throw new Error('provider down'); });
  let processEmailDigest;
  jest.isolateModules(() => { ({ processEmailDigest } = require('../jobs/emailDigestBatch')); });
  const userId = '00000000-0000-4000-8000-000000000001';
  let distinctCalls = 0;
  mockQuery.mockImplementation(async (sql, params = []) => {
    if (sql.includes('DELETE FROM email_digest_queue')) return { rows: [], rowCount: 0 };
    if (sql.includes('MAX(id)')) return { rows: [{ id: 2000 }] };
    if (sql.includes('SELECT DISTINCT edq.user_id')) {
      distinctCalls++;
      return { rows: distinctCalls === 1 ? [{ user_id: userId }] : [] };
    }
    if (sql.includes('SELECT email, first_name')) return { rows: [{ email: 'a@example.com', first_name: 'Ana', preferred_language: 'en' }] };
    if (sql.includes('LEFT JOIN notifications')) return { rows: [{ id: 4, title: 'Update', body: 'Body', created_at: new Date().toISOString() }] };
    return { rows: [], rowCount: 0 };
  });
  const result = await processEmailDigest('daily');
  expect(result.failed).toBe(1);
  const attemptCalls = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('attempt_count'));
  expect(attemptCalls).toHaveLength(1);
  expect(attemptCalls[0][0]).toContain('dead_lettered_at');
  // A failed send never marks rows sent.
  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('SET sent_at=CURRENT_TIMESTAMP'))).toBe(false);
});

test('a failed single-user send records a delivery attempt', async () => {
  sendEmail.mockResolvedValueOnce({ success: false, error: 'provider down' });
  mockQuery
    .mockResolvedValueOnce({ rows: [{ email: 'a@example.com', first_name: 'Ana', preferred_language: 'en' }] })
    .mockResolvedValueOnce({ rows: [{ id: 4, title: 'Update', body: 'Body', created_at: new Date().toISOString() }] });

  await expect(processSingleUserDigest('user-1', 'daily')).resolves.toBe(false);
  const attemptCalls = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('attempt_count'));
  expect(attemptCalls).toHaveLength(1);
});
