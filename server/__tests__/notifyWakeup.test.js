'use strict';

// The last subscriber to hang up must end the dedicated LISTEN client.
// CI runs Jest with --detectOpenHandles and no --forceExit, so a leftover
// pg Client keeps the regression job running until the 45-minute timeout
// after every test has already passed (PR #709 CI run 42735231336).

const flush = async () => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

describe('notify wakeup idle close', () => {
  let subscribe;
  let stop;
  let getStatus;
  let Client;
  let mockConnect;
  let mockQuery;
  let mockEnd;

  beforeEach(() => {
    jest.resetModules();
    mockConnect = jest.fn().mockResolvedValue(undefined);
    mockQuery = jest.fn().mockResolvedValue({ rows: [] });
    mockEnd = jest.fn().mockResolvedValue(undefined);
    const mockOn = jest.fn();
    jest.doMock('pg', () => {
      const MockClient = jest.fn().mockImplementation(() => ({
        connect: mockConnect,
        query: mockQuery,
        end: mockEnd,
        on: mockOn,
        removeListener: jest.fn(),
      }));
      return { Client: MockClient, Pool: jest.fn() };
    });
    jest.doMock('../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
    process.env.DATABASE_URL = 'postgresql://oxsteed:x@127.0.0.1:5432/credit_statement_test';
    ({ Client } = require('pg'));
    ({ subscribe, stop, getStatus } = require('../utils/notifyWakeup'));
  });

  afterEach(async () => {
    if (stop) await stop();
    jest.dontMock('pg');
    jest.dontMock('../utils/logger');
  });

  test('the last unsubscribe ends the dedicated LISTEN client', async () => {
    const first = subscribe('oxsteed_screen_events', jest.fn());
    const second = subscribe('oxsteed_activity_outbox', jest.fn());
    await flush();

    expect(Client).toHaveBeenCalledTimes(1);
    expect(getStatus()).toMatchObject({
      connected: true,
      connecting: false,
    });
    expect(getStatus().channels.sort()).toEqual([
      'oxsteed_activity_outbox',
      'oxsteed_screen_events',
    ]);
    expect(mockEnd).not.toHaveBeenCalled();

    first();
    await flush();
    expect(mockEnd).not.toHaveBeenCalled();
    expect(getStatus()).toMatchObject({
      connected: true,
      channels: ['oxsteed_activity_outbox'],
    });

    second();
    await flush();
    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(getStatus()).toEqual({
      connected: false,
      connecting: false,
      channels: [],
    });
  });

  test('unsubscribing while connect is still in flight ends the client once it opens', async () => {
    let release;
    mockConnect.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    const unsub = subscribe('oxsteed_screen_events', jest.fn());
    await flush();
    expect(getStatus()).toMatchObject({ connected: false, connecting: true });
    expect(mockEnd).not.toHaveBeenCalled();

    unsub();
    expect(getStatus().channels).toEqual([]);
    release();
    await flush();

    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(getStatus()).toEqual({
      connected: false,
      connecting: false,
      channels: [],
    });
  });
});
