'use strict';
const { mockQuery, resetMocks } = require('./setup');
const { getOrCreateJobConversation } = require('../controllers/messageController');

const res = () => { const r = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };
beforeEach(resetMocks);

describe('job conversation entry point (P1-136)', () => {
  const job = { id: 'j1', client_id: 'c1', assigned_helper_id: 'h1' };

  test('non-participants are refused', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [job] });
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
});
