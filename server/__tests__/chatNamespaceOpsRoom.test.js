'use strict';

// Covers ops_delivery room membership for delivery-tracking live events:
// admins always join; approved operations-workspace staff join; customers and
// unapproved staff do not.
const http = require('http');
const { Server } = require('socket.io');
const { io: createClient } = require('socket.io-client');
const { bindChatNamespace } = require('../realtime/chatNamespace');

const silentLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function connect(url, user) {
  return new Promise((resolve, reject) => {
    const socket = createClient(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 3000,
      auth: { userId: user.id },
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

describe('ops_delivery room membership', () => {
  let httpServer;
  let chat;
  let baseUrl;
  const clients = [];
  // userId -> { role, logistics_role, credential }
  let users = {};

  beforeAll((done) => {
    const pool = {
      query: jest.fn(async (sql, params) => {
        if (sql.includes('FROM users')) {
          const u = users[params[0]] || { role: 'customer' };
          return { rows: [{ is_active: true, role: u.role, logistics_role: u.logistics_role || null }] };
        }
        if (sql.includes('FROM logistics_internal_access_credentials')) {
          const u = users[params[0]];
          return { rows: u && u.credential ? [{}] : [] };
        }
        return { rows: [] };
      }),
    };
    // Bypass JWT: install a lightweight authenticator that mirrors the real
    // one's post-auth socket fields.
    httpServer = http.createServer();
    const io = new Server(httpServer);
    chat = io.of('/chat');
    chat.use(async (socket, next) => {
      const u = users[socket.handshake.auth?.userId] || { role: 'customer' };
      socket.userId = socket.handshake.auth?.userId || 'anon';
      socket.userRole = u.role;
      socket.logisticsRole = u.logistics_role || null;
      next();
    });
    const socketService = {
      trackConnect: jest.fn(),
      trackDisconnect: jest.fn(),
      joinBusinessRooms: jest.fn(async () => []),
    };
    bindChatNamespace(chat, { pool, socketService, logger: silentLogger });
    httpServer.listen(0, () => {
      baseUrl = `http://127.0.0.1:${httpServer.address().port}/chat`;
      done();
    });
  });

  afterAll((done) => {
    clients.forEach((c) => c.disconnect());
    httpServer.close(done);
  });

  beforeEach(() => { users = {}; });

  async function receivesOpsEvent(user) {
    const socket = await connect(baseUrl, user);
    clients.push(socket);
    const received = new Promise((resolve) => {
      socket.once('tracking:ops:location_updated', (payload) => resolve(payload));
      setTimeout(() => resolve(null), 500);
    });
    // Give the async room-join a tick to complete.
    await new Promise((r) => setTimeout(r, 100));
    chat.to('ops_delivery').emit('tracking:ops:location_updated', { ping: true });
    return received;
  }

  test('admin joins ops_delivery', async () => {
    users = { u1: { role: 'admin' } };
    await expect(receivesOpsEvent({ id: 'u1' })).resolves.toEqual({ ping: true });
  });

  test('approved operations staff joins ops_delivery', async () => {
    users = { u2: { role: 'helper', logistics_role: 'logistics_coordinator', credential: true } };
    await expect(receivesOpsEvent({ id: 'u2' })).resolves.toEqual({ ping: true });
  });

  test('operations staff without an active credential does not join', async () => {
    users = { u3: { role: 'helper', logistics_role: 'warehouse_operator', credential: false } };
    await expect(receivesOpsEvent({ id: 'u3' })).resolves.toBeNull();
  });

  test('customer does not join ops_delivery', async () => {
    users = { u4: { role: 'customer' } };
    await expect(receivesOpsEvent({ id: 'u4' })).resolves.toBeNull();
  });
});
