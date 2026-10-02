'use strict';

/**
 * E02 — Shared realtime adapter + presence contract.
 *
 * Failing reproduction: the support websocket service routes customer/agent
 * notifications through process-local socket-id Maps. Across processes those
 * maps are empty, so messages are silently dropped. The contract we need:
 *   1. customer:join / agent:join subscribe sockets to per-user / per-agent
 *      rooms so `notifyCustomer` / `notifyAgent` emit to rooms (adapter-safe).
 *   2. Agent presence is visible cross-process through a shared presence
 *      contract (Redis-backed when available), not only the local Map.
 *   3. Delivery is fail-closed: notify* returns false and logs loudly when
 *      the realtime layer is not healthy, instead of silently dropping.
 */

const presence = require('../services/realtimePresence');
const supportService = require('../services/websocketService');

function makeNamespace() {
  const handlers = {};
  const emitted = [];
  const namespace = {
    on: jest.fn((event, handler) => { handlers[event] = handler; }),
    to: jest.fn((room) => ({
      emit: jest.fn((event, data) => emitted.push({ room, event, data })),
    })),
    _handlers: handlers,
    _emitted: emitted,
  };
  return namespace;
}

function makeSocket(overrides = {}) {
  const handlers = {};
  return {
    id: 'socket-1',
    data: {},
    rooms: new Set(),
    connected: true,
    userId: 'user-1',
    userRole: 'customer',
    join: jest.fn(function (room) { this.rooms.add(room); }),
    leave: jest.fn(),
    on: jest.fn((event, handler) => { handlers[event] = handler; }),
    emit: jest.fn(),
    _handlers: handlers,
    ...overrides,
  };
}

beforeEach(() => {
  presence._resetForTests();
  supportService.shutdown();
});

afterEach(() => {
  supportService.shutdown();
  presence._resetForTests();
});

describe('E02 room-based routing (no socket-id maps)', () => {
  test('customer:join subscribes the socket to the per-user room', () => {
    const namespace = makeNamespace();
    supportService.initialize(namespace);

    const socket = makeSocket();
    namespace._handlers.connection(socket);
    socket._handlers['customer:join']({ visitorName: 'Test' });

    expect(socket.join).toHaveBeenCalledWith('user:user-1');
  });

  test('notifyCustomer emits to the per-user room, not a socket id', () => {
    const namespace = makeNamespace();
    supportService.initialize(namespace);

    const delivered = supportService.notifyCustomer('user-1', 'support:test', { ok: true });

    expect(delivered).toBe(true);
    expect(namespace.to).toHaveBeenCalledWith('user:user-1');
    expect(namespace._emitted).toContainEqual({
      room: 'user:user-1', event: 'support:test', data: { ok: true },
    });
  });

  test('notifyAgent emits to the per-agent room, not socket ids', () => {
    const namespace = makeNamespace();
    supportService.initialize(namespace);

    const delivered = supportService.notifyAgent('agent-9', 'ticket:new-assignment', { id: 1 });

    expect(delivered).toBe(true);
    expect(namespace.to).toHaveBeenCalledWith('agent:agent-9');
  });
});

describe('E02 cross-process presence contract', () => {
  function makeFakeRedis() {
    const hashes = new Map(); // key -> Map(field -> value)
    const ttls = new Map();
    return {
      _hashes: hashes,
      hset: jest.fn(async (key, field, value) => {
        if (!hashes.has(key)) hashes.set(key, new Map());
        hashes.get(key).set(String(field), String(value));
        return 1;
      }),
      expire: jest.fn(async (key, ttl) => { ttls.set(key, ttl); return 1; }),
      hdel: jest.fn(async (key, field) => {
        const h = hashes.get(key);
        if (!h) return 0;
        const deleted = h.delete(String(field)) ? 1 : 0;
        if (h.size === 0) hashes.delete(key);
        return deleted;
      }),
      scan: jest.fn(async (cursor, ...args) => {
        const matchIdx = args.indexOf('MATCH');
        const pattern = matchIdx >= 0 ? args[matchIdx + 1] : '*';
        const prefix = pattern.replace(/\*$/, '');
        const keys = [...hashes.keys()].filter((k) => k.startsWith(prefix));
        return ['0', keys];
      }),
    };
  }

  test('agent presence set in one process is visible to another', async () => {
    const redis = makeFakeRedis();
    presence._injectRedis(redis);

    // "Process A": agent comes online.
    await presence.markOnline('agent', 'agent-1');

    // "Process B": local registry is empty, but the shared contract sees it.
    presence._clearLocal();
    await presence.refreshSnapshot();

    expect(presence.isOnline('agent', 'agent-1')).toBe(true);
    expect(redis.hset).toHaveBeenCalled();
  });

  test('agent going offline in its owning process disappears from the contract', async () => {
    const redis = makeFakeRedis();
    presence._injectRedis(redis);

    await presence.markOnline('agent', 'agent-1');
    await presence.markOffline('agent', 'agent-1');
    presence._clearLocal();
    await presence.refreshSnapshot();

    expect(presence.isOnline('agent', 'agent-1')).toBe(false);
  });

  test('service-level isAgentOnline reflects the shared contract', async () => {
    const namespace = makeNamespace();
    supportService.initialize(namespace);
    const redis = makeFakeRedis();
    presence._injectRedis(redis);

    await presence.markOnline('agent', 'agent-remote');
    presence._clearLocal();
    await presence.refreshSnapshot();

    expect(supportService.isAgentOnline('agent-remote')).toBe(true);
  });
});

describe('E02 fail-closed delivery', () => {
  test('notifyCustomer returns false when the realtime layer is unhealthy', () => {
    const namespace = makeNamespace();
    supportService.initialize(namespace);
    supportService.setRealtimeHealth(false);

    const delivered = supportService.notifyCustomer('user-1', 'support:test', { ok: true });

    expect(delivered).toBe(false);
    expect(namespace.to).not.toHaveBeenCalled();
  });

  test('notifyCustomer returns false when the service is not initialized', () => {
    const delivered = supportService.notifyCustomer('user-1', 'support:test', { ok: true });
    expect(delivered).toBe(false);
  });
});
