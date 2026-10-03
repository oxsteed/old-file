'use strict';

/**
 * Minimal WebSocket client for the websocket-fanout scale scenario.
 *
 * Speaks just enough of RFC 6455, Engine.IO v4 and Socket.IO v5 to open a
 * connection to the OxSteed realtime endpoint (/socket.io/), complete the
 * Socket.IO handshake on a namespace, answer Engine.IO pings, count
 * broadcasts, and close cleanly. Zero dependencies on purpose: the harness
 * must run from a bare checkout.
 */

const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const mask = crypto.randomBytes(4);
  const header = [0x80 | opcode];
  if (data.length < 126) {
    header.push(0x80 | data.length);
  } else if (data.length < 65536) {
    header.push(0x80 | 126, (data.length >> 8) & 0xff, data.length & 0xff);
  } else {
    header.push(0x80 | 127);
    const len = Buffer.alloc(8);
    len.writeBigUInt64BE(BigInt(data.length));
    header.push(...len);
  }
  const out = Buffer.concat([Buffer.from(header), mask, data]);
  for (let i = 0; i < data.length; i += 1) {
    out[header.length + 4 + i] = data[i] ^ mask[i % 4];
  }
  return out;
}

/**
 * Incremental frame parser for server-to-client frames (never masked).
 * Calls onFrame({ opcode, payload }) for each complete frame.
 */
function createFrameParser(onFrame) {
  let buffer = Buffer.alloc(0);
  return {
    push(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (buffer.length < 2) return;
        const b0 = buffer[0];
        const b1 = buffer[1];
        const opcode = b0 & 0x0f;
        let length = b1 & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          length = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        const masked = (b1 & 0x80) !== 0;
        if (masked) offset += 4; // tolerate, though servers must not mask
        if (buffer.length < offset + length) return;
        let payload = buffer.slice(offset, offset + length);
        if (masked) {
          const mask = buffer.slice(offset - 4, offset);
          const out = Buffer.alloc(payload.length);
          for (let i = 0; i < payload.length; i += 1) out[i] = payload[i] ^ mask[i % 4];
          payload = out;
        }
        buffer = buffer.slice(offset + length);
        onFrame({ opcode, payload });
      }
    },
  };
}

function once(emitter, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.removeListener(event, handler);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    const handler = (...args) => {
      clearTimeout(timer);
      resolve(args);
    };
    emitter.once(event, handler);
  });
}

/**
 * Connect to a Socket.IO endpoint over raw websocket transport.
 *
 * @param {string} targetUrl e.g. http://localhost:5000/socket.io/
 * @param {object} options { namespace, auth, timeoutMs, onEvent, onEnginePacket }
 * @returns {Promise<handle>} handle { emit, close, stats, connectLatencyMs }
 */
