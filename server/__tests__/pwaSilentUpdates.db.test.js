'use strict';
// PR #809 PWA silent updates (D-445): live-data acceptance on a fresh
// scratch DB. Proves the server side of the live streams end to end:
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
jest.unmock('../services/socketService');
jest.unmock('../services/tokenRevocationService');
//   - job:join admits the job client, a bidder and an admin, and admits
//     nobody else (a stranger joins nothing and receives nothing);
//   - bid create / update / withdraw reach the job room as bid:created /
//     bid:updated / bid:withdrawn, and reach nobody outside the room;
//   - a real transferCredit emits credit:balance to the sender's and the
//     recipient's user rooms only, and the payload carries no amounts.
// The client-side merge is covered by client/scripts/jobDetailBidsLive.test.mjs.
//
// Run (fresh DB; the migrate step is a one-off per checkout):
//   psql ... -c "DROP DATABASE IF EXISTS credit_statement_test_pwa" -c "CREATE DATABASE credit_statement_test_pwa"
//   DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test_pwa npm run migrate
//   PWA_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test_pwa npx jest __tests__/pwaSilentUpdates.db.test.js --forceExit
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { io: clientIo } = require('socket.io-client');
const jwt = require('jsonwebtoken');

const raw = process.env.PWA_TEST_DATABASE_URL;
if (raw) {
  const parsed = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/credit_statement_test_pwa') {
    throw new Error('PWA acceptance tests require the disposable credit_statement_test_pwa database');
  }
  process.env.DATABASE_URL = raw;
}
// oxsteedCreditService reads this at module load, so it must be set before
// any require of the service below.
process.env.OXSTEED_CREDIT_ALLOW_CUSTOMER_TRANSFERS = 'true';

const describeDb = raw ? describe : describe.skip;

