jest.mock('../db', () => ({ connect: jest.fn() }));
jest.mock('../utils/email', () => ({ sendEmail: jest.fn() }));
jest.mock('../services/websocketService', () => ({ notifyAgent: jest.fn(), broadcastToAdmins: jest.fn(), broadcastToTicket: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));
const db = require('../db');
const email = require('../utils/email');
const { processWaiting, waitingState } = require('../services/supportWaitService');

const now = Date.parse('2026-09-05T12:00:00Z');
function conversation(age, extra = {}) {
  return { id: 'test', status: 'waiting_for_agent', guest_verified_at: new Date(now),
    live_wait_started_at: new Date(now - age * 1000),
    live_wait_expires_at: new Date(now + (300 - age) * 1000),
    server_now: new Date(now), ...extra };
}
function mockClient(c, agents = [], workload = 0) {
  const client = { release: jest.fn(), query: jest.fn(async (sql) => {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.includes('SELECT id FROM support_conversations')) return { rows: [{ id: 'test' }] };
    if (sql.includes('SELECT *, NOW()')) return { rows: [{ ...c }] };
    if (sql.includes('FROM support_agents a')) return { rows: agents };
    if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: workload }] };
    return { rows: [] };
  }) };
  db.connect.mockResolvedValue(client);
  return client;
}
beforeEach(() => { jest.clearAllMocks(); email.sendEmail.mockResolvedValue({ success: true }); });
test.each([[0,300,'waiting'],[119,181,'waiting'],[120,180,'waiting'],[299,1,'waiting'],[300,0,'message'],[400,0,'message']])(
  'persistent deadline at %is', (age, seconds, state) => {
    expect(waitingState(conversation(age), now)).toMatchObject({ state, remainingSeconds: seconds });
  });
test('assigned or closed overrides countdown', () => {
  expect(waitingState(conversation(30, { agent_id: 'agent' }), now).state).toBe('connected');
  expect(waitingState(conversation(30, { status: 'closed' }), now).state).toBe('closed');
});
test('no founder email before two minutes', async () => {
  mockClient(conversation(119)); await processWaiting(); expect(email.sendEmail).not.toHaveBeenCalled();
});
test('founder email at two minutes uses stable idempotency key', async () => {
  const client = mockClient(conversation(120)); await processWaiting();
  expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'emilejeanphilippe@oxsteed.com', idempotencyKey: 'support-founder-test' }));
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('founder_alert_sent_at = NOW()'), ['test']);
});
test('already-sent alert is not repeated', async () => {
  mockClient(conversation(200, { founder_alert_sent_at: new Date(now) })); await processWaiting(); expect(email.sendEmail).not.toHaveBeenCalled();
});
test('email failure rolls back so next worker pass retries', async () => {
  email.sendEmail.mockResolvedValue({ success: false, error: 'unavailable' });
  const client = mockClient(conversation(120)); await processWaiting();
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  expect(client.release).toHaveBeenCalled();
});
test('agent can receive another conversation below capacity; no alert', async () => {
  const client = mockClient(conversation(130), [{ id:'agent', max_concurrent_chats:8, name:'Agent' }], 3);
  await processWaiting();
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO conversation_assignments'), ['test','agent',undefined]);
  expect(email.sendEmail).not.toHaveBeenCalled();
});
test('full agent is not assigned above capacity', async () => {
  const client = mockClient(conversation(130), [{ id:'agent', max_concurrent_chats:8 }], 8);
  await processWaiting();
  expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO conversation_assignments'))).toBe(false);
  expect(email.sendEmail).toHaveBeenCalledTimes(1);
});
test('five-minute timeout stops automatic assignment but retains conversation', async () => {
  const client = mockClient(conversation(300, { founder_alert_sent_at: new Date(now) })); await processWaiting();
  expect(client.query.mock.calls.some(([sql]) => sql.includes('FROM support_agents a'))).toBe(false);
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('live_wait_ended_at = COALESCE'), ['test']);
  expect(client.query.mock.calls.some(([sql]) => sql.includes('DELETE'))).toBe(false);
});