async function connectWs(targetUrl, options = {}) {
  const { namespace = '/', auth = null, timeoutMs = 15000, onEvent = () => {}, onEnginePacket = () => {} } = options;
  const parsed = new URL(targetUrl);
  const secure = parsed.protocol === 'https:' || parsed.protocol === 'wss:';
  const port = parsed.port ? Number(parsed.port) : (secure ? 443 : 80);
  const start = process.hrtime.bigint();

  const socket = secure
    ? tls.connect({ host: parsed.hostname, port, servername: parsed.hostname })
    : net.connect({ host: parsed.hostname, port });
  socket.setTimeout(timeoutMs);
  await once(socket, secure ? 'secureConnect' : 'connect', timeoutMs).catch(() => {
    socket.destroy();
    throw new Error('websocket TCP connect timed out');
  });

  const key = crypto.randomBytes(16).toString('base64');
  const wsPath = `${parsed.pathname}${parsed.pathname.includes('?') ? '&' : '?'}EIO=4&transport=websocket`;
  const handshake = [
    `GET ${wsPath} HTTP/1.1`,
    `Host: ${parsed.hostname}:${port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
    '',
    '',
  ].join('\r\n');
  socket.write(handshake);

  const head = await new Promise((resolve, reject) => {
    let acc = '';
    const timer = setTimeout(() => reject(new Error('websocket handshake timed out')), timeoutMs);
    const onData = (chunk) => {
      acc += chunk.toString('latin1');
      const idx = acc.indexOf('\r\n\r\n');
      if (idx !== -1) {
        clearTimeout(timer);
        socket.removeListener('data', onData);
        resolve({ header: acc.slice(0, idx), rest: Buffer.from(acc.slice(idx + 4), 'latin1') });
      }
    };
    socket.on('data', onData);
    socket.on('error', (err) => { clearTimeout(timer); reject(err); });
  }).catch((err) => {
    socket.destroy();
    throw err;
  });

  const statusLine = head.header.split('\r\n')[0] || '';
  const statusCode = Number((statusLine.match(/HTTP\/\d(?:\.\d)?\s+(\d+)/) || [])[1]);
  const accept = (head.header.match(/sec-websocket-accept:\s*(\S+)/i) || [])[1];
  if (statusCode !== 101 || accept !== acceptKey(key)) {
    socket.destroy();
    const err = new Error(`websocket upgrade failed (status ${statusCode || 'unknown'})`);
    err.statusCode = statusCode;
    throw err;
  }

  const stats = { pings: 0, pongs: 0, events: 0, connectLatencyMs: 0 };
  let open = true;
  let socketConnected = false;
  let connectError = null;
  const waiter = {};
  const waitersFor = (name) => {
    if (!waiter[name]) waiter[name] = [];
    return waiter[name];
  };
  const notify = (name, value) => {
    for (const fn of waitersFor(name)) fn(value);
    waiter[name] = [];
  };

  const send = (text) => {
    if (open) socket.write(encodeFrame(0x1, text));
  };

  const parser = createFrameParser(({ opcode, payload }) => {
    if (opcode === 0x8) {
      open = false;
      socket.end();
      notify('close');
      return;
    }
    if (opcode === 0x9) {
      socket.write(encodeFrame(0xa, payload));
      return;
    }
    if (opcode !== 0x1 && opcode !== 0x2) return;
    const text = payload.toString('utf8');
    if (!text) return;
    const engineType = text[0];
    const rest = text.slice(1);
    onEnginePacket(engineType, rest);
    if (engineType === '2') {
      stats.pings += 1;
      send('3');
      stats.pongs += 1;
    } else if (engineType === '4') {
      const sioType = rest[0];
      const sioRest = rest.slice(1);
      if (sioType === '0') {
        socketConnected = true;
        notify('sio-connect', sioRest);
      } else if (sioType === '4') {
        connectError = sioRest;
        notify('sio-connect-error', sioRest);
      } else if (sioType === '2') {
        stats.events += 1;
        try {
          const comma = sioRest.indexOf(',');
          const packet = comma === -1 ? sioRest : sioRest.slice(comma);
          const jsonStart = packet[0] === ',' ? 1 : 0;
          const parsedPacket = JSON.parse(packet.slice(jsonStart));
          onEvent(parsedPacket[0], parsedPacket.slice(1));
        } catch {
          onEvent('unparseable', [sioRest]);
        }
      } else if (sioType === '1') {
        open = false;
        socket.end();
        notify('close');
      }
    }
  });

  socket.on('data', (chunk) => {
    try {
      parser.push(chunk);
    } catch {
      // A malformed frame ends this connection attempt; surfaced as a close.
      open = false;
      socket.destroy();
      notify('close');
    }
  });
  socket.on('close', () => notify('close'));
  socket.on('error', () => notify('close'));
  if (head.rest.length) parser.push(head.rest);

  // Engine.IO open packet should arrive immediately; then Socket.IO connect.
  const nsPath = namespace === '/' ? '' : namespace;
  const authPart = auth ? JSON.stringify(auth) : '';
  const connectPacket = `40${nsPath},${authPart}`;
  const connectPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('socket.io connect timed out'));
    }, timeoutMs);
    waitersFor('sio-connect').push(() => { clearTimeout(timer); resolve(); });
    waitersFor('sio-connect-error').push((msg) => { clearTimeout(timer); reject(new Error(`socket.io connect rejected: ${msg}`)); });
    waitersFor('close').push(() => { clearTimeout(timer); reject(new Error('connection closed during socket.io handshake')); });
  });
  send(connectPacket);
  await connectPromise;
  socket.setTimeout(0); // handshake phases are over; holds are bounded by the scenario
  stats.connectLatencyMs = Number(process.hrtime.bigint() - start) / 1e6;

  return {
    stats,
    emit(event, data) {
      send(`42${nsPath},${JSON.stringify([event, data])}`);
    },
    close() {
      if (open) {
        open = false;
        try {
          send(`41${nsPath},`);
          socket.write(encodeFrame(0x8, ''));
        } catch { /* already gone */ }
        socket.end();
      }
    },
    get connected() {
      return open && socketConnected;
    },
    get connectError() {
      return connectError;
    },
  };
}

module.exports = { connectWs, encodeFrame, createFrameParser, acceptKey };
