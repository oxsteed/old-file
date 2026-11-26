'use strict';
const { mockQuery, resetMocks } = require('./setup');
const { getOrCreateJobConversation } = require('../controllers/messageController');

const res = () => { const r = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };
beforeEach(resetMocks);

describe('job conversation entry point (P1-136)', () => {
  const job = { id: 'j1', client_id: 'c1', assigned_helper_id: 'h1' };

  test('non-participants are refused', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [job] })
      // G5-14 (271): the helper belongs to no business, so no crew
      // admission is possible.
      .mockResolvedValueOnce({ rows: [] });
    const r = res();
    await getOrCreateJobConversation({ user: { id: 'x' }, params: { jobId: 'j1' } }, r);
    expect(r.status).toHaveBeenCalledWith(403);
  });

  test('jobs without a helper return 409', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...job, assigned_helper_id: null }] });
    const r = res();
    await getOrCreateJobConversation({ user: { id: 'c1' }, params: { jobId: 'j1' } }, r);
    expect(r.status).toHaveBeenCalledWith(409);
  });

  test('helper gets the job-keyed conversation between client and helper', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [job] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'conv' }] });
    const r = res();
    await getOrCreateJobConversation({ user: { id: 'h1' }, params: { jobId: 'j1' } }, r);
    expect(mockQuery.mock.calls[1][1]).toEqual(['c1', 'h1', 'j1']);
    expect(r.json).toHaveBeenCalledWith({ id: 'conv' });
  });

  // G5-14 (271): the job's business is the assigned helper's earliest
  // active membership business; a member there with messages.reply may
  // open the job conversation, scoped to that job.
  test('crew member with messages.reply on the helper business is admitted', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [job] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockResolvedValueOnce({ rows: [{ role: 'employee', membership_id: 99 }] })
      .mockResolvedValueOnce({ rows: [{ code: 'messages.reply', allow: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'conv' }] });
    const r = res();
    await getOrCreateJobConversation({ user: { id: 'crew1' }, params: { jobId: 'j1' } }, r);
    expect(r.json).toHaveBeenCalledWith({ id: 'conv' });
  });

  test('crew member without messages.reply is refused', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [job] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockResolvedValueOnce({ rows: [{ role: 'employee', membership_id: 99 }] })
      .mockResolvedValueOnce({ rows: [{ code: 'messages.view_assigned', allow: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const r = res();
    await getOrCreateJobConversation({ user: { id: 'crew2' }, params: { jobId: 'j1' } }, r);
    expect(r.status).toHaveBeenCalledWith(403);
  });

  test('member of another business is refused', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [job] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockResolvedValueOnce({ rows: [] });
    const r = res();
    await getOrCreateJobConversation({ user: { id: 'outsider' }, params: { jobId: 'j1' } }, r);
    expect(r.status).toHaveBeenCalledWith(403);
  });
});