describeDb('pwa silent updates: live credit and bids', () => {
  jest.setTimeout(60000);
  let pool;
  let httpServer;
  let io;
  let ids;
  let jobId;
  let bidId;
  const sockets = [];

  async function createUser(role) {
    const id = crypto.randomUUID();
    const verified = role === 'helper';
    // public.users carries a user_role enum plus NOT NULL email /
    // password_hash / first_name / last_name, so the role parameter is cast
    // and the derived flags are passed as one boolean (the bidAcceptance
    // seed's CASE WHEN $2 = 'helper' only works against its schema-local
    // text-role users table).
    await pool.query(
      `INSERT INTO users(id, role, is_active, id_verified, terms_accepted,
                         terms_accepted_at, terms_version, didit_status, didit_verified_at, w9_completed,
                         email, password_hash, first_name, last_name)
       VALUES($1, $2::user_role, TRUE, $3, TRUE, NOW(), 'test-v1',
              CASE WHEN $3 THEN 'verified' END,
              CASE WHEN $3 THEN NOW() END,
              $3,
              $4, 'test-hash', 'Test', 'User')`,
      [id, role, verified, `pwa-${id}@example.com`],
    );
    return id;
  }

  function tokenFor(userId) {
    // isAccessTokenPayload (server/utils/accessToken.js) requires typ
    // 'access', an id, and a non-empty sid for non-impersonation tokens.
    return jwt.sign({ typ: 'access', id: userId, sid: crypto.randomUUID() }, process.env.JWT_SECRET);
  }

  async function connectSocket(userId) {
    const socket = clientIo(`http://127.0.0.1:${httpServer.address().port}/chat`, {
      auth: { token: tokenFor(userId) },
      transports: ['websocket'],
    });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }

  function collect(socket, event) {
    const seen = [];
    socket.on(event, (payload) => seen.push(payload));
    return seen;
  }

  async function waitFor(fn, label) {
    const deadline = Date.now() + 5000;
    for (;;) {
      const value = fn();
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  function callController(fn, req) {
    return new Promise((resolve, reject) => {
      let statusCode = 200;
      let payload;
      const res = {
        status: (code) => {
          statusCode = code;
          return { json: (body) => { payload = body; resolve({ statusCode, payload }); } };
        },
        json: (body) => { payload = body; resolve({ statusCode, payload }); },
      };
      fn(req, res, (err) => (err ? reject(err) : resolve({ statusCode, payload }))).catch(reject);
    });
  }

  beforeAll(async () => {
    // server/db.js exports the pool itself.
    pool = require('../db');
    // Mirror the production wiring in server/bootstrap/realtime.js: the
    // authenticator is namespace middleware, the namespace binds with the
    // real socket service, and the service is init'd with the namespace.
    const { bindChatNamespace, createChatAuthenticator } = require('../realtime/chatNamespace');
    const socketService = require('../services/socketService');
    const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    ids = {
      client: await createUser('customer'),
      helper: await createUser('helper'),
      stranger: await createUser('customer'),
      admin: await createUser('admin'),
      // The transfer recipient must be a customer: a customer_wallet can
      // only be owned by role 'customer' (ensureAccount, walletOwnerRoles).
      recipient: await createUser('customer'),
    };
    // Credit rail on (test fixture only; the rail stays gated live).
    await pool.query(
      `INSERT INTO feature_flags(key, is_enabled) VALUES('oxsteed_credit_enabled', TRUE)
       ON CONFLICT (key) DO UPDATE SET is_enabled = TRUE`,
    );
    jobId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO jobs(id, client_id, status, title, description, metadata)
       VALUES($1, $2, 'published', 'Fix sink', 'Fix a leaking kitchen sink', '{}'::jsonb)`,
      [jobId, ids.client],
    );
    httpServer = http.createServer();
    io = new Server(httpServer);
    const chat = io.of('/chat');
    chat.use(createChatAuthenticator({ pool, jwtSecret: process.env.JWT_SECRET }));
    bindChatNamespace(chat, { pool, socketService, logger: silentLogger });
    socketService.init(chat);
    await new Promise((resolve) => httpServer.listen(0, resolve));
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    if (io) io.close();
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
    if (pool) await pool.end();
  });

  test('job:join admits the client, a bidder and an admin, and denies a stranger', async () => {
    const clientSocket = await connectSocket(ids.client);
    const strangerSocket = await connectSocket(ids.stranger);
    const adminSocket = await connectSocket(ids.admin);
    const clientBids = collect(clientSocket, 'bid:created');
    const strangerBids = collect(strangerSocket, 'bid:created');
    const adminBids = collect(adminSocket, 'bid:created');
    clientSocket.emit('job:join', jobId);
    strangerSocket.emit('job:join', jobId);
    adminSocket.emit('job:join', jobId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const { createBid } = require('../controllers/bidController');
    const { statusCode, payload } = await callController(createBid, {
      user: { id: ids.helper, role: 'helper' },
      accessCapabilities: { 'helper.offer_services': true },
      headers: {},
      body: { job_id: jobId, amount: 90, message: 'Fixing it' },
    });
    expect(statusCode).toBe(201);
    bidId = payload.id;
    expect(bidId).toBeTruthy();
    await waitFor(() => clientBids[0], 'client to receive bid:created');
    await waitFor(() => adminBids[0], 'admin to receive bid:created');
    expect(clientBids[0].bid.id).toBe(bidId);
    expect(adminBids[0].bid.id).toBe(bidId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(strangerBids).toEqual([]);
    // The bidder is admitted too: the helper joins and sees the next event.
    const helperSocket = await connectSocket(ids.helper);
    const helperBids = collect(helperSocket, 'bid:updated');
    helperSocket.emit('job:join', jobId);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const { updateBid } = require('../controllers/bidController');
    const updated = await callController(updateBid, {
      user: { id: ids.helper, role: 'helper' },
      params: { id: bidId },
      body: { amount: 95 },
    });
    expect(updated.statusCode).toBe(200);
    await waitFor(() => helperBids[0], 'bidder to receive bid:updated');
    expect(helperBids[0].bid.id).toBe(bidId);
  });

  test('bid withdraw reaches the room as bid:withdrawn', async () => {
    const clientSocket = await connectSocket(ids.client);
    const withdrawn = collect(clientSocket, 'bid:withdrawn');
    clientSocket.emit('job:join', jobId);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const { withdrawBid } = require('../controllers/bidController');
    const result = await callController(withdrawBid, {
      user: { id: ids.helper, role: 'helper' },
      params: { id: bidId },
    });
    expect(result.statusCode).toBe(200);
    await waitFor(() => withdrawn[0], 'client to receive bid:withdrawn');
    expect(withdrawn[0].bidId).toBe(bidId);
    const { rows } = await pool.query('SELECT status FROM bids WHERE id = $1', [bidId]);
    expect(rows[0].status).toBe('withdrawn');
  });

  test('a real transferCredit emits credit:balance to sender and recipient only, with no amounts', async () => {
    const credit = require('../services/oxsteedCreditService');
    const sender = ids.client;
    const recipient = ids.recipient;
    for (const customerId of [sender, recipient]) {
      await pool.query(
        `INSERT INTO oxsteed_credit_sanctions_screenings (subject_type, subject_id, provider, result, payload_hash)
         VALUES ('customer', $1, 'manual_review', 'clear', $2) ON CONFLICT DO NOTHING`,
        [customerId, `pwa-${customerId}`],
      );
    }
    const clientConn = await pool.connect();
    try {
      await clientConn.query('BEGIN');
      const wallet = await credit.ensureAccount(clientConn, { accountType: 'customer_wallet', customerId: sender, currencyCode: 'USD' });
      await credit.ensureAccount(clientConn, { accountType: 'customer_wallet', customerId: recipient, currencyCode: 'USD' });
      const treasury = await credit.ensureAccount(clientConn, { accountType: 'platform_treasury', currencyCode: 'USD' });
      await credit.postJournalTransaction(clientConn, {
        transactionType: 'load', debitAccountId: treasury.id, creditAccountId: wallet.id, amountCents: 50000, currencyCode: 'USD',
        idempotencyKey: `pwa-load-${sender}`, actorType: 'admin', actorUserId: ids.admin, reason: 'test funding',
        description: 'test funding', referenceType: 'test', referenceId: sender,
      });
      await clientConn.query('COMMIT');
    } catch (error) {
      await clientConn.query('ROLLBACK');
      throw error;
    } finally {
      clientConn.release();
    }
    const senderSocket = await connectSocket(sender);
    const recipientSocket = await connectSocket(recipient);
    const strangerSocket = await connectSocket(ids.stranger);
    const senderEvents = collect(senderSocket, 'credit:balance');
    const recipientEvents = collect(recipientSocket, 'credit:balance');
    const strangerEvents = collect(strangerSocket, 'credit:balance');
    const result = await credit.transferCredit({
      senderCustomerId: sender,
      recipientCustomerId: recipient,
      amountCents: 1000,
      currencyCode: 'USD',
      idempotencyKey: `pwa-transfer-${crypto.randomUUID()}`,
      actorUserId: sender,
    });
    expect(result.transaction).toBeTruthy();
    await waitFor(() => senderEvents[0], 'sender to receive credit:balance');
    await waitFor(() => recipientEvents[0], 'recipient to receive credit:balance');
    expect(senderEvents[0].kind).toBe('transfer');
    expect(recipientEvents[0].kind).toBe('transfer');
    // No amounts anywhere in the nudge: exactly kind + currency + transaction id.
    expect(Object.keys(senderEvents[0]).sort()).toEqual(['currencyCode', 'kind', 'transactionId']);
    expect(Object.keys(recipientEvents[0]).sort()).toEqual(['currencyCode', 'kind', 'transactionId']);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(strangerEvents).toEqual([]);
  });
});
