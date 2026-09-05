'use strict';

// Isolated database smoke test. Never point this at a production database.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('node:assert/strict');
const { Pool } = require(process.env.PG_MODULE || 'pg');
const url = new URL(process.env.DATABASE_URL);
url.pathname = '/oxsteed_support_wait_test';
const db = new Pool({ connectionString: url.toString(), ssl: false });
const sent = [];
const email = { sendEmail: async (message) => { sent.push(message); return { success: true }; } };
const sockets = new Proxy({}, { get: () => () => {} });
const sourceRoot = process.env.SUPPORT_SOURCE_ROOT || path.resolve(__dirname, '..');
function load(file, extra = {}) {
  const module = { exports: {} };
  const dependencies = { '../db': db, '../utils/email': email,
    '../utils/logger': { error() {} }, './websocketService': sockets,
    '../services/websocketService': sockets,
    '../utils/apiError': { sendError: (res, status, error) => res.status(status).json({ error }),
      sendValidationError: (res, error) => res.status(400).json({ error }) }, ...extra };
  vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(path.join(sourceRoot, file), 'utf8')}\n})`, { Date, console })(
    (name) => dependencies[name] || require(name), module, module.exports);
  return module.exports;
}
async function request(handler, body, id, token) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
  await handler({ body, params: { conversationId: id }, guestToken: token }, res);
  return res;
}
async function main() {
  await db.query(`CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), first_name text, last_name text,
    is_active boolean DEFAULT true, is_available_for_support boolean DEFAULT true, support_available_at timestamptz DEFAULT now());
    CREATE TABLE businesses (id serial PRIMARY KEY);
    CREATE TABLE support_employers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), kind text);
    CREATE TABLE support_agents (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employer_id UUID, user_id UUID,
      status text DEFAULT 'active', is_available boolean DEFAULT true, max_concurrent_chats int DEFAULT 3, created_at timestamptz DEFAULT now());
    CREATE TABLE support_conversations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id int NOT NULL,
      customer_id UUID, agent_id UUID, guest_name text, guest_email text, subject text, description text,
      category text, priority text, status varchar(20), assigned_at timestamptz, guest_verified_at timestamptz,
      guest_access_token_hash text, guest_token_expires_at timestamptz, created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(), message_count int DEFAULT 0, customer_message_count int DEFAULT 0);
    CREATE TABLE support_conversation_messages (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID,
      sender_id UUID, message_type text, content text, is_agent boolean, created_at timestamptz DEFAULT now());
    CREATE TABLE support_guest_verifications (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID,
      email text, code_hash text, expires_at timestamptz, attempts int DEFAULT 0, consumed_at timestamptz, created_at timestamptz DEFAULT now());
    CREATE TABLE support_queue (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id int NOT NULL,
      conversation_id UUID, priority text, status text, routed_to_agent_id UUID, claimed_at timestamptz,
      removed_at timestamptz, reason_removed text);
    CREATE TABLE conversation_assignments (conversation_id UUID, agent_id UUID, business_id int NOT NULL, assignment_type text);
    CREATE TABLE queue_events (business_id int NOT NULL);`);
  await db.query(fs.readFileSync(path.join(sourceRoot, 'migrations/379_platform_support_waiting.sql'), 'utf8'));
  const worker = load('services/supportWaitService.js');
  const controller = load('controllers/publicSupportController.js', { '../services/supportWaitService': worker });
  const create = await request(controller.createGuestConversation, { visitorName: 'Test Customer', visitorEmail: 'test@example.com', message: 'Test help request' });
  assert.equal(create.statusCode, 201, JSON.stringify(create.data));
  const id = create.data.conversationId;
  assert.equal((await db.query('SELECT count(*)::int AS n FROM support_queue')).rows[0].n, 0);
  const code = sent[0].text.match(/code is (\d{6})/)[1];
  const verified = await request(controller.verifyGuestConversation, { visitorEmail:'test@example.com', code }, id);
  assert.equal(verified.statusCode, 200, JSON.stringify(verified.data));
  const duplicate = await request(controller.verifyGuestConversation, { visitorEmail:'test@example.com', code }, id);
  assert.equal(duplicate.statusCode, 401);
  let loaded = await request(controller.loadGuestConversation, {}, id, verified.data.guestToken);
  assert.equal(loaded.data.data.waiting.state, 'waiting');
  await worker.processWaiting();
  assert.equal(sent.length, 1);
  await db.query(`UPDATE support_conversations SET live_wait_started_at = now() - interval '121 seconds' WHERE id = $1`, [id]);
  await worker.processWaiting(); await worker.processWaiting();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].to, 'emilejeanphilippe@oxsteed.com');
  await db.query(`UPDATE support_conversations SET live_wait_expires_at = now() - interval '1 second' WHERE id = $1`, [id]);
  await worker.processWaiting();
  loaded = await request(controller.loadGuestConversation, {}, id, verified.data.guestToken);
  assert.equal(loaded.data.data.waiting.state, 'message');
  assert.equal((await request(controller.addGuestMessage, { message:'Please follow up' }, id, verified.data.guestToken)).statusCode, 200);
  assert.equal((await request(controller.loadGuestConversation, {}, id, 'invalid')).statusCode, 404);
  const user = (await db.query(`INSERT INTO users(first_name,last_name) VALUES ('Test','Agent') RETURNING id`)).rows[0];
  const employer = (await db.query(`INSERT INTO support_employers(kind) VALUES ('platform') RETURNING id`)).rows[0];
  const agent = (await db.query(`INSERT INTO support_agents(user_id,employer_id,max_concurrent_chats) VALUES ($1,$2,2) RETURNING id`, [user.id, employer.id])).rows[0];
  for (let i=0;i<3;i++) await db.query(`INSERT INTO support_conversations
    (status,guest_verified_at,live_wait_started_at,live_wait_expires_at) VALUES
    ('waiting_for_agent',now(),now(),now()+interval '5 minutes')`);
  await Promise.all([worker.processWaiting(),worker.processWaiting()]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM support_conversations WHERE agent_id=$1',[agent.id])).rows[0].n,2);
  console.log('PASS: no-business guest request, verification/replay, private read, durable countdown, two-minute single alert, five-minute fallback, saved follow-up, concurrent routing and multi-chat capacity.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.end());
