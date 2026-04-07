/**
 * server/utils/logger.js
 *
 * Lightweight structured logger.
 *
 * In production: emits newline-delimited JSON (NDJSON) — parseable by log
 * aggregators (Datadog, Logtail, Papertrail, etc.).
 *
 * In development: pretty-prints colored output to the console.
 *
 * Usage:
 *   const logger = require('../utils/logger');
 *   logger.info('User registered', { userId: 42 });
 *   logger.warn('Slow query', { ms: 850 });
 *   logger.error('DB connection failed', err);
 */

'use strict';

const IS_PROD = process.env.NODE_ENV === 'production';

// ANSI color codes (dev only)
const C = {
  reset:  '\x1b[0m',
  gray:   '\x1b[90m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  bold:   '\x1b[1m',
};

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LEVEL_LABEL = { 10: 'DEBUG', 20: 'INFO', 30: 'WARN', 40: 'ERROR' };
const LEVEL_COLOR = { 10: C.gray, 20: C.cyan, 30: C.yellow, 40: C.red };

const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? (IS_PROD ? LEVELS.info : LEVELS.debug);

/**
 * Serialize an error to a plain object so it appears in JSON output.
 */
function serializeError(err) {
  if (!err || typeof err !== 'object') return err;
  return {
    message: err.message,
    name:    err.name,
    stack:   IS_PROD ? undefined : err.stack,
    code:    err.code,
    status:  err.status || err.statusCode,
  };
}

function log(level, message, meta) {
  if (level < MIN_LEVEL) return;

  const ts = new Date().toISOString();

  if (IS_PROD) {
    // Structured JSON for log aggregation
    const entry = {
      ts,
      level: LEVEL_LABEL[level],
      msg:   message,
    };
    if (meta !== undefined) {
      if (meta instanceof Error) {
        entry.err = serializeError(meta);
      } else if (meta && typeof meta === 'object') {
        Object.assign(entry, meta);
      } else {
        entry.meta = meta;
      }
    }
    // Use stdout for info/debug, stderr for warn/error
    const stream = level >= LEVELS.warn ? process.stderr : process.stdout;
    stream.write(JSON.stringify(entry) + '\n');
  } else {
    // Pretty dev output
    const label = LEVEL_LABEL[level].padEnd(5);
    const color = LEVEL_COLOR[level] || '';
    let line = `${C.gray}${ts}${C.reset} ${color}${C.bold}${label}${C.reset} ${message}`;
    if (meta !== undefined) {
      if (meta instanceof Error) {
        line += `\n  ${C.red}${meta.stack || meta.message}${C.reset}`;
      } else if (meta && typeof meta === 'object') {
        try {
          line += `  ${C.gray}${JSON.stringify(meta)}${C.reset}`;
        } catch {
          line += `  [unstringifiable object]`;
        }
      } else {
        line += `  ${C.gray}${meta}${C.reset}`;
      }
    }
    const stream = level >= LEVELS.warn ? process.stderr : process.stdout;
    stream.write(line + '\n');
  }
}

const logger = {
  debug: (msg, meta) => log(LEVELS.debug, msg, meta),
  info:  (msg, meta) => log(LEVELS.info,  msg, meta),
  warn:  (msg, meta) => log(LEVELS.warn,  msg, meta),
  error: (msg, meta) => log(LEVELS.error, msg, meta),

  /**
   * Returns an Express request-logging middleware.
   * Logs method, path, status, and response time.
   */
  requestMiddleware() {
    return (req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const ms    = Date.now() - start;
        const level = res.statusCode >= 500 ? LEVELS.error
                    : res.statusCode >= 400 ? LEVELS.warn
                    : LEVELS.info;
        log(level, `${req.method} ${req.path}`, {
          status: res.statusCode,
          ms,
          ip: req.ip,
        });
      });
      next();
    };
  },
};

module.exports = logger;
