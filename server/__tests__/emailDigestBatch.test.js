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
  expect(mockQuery).toHaveBeenCalledTimes(2);
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
