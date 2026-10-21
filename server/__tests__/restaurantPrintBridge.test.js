'use strict';

const bridge = require('../services/restaurantPrintBridge');

const config = {
  baseUrl: 'https://example.test', restaurantId: 3, deviceId: 8, deviceToken: 'device-token',
  printerHost: '192.168.1.20', printerPort: 9100, maxJobs: 5,
};

test('bridge configuration is bounded and does not accept missing targets', () => {
  expect(bridge.normalizeConfig(config)).toMatchObject({ restaurantId: 3, deviceId: 8, printerHost: '192.168.1.20', printerPort: 9100 });
  expect(() => bridge.normalizeConfig({ ...config, printerHost: 'bad host' })).toThrow(/printerHost/);
  expect(() => bridge.normalizeConfig({ ...config, printerPort: 65536 })).toThrow(/printerPort/);
  expect(() => bridge.normalizeConfig({ ...config, baseUrl: 'file:///tmp' })).toThrow(/baseUrl/);
});

test('receipt payloads are decoded with a bounded target check', () => {
  const payload = { escpos_base64: Buffer.from('ticket').toString('base64'), printer: { host: '192.168.1.20', port: 9100 } };
  const rendered = bridge.renderStructuredJob({ job_type: 'receipt', payload });
  expect(rendered.buffer.toString()).toBe('ticket');
  expect(() => bridge.assertTarget({ host: '10.0.0.7', port: 9100 }, bridge.normalizeConfig(config))).toThrow(/target/);
});

test('bridge claims, prints, and acknowledges jobs; failures remain retryable', async () => {
  const calls = [];
  const jobs = [
    { id: 41, job_type: 'receipt', payload: { escpos_base64: Buffer.from('ok').toString('base64'), printer: { host: '192.168.1.20', port: 9100 } } },
    { id: 42, job_type: 'receipt', payload: { escpos_base64: Buffer.from('bad').toString('base64'), printer: { host: '192.168.1.20', port: 9100 } } },
  ];
  const api = {
    list: async () => ({ jobs }),
    claim: async (id) => { calls.push(['claim', id]); return { job: jobs.find((job) => job.id === id) }; },
    update: async (id, status, error) => { calls.push(['update', id, status, error]); return {}; },
  };
  const result = await bridge.runBridgeOnce(config, {
    api,
    print: async (_host, _port, buffer) => ({ ok: buffer.toString() === 'ok' }),
  });
  expect(result).toEqual({ claimed: 2, printed: 1, failed: 1 });
  expect(calls.map((call) => call.slice(0, 3))).toEqual([
    ['claim', 41], ['update', 41, 'printed'], ['claim', 42], ['update', 42, 'failed'],
  ]);
});
