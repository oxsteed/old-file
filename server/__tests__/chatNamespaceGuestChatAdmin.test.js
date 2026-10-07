'use strict';

// ITEM 7 (P1) — guest_chat_admin room authorization.
//
// Covers the break-glass model for the guest chat admin room (live guest
// PII): nobody auto-joins, not even super_admin. A super_admin joins only
// with an active, unexpired, unrevoked investigation grant (purpose +
// approver + expiry, the E13 mechanism), and every break-glass join is
// written to the admin audit log BEFORE the room join — an audit failure
// fails closed (no join). Regular admins join only with a live
// manage_support grant, mirroring the REST model (T11-F01 in
// routes/support.js).
const http = require('http');
const { Server } = require('socket.io');
const { io: createClient } = require('socket.io-client');
const {
  bindChatNamespace,
  resolveGuestChatAdminAccess,
} = require('../realtime/chatNamespace');

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

const ACTIVE_GRANT = {
  id: 42,
  investigation_ref: 'INV-2026-118',
  purpose: 'Investigate suspected guest PII exfiltration in chat queue',
  approver_admin_id: 'approver-1',
  expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
};

describe('resolveGuestChatAdminAccess (unit)', () => {
  // grantState: 'active' | 'expired' | 'revoked' | 'none'
  function mockPool({ grantState = 'none', hasManageSupport = false } = {}) {
    return {
      query: jest.fn(async (sql) => {
        if (sql.includes('investigation_access_grants')) {
          return { rows: grantState === 'active' ? [ACTIVE_GRANT] : [] };
        }
        if (sql.includes('admin_permission_grants')) {
          return { rows: hasManageSupport ? [{}] : [] };
        }
        return { rows: [] };
      }),
    };
  }

  test('(a) super_admin without a grant is denied', async () => {
    const pool = mockPool({ grantState: 'none' });
    await expect(
      resolveGuestChatAdminAccess({ pool, userId: 'su1', userRole: 'super_admin' })
    ).resolves.toEqual({ allowed: false, grant: null });
  });

  test('(b) super_admin with an active investigation grant is allowed', async () => {
    const pool = mockPool({ grantState: 'active' });
    await expect(
      resolveGuestChatAdminAccess({ pool, userId: 'su1', userRole: 'super_admin' })
    ).resolves.toEqual({ allowed: true, grant: ACTIVE_GRANT });
  });

  test('(c) super_admin with an expired or revoked grant is denied', async () => {
    for (const grantState of ['expired', 'revoked']) {
      const pool = mockPool({ grantState });
      await expect(
        resolveGuestChatAdminAccess({ pool, userId: 'su1', userRole: 'super_admin' })
      ).resolves.toEqual({ allowed: false, grant: null });
    }
  });

  test('admin with a live manage_support grant is allowed (REST parity)', async () => {
    const pool = mockPool({ hasManageSupport: true });
    await expect(
      resolveGuestChatAdminAccess({ pool, userId: 'a1', userRole: 'admin' })
    ).resolves.toEqual({ allowed: true, grant: null });
  });

  test('admin without manage_support is denied', async () => {
    const pool = mockPool({ hasManageSupport: false });
    await expect(
      resolveGuestChatAdminAccess({ pool, userId: 'a1', userRole: 'admin' })
    ).resolves.toEqual({ allowed: false, grant: null });
  });

  test('non-admin roles are denied', async () => {
    const pool = mockPool({ grantState: 'active', hasManageSupport: true });
    await expect(
      resolveGuestChatAdminAccess({ pool, userId: 'h1', userRole: 'helper' })
    ).resolves.toEqual({ allowed: false, grant: null });
  });
});

