'use strict';
const { assertCanQuoteJob, bidFromAcceptedQuote } = require('../services/jobQuoteBridge');

const fakeDb = (...results) => {
  const calls = [];
  return { calls, query: jest.fn(async (sql, params) => { calls.push({ sql, params }); return results.shift() || { rows: [] }; }) };
};

describe('jobQuoteBridge (P1-134)', () => {
  test('rejects missing job, own job, non-helper and closed job', async () => {
    expect((await assertCanQuoteJob('j', 'h', fakeDb({ rows: [] }))).status).toBe(404);
    expect((await assertCanQuoteJob('j', 'h', fakeDb({ rows: [{ client_id: 'h', status: 'published', helper_role: 'helper' }] }))).code).toBe('forbidden');
    expect((await assertCanQuoteJob('j', 'h', fakeDb({ rows: [{ client_id: 'c', status: 'published', helper_role: 'customer' }] }))).code).toBe('helper_required');
    expect((await assertCanQuoteJob('j', 'h', fakeDb({ rows: [{ client_id: 'c', status: 'assigned', helper_role: 'helper' }] }))).code).toBe('invalid_job_state');
    expect((await assertCanQuoteJob('j', 'h', fakeDb({ rows: [{ client_id: 'c', status: 'published', helper_role: 'helper' }] }))).ok).toBe(true);
  });

  test('accepted job quote becomes a pending bid at the quoted price', async () => {
    const db = fakeDb({ rows: [{ status: 'published' }] }, { rows: [{ id: 'bid-1' }] });
    const id = await bidFromAcceptedQuote({ id: 7, job_id: 'j', helper_id: 'h', total_cents: 12345, title: 'Move' }, db);
    expect(id).toBe('bid-1');
    expect(db.calls[1].sql).toMatch(/ON CONFLICT \(job_id, helper_id\)/);
    expect(db.calls[1].params.slice(0, 4)).toEqual(['j', 'h', '123.45', 12345]);
  });

  test('no bid for quotes without a job or for closed jobs', async () => {
    expect(await bidFromAcceptedQuote({ id: 1, helper_id: 'h' }, fakeDb())).toBeNull();
    expect(await bidFromAcceptedQuote({ id: 1, job_id: 'j', helper_id: 'h' }, fakeDb({ rows: [{ status: 'completed' }] }))).toBeNull();
  });
});
