'use strict';

/**
 * Minimal in-process RESP (Redis protocol) server for two-process tests.
 *
 * Lets two real forked Node processes exercise the real ioredis client and
 * the real fencing/presence code paths against one shared store, without
 * requiring a live Redis server in CI.
 *
 * Supported commands: PING, SET (EX/PX/NX/XX), GET, DEL, EXISTS, EXPIRE,
 * TTL, HSET, HDEL, HGETALL, SCAN (MATCH/COUNT), QUIT. Key TTLs are enforced
 * lazily on access and during SCAN.
 */

const net = require('net');

function toGlobRe(pattern) {
  const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

class FakeRespRedis {
  constructor() {
    this.strings = new Map(); // key -> { value: string, exp: number|null }
    this.hashes = new Map(); // key -> { fields: Map, exp: number|null }
    this.server = net.createServer((socket) => this._handleSocket(socket));
  }

  _expired(entry) {
    return entry.exp !== null && entry.exp <= Date.now();
  }

  _get(key) {
    let e = this.strings.get(key);
    if (e) {
      if (this._expired(e)) { this.strings.delete(key); return null; }
      return e;
    }
    e = this.hashes.get(key);
    if (e) {
      if (this._expired(e)) { this.hashes.delete(key); return null; }
      return e;
    }
    return null;
  }

  _handleSocket(socket) {
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const parsed = this._tryParseArray(buf);
        if (!parsed) break;
        buf = parsed.rest;
        const reply = this._runCommand(parsed.args);
        socket.write(reply);
        if (parsed.quit) {
          socket.end();
          return;
        }
      }
    });
    socket.on('error', () => {});
  }

  // Parse one RESP array of bulk strings. Returns { args, rest, quit } or null.
  _tryParseArray(buf) {
    if (buf.length === 0 || buf[0] !== 0x2a) return null; // '*'
    const lineEnd = buf.indexOf('\r\n');
    if (lineEnd === -1) return null;
    const count = parseInt(buf.slice(1, lineEnd).toString(), 10);
    if (!Number.isFinite(count) || count < 0) return null;
    let offset = lineEnd + 2;
    const args = [];
    for (let i = 0; i < count; i += 1) {
      if (offset >= buf.length || buf[offset] !== 0x24) return null; // '$'
      const lenEnd = buf.indexOf('\r\n', offset);
      if (lenEnd === -1) return null;
      const len = parseInt(buf.slice(offset + 1, lenEnd).toString(), 10);
      if (!Number.isFinite(len) || len < -1) return null;
      if (len === -1) {
        args.push(null);
        offset = lenEnd + 2;
        continue;
      }
      if (buf.length < lenEnd + 2 + len + 2) return null;
      args.push(buf.slice(lenEnd + 2, lenEnd + 2 + len).toString());
      offset = lenEnd + 2 + len + 2;
    }
    return { args, rest: buf.slice(offset), quit: args[0] && args[0].toUpperCase() === 'QUIT' };
  }

  _simple(s) { return `+${s}\r\n`; }
  _int(n) { return `:${n}\r\n`; }
  _bulk(s) {
    if (s === null || s === undefined) return '$-1\r\n';
    const b = Buffer.from(String(s));
    return `$${b.length}\r\n${b.toString()}\r\n`;
  }
  _array(items) {
    let out = `*${items.length}\r\n`;
    for (const it of items) out += this._bulk(it);
    return out;
  }
  _error(msg) { return `-ERR ${msg}\r\n`; }

  _setEntry(key, entry) {
    this.hashes.delete(key);
    this.strings.set(key, entry);
  }

  _runCommand(args) {
    if (!args.length) return this._error('empty command');
    const cmd = String(args[0]).toUpperCase();
    const rest = args.slice(1);
    try {
      switch (cmd) {
        case 'PING':
          return rest.length ? this._bulk(rest[0]) : this._simple('PONG');
        case 'INFO':
          // ioredis requests server info on connect; a minimal reply is enough.
          return this._bulk('redis_version:7.0.0\r\nredis_mode:standalone\r\n');
        case 'QUIT':
          return this._simple('OK');
        case 'SET': {
          const [key, value, ...opts] = rest;
          if (key === undefined || value === undefined) return this._error('wrong number of arguments for SET');
          let exMs = null;
          let nx = false;
          let xx = false;
          for (let i = 0; i < opts.length; i += 1) {
            const o = String(opts[i]).toUpperCase();
            if (o === 'EX') { exMs = Number(opts[i + 1]) * 1000; i += 1; }
            else if (o === 'PX') { exMs = Number(opts[i + 1]); i += 1; }
            else if (o === 'NX') nx = true;
            else if (o === 'XX') xx = true;
          }
          const exists = this._get(key) !== null;
          if (nx && exists) return this._bulk(null);
          if (xx && !exists) return this._bulk(null);
          this._setEntry(key, { value: String(value), exp: exMs === null ? null : Date.now() + exMs });
          return this._simple('OK');
        }
        case 'GET': {
          const e = this._get(rest[0]);
          return this._bulk(e ? e.value : null);
        }
        case 'DEL': {
          let n = 0;
          for (const k of rest) {
            if (this._get(k) !== null) {
              this.strings.delete(k);
              this.hashes.delete(k);
              n += 1;
            }
          }
          return this._int(n);
        }
        case 'EXISTS': {
          let n = 0;
          for (const k of rest) if (this._get(k) !== null) n += 1;
          return this._int(n);
        }
        case 'EXPIRE': {
          const e = this._get(rest[0]);
          if (!e) return this._int(0);
          e.exp = Date.now() + Number(rest[1]) * 1000;
          return this._int(1);
        }
        case 'TTL': {
          const e = this._get(rest[0]);
          if (!e) return this._int(-2);
          if (e.exp === null) return this._int(-1);
          return this._int(Math.max(0, Math.ceil((e.exp - Date.now()) / 1000)));
        }
        case 'HSET': {
          const [key, ...pairs] = rest;
          if (!key || pairs.length < 2 || pairs.length % 2 !== 0) return this._error('wrong number of arguments for HSET');
          let e = this.hashes.get(key);
          if (!e || this._expired(e)) {
            e = { fields: new Map(), exp: null };
            this.strings.delete(key);
            this.hashes.set(key, e);
          }
          let added = 0;
          for (let i = 0; i < pairs.length; i += 2) {
            if (!e.fields.has(pairs[i])) added += 1;
            e.fields.set(pairs[i], pairs[i + 1]);
          }
          return this._int(added);
        }
        case 'HDEL': {
          const [key, ...fields] = rest;
          const e = this.hashes.get(key);
          if (!e || this._expired(e)) return this._int(0);
          let n = 0;
          for (const f of fields) if (e.fields.delete(f)) n += 1;
          // Like real Redis, drop the key once its last field is gone.
          if (e.fields.size === 0) this.hashes.delete(key);
          return this._int(n);
        }
        case 'HGETALL': {
          const e = this.hashes.get(rest[0]);
          if (!e || this._expired(e)) return this._array([]);
          const out = [];
          for (const [f, v] of e.fields) { out.push(f, v); }
          return this._array(out);
        }
        case 'SCAN': {
          let cursor = parseInt(rest[0], 10) || 0;
          let match = null;
          let count = 10;
          for (let i = 1; i < rest.length; i += 1) {
            const o = String(rest[i]).toUpperCase();
            if (o === 'MATCH') { match = toGlobRe(rest[i + 1]); i += 1; }
            else if (o === 'COUNT') { count = parseInt(rest[i + 1], 10) || 10; i += 1; }
          }
          const all = [...this.strings.keys(), ...this.hashes.keys()]
            .filter((k) => this._get(k) !== null)
            .filter((k) => !match || match.test(k))
            .sort();
          const slice = all.slice(cursor, cursor + count);
          const next = cursor + count >= all.length ? 0 : cursor + count;
          return `*2\r\n${this._bulk(String(next))}${this._array(slice)}`;
        }
        default:
          return this._error(`unknown command '${cmd}'`);
      }
    } catch (err) {
      return this._error(err.message);
    }
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.removeListener('error', reject);
        resolve(this.server.address().port);
      });
    });
  }

  close() {
    return new Promise((resolve) => this.server.close(resolve));
  }
}

module.exports = { FakeRespRedis };
