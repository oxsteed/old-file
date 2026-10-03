'use strict';

/**
 * Minimal keep-alive HTTP(S) client for the scale harness.
 * Zero dependencies; measures latency from just before socket write to
 * the end of the response body.
 */

const http = require('http');
const https = require('https');

function createHttpClient({ timeoutMs = 15000, maxSockets = 256 } = {}) {
  const agents = {
    'http:': new http.Agent({ keepAlive: true, maxSockets }),
    'https:': new https.Agent({ keepAlive: true, maxSockets }),
  };

  function request({ method, url, headers = {}, body, timeout = timeoutMs }) {
    return new Promise((resolve) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const payload = body === undefined || body === null
        ? null
        : (Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
      const start = process.hrtime.bigint();
      const finish = (result) => {
        const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
        resolve({ ...result, latencyMs });
      };
      let req;
      try {
        req = lib.request(
          {
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port,
            path: `${parsed.pathname}${parsed.search}`,
            method,
            headers: {
              ...(payload && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}),
              ...(payload ? { 'content-length': payload.length } : {}),
              ...headers,
            },
            agent: agents[parsed.protocol] || agents['http:'],
          },
          (res) => {
            let bytes = 0;
            res.on('data', (chunk) => { bytes += chunk.length; });
            res.on('end', () => finish({ status: res.statusCode, bytes, ok: true }));
            res.on('error', (err) => finish({ status: 0, bytes, ok: false, errorKind: 'response-error', error: err.message }));
          },
        );
      } catch (err) {
        finish({ status: 0, bytes: 0, ok: false, errorKind: 'request-build-error', error: err.message });
        return;
      }
      req.setTimeout(timeout, () => {
        req.destroy(new Error(`request timeout after ${timeout}ms`));
      });
      req.on('timeout', () => {});
      req.on('error', (err) => {
        const kind = /timeout/i.test(err.message) ? 'timeout' : 'connection-error';
        finish({ status: 0, bytes: 0, ok: false, errorKind: kind, error: err.message });
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  function close() {
    agents['http:'].destroy();
    agents['https:'].destroy();
  }

  return { request, close };
}

/**
 * Build a multipart/form-data body with a synthetic buffer payload.
 * Used by the upload scenario; never reads user files.
 */
function buildMultipart({ field, filename, bytes, boundary }) {
  const b = boundary || `----scaleharness${Date.now().toString(16)}`;
  const head = Buffer.from(
    `--${b}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`,
  );
  // Deterministic-ish payload: repeating pattern, cheap to generate.
  const payload = Buffer.alloc(bytes, 0x89);
  const tail = Buffer.from(`\r\n--${b}--\r\n`);
  return {
    body: Buffer.concat([head, payload, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${b}` },
  };
}

module.exports = { createHttpClient, buildMultipart };
