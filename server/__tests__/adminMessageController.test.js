'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/adminMessageController');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('getThread marks only visible messages read without using a nonexistent updated_at column', async () => {
  const visible = [
    { id: '11111111-1111-4111-8111-111111111111', sender_id: 'user-1', content: 'one', message_type: 'text', is_read: false, created_at: '2026-11-11T10:00:00.000Z', updated_at: null, read_at: null, sender_first_name: 'User', sender_last_name: 'One', sender_role: 'helper' },
    { id: '22222222-2222-4222-8222-222222222222', sender_id: 'admin-1', content: 'two', message_type: 'system', is_read: true, created_at: '2026-11-11T10:01:00.000Z', updated_at: null, read_at: null, sender_first_name: 'Admin', sender_last_name: 'One', sender_role: 'admin' },
  ];

  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 'user-1', first_name: 'User', last_name: 'One', email: 'user@example.test', role: 'helper' }] };
    if (sql.includes('FROM conversations')) return { rows: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] };
    if (sql.includes('FROM messages m')) return { rows: visible };
    if (sql.includes('COUNT(*) FROM messages')) return { rows: [{ count: '3' }] };
    if (sql.startsWith('UPDATE messages')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });

  const res = makeRes();
  await controller.getThread({
    user: { id: 'admin-1', role: 'admin' },
    params: { userId: 'user-1' },
    query: { limit: '2', offset: '0' },
  }, res);

  expect(res.status).not.toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ total: 3, messages: visible }));
  const [updateSql, values] = mockQuery.mock.calls.find(([sql]) => sql.startsWith('UPDATE messages'));
  expect(updateSql).toContain('id = ANY($1::uuid[])');
  expect(updateSql).toContain('read_at = COALESCE(read_at, NOW())');
  expect(updateSql).toContain('updated_at = NOW()');
  expect(values).toEqual([[visible[0].id, visible[1].id], 'admin-1']);
});

test('getThread does not issue a read acknowledgement for an empty page', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 'user-1', first_name: 'User', last_name: 'One', email: 'user@example.test', role: 'helper' }] };
    if (sql.includes('FROM conversations')) return { rows: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] };
    if (sql.includes('FROM messages m')) return { rows: [] };
    if (sql.includes('COUNT(*) FROM messages')) return { rows: [{ count: '4' }] };
    return { rows: [], rowCount: 0 };
  });

  const res = makeRes();
  await controller.getThread({ user: { id: 'admin-1', role: 'admin' }, params: { userId: 'user-1' }, query: {} }, res);

  expect(res.status).not.toHaveBeenCalledWith(500);
  expect(mockQuery.mock.calls.some(([sql]) => sql.startsWith('UPDATE messages'))).toBe(false);
});

test('getThread opens the exact listed conversation for a super-admin', async () => {
  const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const target = { id: 'user-2', first_name: 'Other', last_name: 'User', email: 'other@example.test', role: 'helper' };
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('JOIN users a ON a.id = c.customer_id')) return { rows: [{ conversation_id: conversationId, user_id: target.id, ...target }] };
    if (sql.includes('FROM messages m')) return { rows: [] };
    if (sql.includes('COUNT(*) FROM messages')) return { rows: [{ count: '0' }] };
    return { rows: [], rowCount: 0 };
  });

  const res = makeRes();
  await controller.getThread({
    user: { id: 'super-admin-1', role: 'super_admin' },
    params: { userId: 'user-2' },
    query: { conversationId },
  }, res);

  expect(res.status).not.toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ conversation_id: conversationId, user: target }));
  const conversationCall = mockQuery.mock.calls.find(([sql]) => sql.includes('JOIN users a ON a.id = c.customer_id'));
  expect(conversationCall[1]).toEqual([conversationId, true, 'super-admin-1']);
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes('WHERE id::text = $1'))).toBe(false);
});

test('getThread rejects malformed conversation identity before querying', async () => {
  const res = makeRes();
  await controller.getThread({
    user: { id: 'super-admin-1', role: 'super_admin' },
    params: { userId: 'user-2' },
    query: { conversationId: 'not-a-uuid' },
  }, res);

  expect(res.status).toHaveBeenCalledWith(400);
  expect(mockQuery).not.toHaveBeenCalled();
});
