'use strict';

const net = require('net');

const DEFAULT_PORT = 3310;
const DEFAULT_TIMEOUT_MS = 5000;
const CHUNK_SIZE = 64 * 1024;

function scannerConfig() {
  const host = String(process.env.CLAMAV_HOST || '').trim();
  if (!host) return null;
  const port = Number.parseInt(process.env.CLAMAV_PORT, 10) || DEFAULT_PORT;
  const timeoutMs = Number.parseInt(process.env.CLAMAV_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS;
  return { host, port, timeoutMs: Math.min(Math.max(timeoutMs, 1000), 15000) };
}

/**
 * Scan an upload with clamd's INSTREAM protocol when configured. Static
 * extension and magic-byte checks remain the baseline when no scanner is
 * configured, but a configured scanner fails closed on connection errors.
 */
function scanBuffer(buffer) {
  const config = scannerConfig();
  if (!config) return Promise.resolve({ clean: true, skipped: true, provider: 'static' });
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return Promise.reject(new Error('A non-empty upload buffer is required for malware scanning'));
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: config.port });
    let response = '';
    let settled = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };

    socket.setTimeout(config.timeoutMs, () => {
      finish(new Error('Malware scanner timed out'));
    });
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
      if (/FOUND/i.test(response)) {
        finish(null, { clean: false, skipped: false, provider: 'clamav' });
      } else if (/\bOK\b/i.test(response)) {
        finish(null, { clean: true, skipped: false, provider: 'clamav' });
      }
    });
    socket.on('error', (error) => finish(error));
    socket.on('close', () => {
      if (!settled) finish(new Error('Malware scanner closed before returning a result'));
    });

    socket.on('connect', () => {
      socket.write(Buffer.from('zINSTREAM\\0'));
      for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
        const chunk = buffer.subarray(offset, Math.min(offset + CHUNK_SIZE, buffer.length));
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length, 0);
        socket.write(length);
        socket.write(chunk);
      }
      const end = Buffer.alloc(4);
      socket.write(end);
    });
  });
}

function isConfigured() {
  return Boolean(scannerConfig());
}

module.exports = { scanBuffer, isConfigured };