describe('guest_chat_admin room membership (socket)', () => {
  let httpServer;
  let chat;
  let baseUrl;
  const clients = [];
  // userId -> { role, grantState: 'active'|'expired'|'revoked'|'none', manageSupport: bool }
  let users = {};
  let auditLog;

  beforeAll((done) => {
    const pool = {
      query: jest.fn(async (sql, params) => {
        if (sql.includes('FROM users')) {
          const u = users[params[0]] || { role: 'customer' };
          return { rows: [{ is_active: true, role: u.role, logistics_role: null }] };
        }
        if (sql.includes('investigation_access_grants')) {
          const u = users[params[0]];
          return { rows: u && u.grantState === 'active' ? [ACTIVE_GRANT] : [] };
        }
        if (sql.includes('admin_permission_grants')) {
          const u = users[params[0]];
          return { rows: u && u.manageSupport ? [{}] : [] };
        }
        return { rows: [] };
      }),
    };
    auditLog = jest.fn(async () => {});
    // Bypass JWT: install a lightweight authenticator that mirrors the real
    // one's post-auth socket fields.
    httpServer = http.createServer();
    const io = new Server(httpServer);
    chat = io.of('/chat');
    chat.use(async (socket, next) => {
      const u = users[socket.handshake.auth?.userId] || { role: 'customer' };
      socket.userId = socket.handshake.auth?.userId || 'anon';
      socket.userRole = u.role;
      socket.logisticsRole = null;
      next();
    });
    const socketService = {
      trackConnect: jest.fn(),
      trackDisconnect: jest.fn(),
      joinBusinessRooms: jest.fn(async () => []),
    };
    bindChatNamespace(chat, { pool, socketService, logger: silentLogger, auditLog });
    httpServer.listen(0, () => {
      baseUrl = `http://127.0.0.1:${httpServer.address().port}/chat`;
      done();
    });
  });

  afterAll((done) => {
    clients.forEach((c) => c.disconnect());
    httpServer.close(done);
  });

  beforeEach(() => {
    users = {};
    auditLog.mockClear();
  });

  async function receivesGuestChatAdminEvent(user) {
    const socket = await connect(baseUrl, user);
    clients.push(socket);
    const received = new Promise((resolve) => {
      socket.once('guest_chat:admin_ping', (payload) => resolve(payload));
      setTimeout(() => resolve(null), 500);
    });
    // Give the async room-join (grant check + audit write) a tick to complete.
    await new Promise((r) => setTimeout(r, 150));
    chat.to('guest_chat_admin').emit('guest_chat:admin_ping', { ping: true });
    return received;
  }

  test('(a) super_admin does NOT auto-join without an investigation grant', async () => {
    users = { su1: { role: 'super_admin', grantState: 'none' } };
    await expect(receivesGuestChatAdminEvent({ id: 'su1' })).resolves.toBeNull();
    expect(auditLog).not.toHaveBeenCalled();
  });

  test('(b)+(d) super_admin with an active grant joins and the join is audited', async () => {
    users = { su2: { role: 'super_admin', grantState: 'active' } };
    await expect(receivesGuestChatAdminEvent({ id: 'su2' })).resolves.toEqual({ ping: true });
    expect(auditLog).toHaveBeenCalledTimes(1);
    const entry = auditLog.mock.calls[0][0];
    expect(entry.action).toBe('guest_chat_admin_break_glass_join');
    expect(entry.adminId).toBe('su2');
    expect(entry.targetType).toBe('investigation_access_grant');
    expect(entry.after.grant_id).toBe(ACTIVE_GRANT.id);
    expect(entry.after.purpose).toBe(ACTIVE_GRANT.purpose);
    expect(entry.after.approver_admin_id).toBe(ACTIVE_GRANT.approver_admin_id);
    expect(entry.throwOnError).toBe(true);
  });

  test('(c) super_admin with an expired or revoked grant does not join', async () => {
    users = { su3: { role: 'super_admin', grantState: 'expired' } };
    await expect(receivesGuestChatAdminEvent({ id: 'su3' })).resolves.toBeNull();
    users = { su4: { role: 'super_admin', grantState: 'revoked' } };
    await expect(receivesGuestChatAdminEvent({ id: 'su4' })).resolves.toBeNull();
    expect(auditLog).not.toHaveBeenCalled();
  });

  test('audit failure fails closed: no join when the audit write throws', async () => {
    auditLog.mockRejectedValueOnce(new Error('audit DB unavailable'));
    users = { su5: { role: 'super_admin', grantState: 'active' } };
    await expect(receivesGuestChatAdminEvent({ id: 'su5' })).resolves.toBeNull();
  });

  test('admin with a live manage_support grant joins (REST parity)', async () => {
    users = { a1: { role: 'admin', manageSupport: true } };
    await expect(receivesGuestChatAdminEvent({ id: 'a1' })).resolves.toEqual({ ping: true });
    // Standing-grant joins are not break-glass: no investigation audit entry.
    expect(auditLog).not.toHaveBeenCalled();
  });

  test('admin without manage_support does not join', async () => {
    users = { a2: { role: 'admin', manageSupport: false } };
    await expect(receivesGuestChatAdminEvent({ id: 'a2' })).resolves.toBeNull();
  });
});
