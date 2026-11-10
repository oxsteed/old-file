'use strict';

/**
 * F-12 regression: business realtime rooms are permission-scoped, carry
 * identifiers only, and a removed member is evicted from them.
 */

const mockQuery = jest.fn();
jest.mock('../db', () => ({ query: (...a) => mockQuery(...a) }));
jest.mock('../services/realtimePresence', () => ({
  markOnline: jest.fn().mockResolvedValue(),
  markOffline: jest.fn().mockResolvedValue(),
}));

const mockAccess = new Map(); // `${bid}|${uid}` -> { role, perms }
jest.mock('../services/scopeModel', () => ({
  resolveBusinessAccess: jest.fn(async (userId, businessId) => {
    const hit = mockAccess.get(`${businessId}|${userId}`);
    if (!hit) return null;
    return { id: Number(businessId), effective_role: hit.role, membership_id: 7, is_active: true };
  }),
}));
jest.mock('../services/permissionsService', () => ({
  getEffectivePermissions: jest.fn(async ({ businessId, userId }) => {
    const hit = mockAccess.get(`${businessId}|${userId}`);
    return { permissions: new Set(hit ? hit.perms : []) };
  }),
}));

// setup.js mocks socketService globally; this suite tests the real module.
const socketService = jest.requireActual('../services/socketService');

function fakeSocket(id, userId) {
  const rooms = new Set([id, `user_${userId}`]);
  return {
    id,
    rooms,
    join: jest.fn((r) => rooms.add(r)),
    leave: jest.fn((r) => rooms.delete(r)),
    on: jest.fn(),
  };
}

function fakeIo(sockets) {
  const emits = [];
  const op = (rooms) => {
    const list = Array.isArray(rooms) ? rooms : [rooms];
    const state = { rooms: list, except: null };
    const api = {
      except(id) { state.except = id; return api; },
      emit(event, payload) { emits.push({ rooms: state.rooms, except: state.except, event, payload }); },
      fetchSockets: async () => sockets.filter((s) => list.some((r) => s.rooms.has(r))),
    };
    return api;
  };
  return { to: op, in: op, emits };
}

const MANAGER = ['business.view', 'messages.view_all', 'calendar.view_all', 'orders.view'];
const ASSIGNED_AGENT = ['business.view', 'messages.view_assigned'];
const KITCHEN = ['kitchen.view'];

let io;
let sockets;

beforeAll(() => {
  sockets = [];
  io = fakeIo(sockets);
  socketService.init(io);
});

beforeEach(() => {
  mockQuery.mockReset();
  mockAccess.clear();
  sockets.length = 0;
  io.emits.length = 0;
  mockQuery.mockImplementation(async (sql, params) => {
    if (/FROM businesses b WHERE b.user_id/.test(sql)) {
      const uid = params[0];
      const ids = [...mockAccess.keys()].filter((k) => k.endsWith(`|${uid}`)).map((k) => Number(k.split('|')[0]));
      return { rows: ids.map((id) => ({ id })) };
    }
    if (/FROM business_conversations/.test(sql)) {
      return { rows: [{ assigned_to_user_id: 'agent-1', conversation_type: 'customer' }] };
    }
    return { rows: [] };
  });
});

describe('F-12 room joins follow permissions', () => {
  test('an assigned-only agent does not join the full inbox, orders or calendar rooms', async () => {
    mockAccess.set('5|agent-1', { role: 'support_agent', perms: ASSIGNED_AGENT });
    const s = fakeSocket('s1', 'agent-1');
    await socketService.joinBusinessRooms(s, 'agent-1');
    expect(s.rooms.has('business_5_inbox')).toBe(false);
    expect(s.rooms.has('business_5_inbox_team')).toBe(true);
    expect(s.rooms.has('business_5_calendar')).toBe(false);
    expect(s.rooms.has('business_5_orders')).toBe(false);
  });

  test('a manager joins inbox, calendar and orders', async () => {
    mockAccess.set('5|mgr', { role: 'manager', perms: MANAGER });
    const s = fakeSocket('s2', 'mgr');
    const ids = await socketService.joinBusinessRooms(s, 'mgr');
    expect(ids).toEqual([5]);
    for (const r of ['business_5_inbox', 'business_5_inbox_team', 'business_5_calendar', 'business_5_orders']) {
      expect(s.rooms.has(r)).toBe(true);
    }
  });

  test('kitchen staff get the orders room only', async () => {
    mockAccess.set('5|cook', { role: 'employee', perms: KITCHEN });
    const s = fakeSocket('s3', 'cook');
    await socketService.joinBusinessRooms(s, 'cook');
    expect([...s.rooms].filter((r) => r.startsWith('business_'))).toEqual(['business_5_orders']);
  });

  test('a member with no message/order/calendar permission joins nothing', async () => {
    mockAccess.set('5|emp', { role: 'employee', perms: ['business.view'] });
    const s = fakeSocket('s4', 'emp');
    const ids = await socketService.joinBusinessRooms(s, 'emp');
    expect(ids).toEqual([]);
    expect([...s.rooms].some((r) => r.startsWith('business_'))).toBe(false);
  });
});

