'use strict';

const { EventEmitter } = require('node:events');
jest.mock('@socket.io/redis-adapter', () => ({ createAdapter: jest.fn(() => 'synthetic-shared-adapter') }));
const Redis = require('ioredis');
const { attachSharedAdapter } = require('../bootstrap/realtime');
const runtimeState = require('../services/runtimeState');

describe('shared realtime readiness during web replacement', () => {
  const originalRedis = process.env.REDIS_URL;
  let clients;
  beforeEach(() => {
    runtimeState.reset();
    process.env.REDIS_URL = 'redis://synthetic';
    clients = [];
    Redis.mockImplementation(() => {
      const client = new EventEmitter();
      client.status = 'connecting';
      client.ping = jest.fn(() => new Promise((resolve, reject) => {
        client.succeed = () => { client.status = 'ready'; client.emit('ready'); resolve('PONG'); };
        client.fail = reject;
      }));
      clients.push(client);
      return client;
    });
  });
  afterEach(() => {
    if (originalRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = originalRedis;
  });
  function attach() {
    const io = { adapter: jest.fn() };
    const supportService = { setRealtimeHealth: jest.fn() };
    const adapter = attachSharedAdapter(io, { supportService, log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } });
    return { io, supportService, adapter };
  }
  test('waits for both clients and adapter installation; one reconnect cannot restore health early', async () => {
    const { io, adapter } = attach();
    clients[0].succeed();
    await Promise.resolve();
    expect(io.adapter).not.toHaveBeenCalled();
    expect(runtimeState.snapshot().realtimeReady).toBe(false);
    clients[1].succeed();
    expect(await adapter.ready()).toBe(true);
    expect(io.adapter).toHaveBeenCalledWith('synthetic-shared-adapter');
    clients[1].status = 'reconnecting'; clients[1].emit('reconnecting');
    clients[0].emit('ready');
    expect(await adapter.ready()).toBe(false);
    expect(runtimeState.snapshot().realtimeReady).toBe(false);
    clients[1].status = 'ready'; clients[1].emit('ready');
    expect(await adapter.ready()).toBe(true);
    adapter.stop();
    clients[0].emit('ready');
    expect(await adapter.ready()).toBe(false);
    expect(runtimeState.snapshot().realtimeReady).toBe(false);
  });
  test('failed initial attachment never allows traffic readiness', async () => {
    const { adapter, io } = attach();
    clients[0].succeed(); clients[1].fail(new Error('Synthetic connection failure'));
    expect(await adapter.ready()).toBe(false);
    expect(io.adapter).not.toHaveBeenCalled();
    expect(runtimeState.snapshot().realtimeReady).toBe(false);
  });
});
