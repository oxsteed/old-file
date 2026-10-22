'use strict';

const net = require('net');
const { buildReceipt, encodeText, init, feed, cut, textLine, bold } = require('./escposPrinter');

const MAX_JOB_BYTES = 512 * 1024;
const DEFAULT_POLL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 5000;

function positiveInt(value, field) {
  const number = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${field} must be a positive integer`);
  return number;
}

function printerPort(value) {
  const port = positiveInt(value, 'printerPort');
  if (port > 65535) throw new Error('printerPort must be between 1 and 65535');
  return port;
}

function normalizePrinterHost(value) {
  const host = String(value || '').trim();
  if (!host || host.length > 255) throw new Error('printerHost is required');
  // A bridge must print only to its explicitly configured in-store target.
  // Hostnames are accepted for mDNS/local DNS; the API validates persisted
  // printer settings before a job reaches this process.
  if (/\s/.test(host)) throw new Error('printerHost is invalid');
  return host;
}

function normalizeConfig(input = {}) {
  const baseUrl = String(input.baseUrl || '').trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('baseUrl must be an HTTP(S) URL');
  const token = String(input.deviceToken || '').trim();
  if (!token || token.length > 200) throw new Error('deviceToken is required');
  return Object.freeze({
    baseUrl,
    restaurantId: positiveInt(input.restaurantId, 'restaurantId'),
    deviceId: positiveInt(input.deviceId, 'deviceId'),
    deviceToken: token,
    printerHost: normalizePrinterHost(input.printerHost),
    printerPort: printerPort(input.printerPort || 9100),
    pollMs: Math.max(500, Math.min(60000, Number.parseInt(input.pollMs, 10) || DEFAULT_POLL_MS)),
    timeoutMs: Math.max(1000, Math.min(30000, Number.parseInt(input.timeoutMs, 10) || DEFAULT_TIMEOUT_MS)),
    maxJobs: Math.max(1, Math.min(20, Number.parseInt(input.maxJobs, 10) || 5)),
  });
}

function renderKitchenTicket(payload = {}) {
  const order = payload.order || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const itemLines = items.map((item) => ({
    qty: item.quantity || 0,
    name: item.name || 'Item',
    amount: item.specialInstructions ? `\n  ${item.specialInstructions}` : '',
  }));
  return buildReceipt({
    headerLines: [payload.stationName || 'KITCHEN'],
    metaLines: [
      `Order #${order.id || '—'}`,
      order.queueNumber ? `Queue ${order.queueNumber}` : '',
      order.fulfillmentType || '',
      order.tableLabel ? `Table: ${order.tableLabel}` : '',
      order.guestName ? `Guest: ${order.guestName}` : '',
      order.notes ? `Notes: ${order.notes}` : '',
    ].filter(Boolean),
    items: itemLines,
    totals: [],
    footerLines: ['Kitchen ticket', 'Do not discard until fulfilled.'],
    kickDrawer: false,
  });
}

function renderStructuredJob(job) {
  const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
  if (typeof payload.escpos_base64 === 'string' && payload.escpos_base64.length > 0) {
    const buffer = Buffer.from(payload.escpos_base64, 'base64');
    if (!buffer.length || buffer.length > MAX_JOB_BYTES) throw new Error('printer payload is invalid');
    return { buffer, target: payload.printer || null };
  }
  if (job?.job_type === 'kitchen_ticket' || payload.order || payload.items) {
    const buffer = renderKitchenTicket(payload);
    if (buffer.length > MAX_JOB_BYTES) throw new Error('kitchen ticket is too large');
    return { buffer, target: null };
  }
  throw new Error('unsupported printer job payload');
}

function assertTarget(target, config) {
  if (!target) return;
  const host = normalizePrinterHost(target.host);
  const port = printerPort(target.port);
  if (host !== config.printerHost || port !== config.printerPort) {
    throw new Error('printer target does not match the bridge configuration');
  }
}

function printBuffer(host, port, buffer, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish({ ok: false, error: 'printer_timeout' }));
    socket.once('error', () => finish({ ok: false, error: 'printer_unreachable' }));
    socket.connect(port, host, () => {
      socket.end(buffer, (error) => finish(error ? { ok: false, error: 'printer_write_failed' } : { ok: true }));
    });
  });
}

function bridgeApi(config, fetchImpl = fetch) {
  const root = `${config.baseUrl}/api/restaurants/${config.restaurantId}/devices/${config.deviceId}`;
  const request = async (path, options = {}) => {
    const response = await fetchImpl(`${root}${path}`, {
      ...options,
      headers: { Accept: 'application/json', 'X-Device-Token': config.deviceToken, ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.code || body?.code || `bridge_http_${response.status}`);
    return body;
  };
  return {
    list: () => request('/printer-jobs?status=queued'),
    claim: (jobId) => request(`/printer-jobs/${encodeURIComponent(jobId)}/claim`, { method: 'POST', body: JSON.stringify({}) }),
    update: (jobId, status, errorMessage = null) => request(`/printer-jobs/${encodeURIComponent(jobId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, errorMessage }),
    }),
  };
}

async function runBridgeOnce(configInput, { api, print = printBuffer, logger = () => {} } = {}) {
  const config = normalizeConfig(configInput);
  const client = api || bridgeApi(config);
  const listed = await client.list();
  const jobs = Array.isArray(listed?.jobs) ? listed.jobs.slice(0, config.maxJobs) : [];
  let printed = 0;
  let failed = 0;
  for (const listedJob of jobs) {
    let job;
    try {
      job = (await client.claim(listedJob.id))?.job;
      if (!job) throw new Error('printer_job_missing');
      const rendered = renderStructuredJob(job);
      assertTarget(rendered.target, config);
      const result = await print(config.printerHost, config.printerPort, rendered.buffer, { timeoutMs: config.timeoutMs });
      if (!result?.ok) throw new Error(result?.error || 'printer_unreachable');
      await client.update(job.id, 'printed');
      printed += 1;
    } catch (error) {
      failed += 1;
      const message = String(error?.message || 'bridge_print_failed').slice(0, 200);
      logger({ event: 'printer_job_failed', jobId: job?.id || listedJob?.id, error: message });
      if (job?.id) await client.update(job.id, 'failed', message).catch(() => {});
    }
  }
  return { claimed: jobs.length, printed, failed };
}

module.exports = {
  MAX_JOB_BYTES, DEFAULT_POLL_MS, DEFAULT_TIMEOUT_MS,
  normalizeConfig, normalizePrinterHost, renderKitchenTicket, renderStructuredJob,
  assertTarget, printBuffer, bridgeApi, runBridgeOnce,
};