describe('F-12 eviction', () => {
  test('refreshUserBusinessRooms removes a revoked member from every business room', async () => {
    mockAccess.set('5|mgr', { role: 'manager', perms: MANAGER });
    const s = fakeSocket('s5', 'mgr');
    sockets.push(s);
    await socketService.joinBusinessRooms(s, 'mgr');
    expect(s.rooms.has('business_5_inbox')).toBe(true);

    mockAccess.delete('5|mgr'); // membership revoked
    await socketService.refreshUserBusinessRooms('mgr');
    expect([...s.rooms].some((r) => r.startsWith('business_'))).toBe(false);
    expect(s.rooms.has('user_mgr')).toBe(true);
  });

  test('a removed permission override drops only that room', async () => {
    mockAccess.set('5|mgr', { role: 'manager', perms: MANAGER });
    const s = fakeSocket('s6', 'mgr');
    sockets.push(s);
    await socketService.joinBusinessRooms(s, 'mgr');
    mockAccess.set('5|mgr', { role: 'manager', perms: MANAGER.filter((p) => p !== 'messages.view_all') });
    await socketService.refreshUserBusinessRooms('mgr');
    expect(s.rooms.has('business_5_inbox')).toBe(false);
    expect(s.rooms.has('business_5_orders')).toBe(true);
  });

  test('permissionsService.invalidateCache triggers the realtime refresh', () => {
    jest.isolateModules(() => {
      const refresh = jest.fn().mockResolvedValue(1);
      jest.doMock('../services/socketService', () => ({ refreshUserBusinessRooms: refresh, refreshBusinessRooms: jest.fn() }));
      jest.doMock('../utils/redis', () => null);
      const real = jest.requireActual('../services/permissionsService');
      real.invalidateCache(5, 'mgr');
      expect(refresh).toHaveBeenCalledWith('mgr');
    });
  });
});

describe('F-12 broadcasts carry identifiers only', () => {
  test('inbox message events drop content and names, and reach the assignee', async () => {
    await socketService.broadcastToBusinessInbox(5, 'business_inbox:message', {
      conversation_id: '11111111-1111-4111-8111-111111111111',
      message_id: 'm1',
      sender_id: 'u1',
      sender_name: 'Jane Customer',
      content: 'my card number is 4242…',
      customer_email: 'jane@example.com',
    });
    const e = io.emits.pop();
    expect(e.payload).toEqual({
      conversation_id: '11111111-1111-4111-8111-111111111111',
      message_id: 'm1',
      sender_id: 'u1',
      business_id: 5,
    });
    expect(e.rooms).toEqual(expect.arrayContaining(['business_5_inbox', 'user_agent-1']));
    expect(e.rooms).not.toContain('business_5_inbox_team');
  });

  test('order events go to the orders room as ids, never the order row', () => {
    socketService.broadcastToBusinessOrders(5, 'food:order:updated', {
      order: { id: 99, status: 'ready', customer_name: 'Jane', customer_phone: '+15555550100', total_cents: 1200 },
    });
    const e = io.emits.pop();
    expect(e.rooms).toEqual(['business_5_orders']);
    expect(e.payload).toEqual({ order_id: 99, order_status: 'ready' });
  });

  test('calendar events are reduced to identifiers', () => {
    socketService.broadcastToBusinessCalendar(5, 'booking:updated', {
      bookingId: 'b1', status: 'accepted', booking: { id: 'b1', customer_name: 'Jane', notes: 'gate code 1234' },
    });
    const e = io.emits.pop();
    expect(e.payload).toEqual({ bookingId: 'b1', status: 'accepted', booking_id: 'b1' });
  });
});

describe('F-12 typing relay', () => {
  test('an assigned-only agent cannot see an unassigned customer conversation', async () => {
    mockAccess.set('5|agent-2', { role: 'support_agent', perms: ASSIGNED_AGENT });
    await expect(socketService.canSeeBusinessConversation(5, 'agent-2', '11111111-1111-4111-8111-111111111111'))
      .resolves.toBe(false);
    mockAccess.set('5|agent-1', { role: 'support_agent', perms: ASSIGNED_AGENT });
    await expect(socketService.canSeeBusinessConversation(5, 'agent-1', '11111111-1111-4111-8111-111111111111'))
      .resolves.toBe(true);
  });

  test('non-members cannot relay typing', async () => {
    await expect(socketService.canSeeBusinessConversation(5, 'stranger', '11111111-1111-4111-8111-111111111111'))
      .resolves.toBe(false);
  });
});
