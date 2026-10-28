'use strict';
const { createDrainablePoller } = require('../utils/drainablePoller');
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('stops ticks immediately, waits for the active pass, and refuses restart while draining', async () => {
  let release, context;
  const run = jest.fn(options => { context=options;return new Promise(resolve=>{release=resolve;}); });
  const poller = createDrainablePoller({run});
  expect(poller.start({intervalMs:100})).toBe(true);
  await flush();
  jest.advanceTimersByTime(500);
  expect(run).toHaveBeenCalledTimes(1);
  let drained=false;
  const stopping=poller.stop();stopping.then(()=>{drained=true;});
  expect(poller.stop()).toBe(stopping);
  expect(context.isStopping()).toBe(true);
  expect(poller.start({intervalMs:100})).toBe(false);
  jest.advanceTimersByTime(1000);await flush();
  expect(drained).toBe(false);
  expect(run).toHaveBeenCalledTimes(1);
  release();await stopping;
  expect(drained).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
  expect(poller.start({intervalMs:100,initialDelayMs:1000})).toBe(true);
  await poller.stop();
});

test('shutdown cancels a delayed first pass and a queued-but-not-started tick', async () => {
  const run=jest.fn();const poller=createDrainablePoller({run});
  poller.start({intervalMs:100,initialDelayMs:1000});
  await poller.stop();jest.advanceTimersByTime(2000);await flush();
  expect(run).not.toHaveBeenCalled();
  poller.start({intervalMs:100});
  await poller.stop();
  expect(run).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('a failed pass is reported and settles before stop completes', async () => {
  const error=new Error('synthetic failure'),onError=jest.fn();
  const poller=createDrainablePoller({run:async()=>{throw error;},onError});
  poller.start({intervalMs:100});await flush();await poller.stop();
  expect(onError).toHaveBeenCalledWith(error);
  expect(jest.getTimerCount()).toBe(0);
});

test('rejects invalid timer durations instead of entering a hot polling loop', () => {
  for (const intervalMs of [0,-1,Infinity,2147483648]) {
    expect(()=>createDrainablePoller({run:jest.fn()}).start({intervalMs})).toThrow(TypeError);
  }
});
