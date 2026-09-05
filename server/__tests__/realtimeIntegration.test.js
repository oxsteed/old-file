'use strict';

const http = require('http');
const jwt = require('jsonwebtoken');
const { io: createClient } = require('socket.io-client');
const { createRealtimeServer } = require('../bootstrap/realtime');
const supportService = require('../services/websocketService');

const silentLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

function connect(url, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = createClient(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 3000,
      ...options,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

describe('shared realtime server', () => {
  let httpServer;
  let realtime;
  let baseUrl;
  const clients = [];

  const pool = {
    query: jest.fn(async (sql) => {
      if (sql.includes('FROM users')) return { rows: [{ is_active: true, role: 'helper' }] };
      if (sql.includes('FROM conversations')) return { rows: [{ id: 'conversation-1' }] };
      return { rows: [] };
    }),
  };

  const socketBridge = {
    chat: null,
    display: null,
    init(namespace) { this.chat = namespace; },
    initRestaurantDisplay(namespace) { this.display = namespace; },
    trackConnect: jest.fn(),
    trackDisconnect: jest.fn(),
    joinBusinessRooms: jest.fn(async () => []),
    shutdown() { this.chat = null; this.display = null; },
  };

  beforeEach(async () => {
    pool.query.mockClear();
    httpServer = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
    });
    realtime = createRealtimeServer({
      httpServer,
      allowedOrigins: ['http://localhost'],
      pool,
      jwtSecret: process.env.JWT_SECRET,
      socketService: socketBridge,
      supportService,
      log: silentLogger,
    });

    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  });

  afterEach(async () => {
    clients.splice(0).forEach((client) => client.disconnect());
    await realtime.close();
  });

  test('connects and exchanges events on chat, support, and restaurant-display namespaces', async () => {
    const token = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const chat = await connect(`${baseUrl}/chat`, { auth: { token } });
    clients.push(chat);
    const chatEvent = once(chat, 'notification:test');
    realtime.namespaces.chat.to('user_user-1').emit('notification:test', { ok: true });
    await expect(chatEvent).resolves.toEqual({ ok: true });

    const support = await connect(`${baseUrl}/support`, { auth: { token } });
    clients.push(support);
    support.emit('customer:join', { userId: 'spoofed-id', visitorName: 'Guest' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const supportEvent = once(support, 'support:test');
    supportService.notifyCustomer('user-1', 'support:test', { ok: true });
    await expect(supportEvent).resolves.toEqual({ ok: true });

    const display = await connect(`${baseUrl}/restaurant-display`);
    clients.push(display);
    display.emit('display:join', 42);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const displayEvent = once(display, 'order:changed');
    realtime.namespaces.restaurantDisplay.to('rdisplay_42').emit('order:changed', { orderId: 7 });
    await expect(displayEvent).resolves.toEqual({ orderId: 7 });
  });

  test('rejects unauthenticated chat connections without affecting public namespaces', async () => {
    await expect(connect(`${baseUrl}/chat`)).rejects.toThrow('Authentication required');
    await expect(connect(`${baseUrl}/support`)).rejects.toThrow('Authentication required');
    const display = await connect(`${baseUrl}/restaurant-display`);
    clients.push(display);
    expect(display.connected).toBe(true);
  });

  test('prevents a second Socket.IO server from attaching to the same HTTP server', () => {
    expect(() => createRealtimeServer({
      httpServer,
      allowedOrigins: ['http://localhost'],
      pool,
      jwtSecret: process.env.JWT_SECRET,
      socketService: socketBridge,
      supportService,
      log: silentLogger,
    })).toThrow('already been initialized');
  });
});
