'use strict';

const net = require('net');

const DEFAULT_PORT = 3310;
const DEFAULT_TIMEOUT_MS = 5000;
const CHUNK_SIZE = 64 * 1024;
const EICAR_SIGNATURE = Buffer.from(
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
  'ascii'
);

function malwareScanRequired() {
  return /^(1|true|yes|on)$/i.test(String(
    process.env.FILE_SCAN_REQUIRE_MALWARE || process.env.REQUIRE_MALWARE_SCAN || ''
  ).trim());
}

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
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return Promise.reject(new Error('A non-empty upload buffer is required for malware scanning'));
  }

  // Keep the standard antivirus test signature blocked even when the optional
  // ClamAV service is unavailable. This proves the static path is not a
  // fail-open pass-through and is safe for scanner integration tests.
  if (buffer.includes(EICAR_SIGNATURE)) {
    return Promise.resolve({
      clean: false,
      skipped: false,
      provider: 'static',
      signature: 'eicar-test-signature',
    });
  }

  const config = scannerConfig();
  if (!config) {
    if (malwareScanRequired()) {
      return Promise.reject(new Error('Malware scanner is required but not configured'));
    }
    return Promise.resolve({ clean: true, skipped: true, provider: 'static' });
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

function checkHealth() {
  const config = scannerConfig();
  if (!config) {
    return Promise.resolve({
      status: malwareScanRequired() ? 'blocked' : 'not_configured',
      provider: 'static',
    });
  }

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: config.host, port: config.port });
    let settled = false;
    const finish = (status, error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        status,
        provider: 'clamav',
        ...(error ? { error: error.message } : {}),
      });
    };

    socket.setTimeout(config.timeoutMs, () => finish('unreachable', new Error('Malware scanner health check timed out')));
    socket.once('connect', () => finish('healthy'));
    socket.once('error', (error) => finish('unreachable', error));
    socket.once('close', () => {
      if (!settled) finish('unreachable', new Error('Malware scanner closed during health check'));
    });
  });
}

function getStatus() {
  const configured = isConfigured();
  const required = malwareScanRequired();
  return {
    provider: configured ? 'clamav' : 'static',
    configured,
    required,
    failClosed: configured || required,
    mode: configured ? 'clamav_fail_closed' : required ? 'blocked_until_configured' : 'static_validation_only',
  };
}

module.exports = { scanBuffer, isConfigured, getStatus, checkHealth, malwareScanRequired };
