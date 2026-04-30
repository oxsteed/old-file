/**
 * client/src/utils/frontendLogger.js
 *
 * Structured logging for frontend.
 * In development: logs to console.
 * In production: can be wired to Sentry, Datadog, or other error tracking services.
 *
 * Usage:
 *   import logger from './frontendLogger';
 *   logger.error('Job creation failed', { jobId: 123, reason: 'Invalid budget' });
 *   logger.warn('Slow API response', { endpoint: '/jobs', ms: 5000 });
 *   logger.info('User logged in', { userId: 42 });
 */

const IS_PROD = process.env.NODE_ENV === 'production';

const LEVELS = {
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

const MIN_LEVEL = LEVELS[process.env.REACT_APP_LOG_LEVEL] || (IS_PROD ? LEVELS.info : LEVELS.debug);

/**
 * Serialize error for logging
 * @param {Error} err - The error to serialize
 * @returns {Object} Serialized error
 */
function serializeError(err) {
  if (!err) return null;
  return {
    name: err.name,
    message: err.message,
    code: err.code,
    status: err.status || err.statusCode,
    // Stack trace only in development
    stack: !IS_PROD ? err.stack : undefined,
  };
}

/**
 * Format a log entry
 * @param {string} level - Log level (debug, info, warn, error)
 * @param {string} message - Log message
 * @param {Object} context - Additional context
 * @returns {Object} Formatted log entry
 */
function formatEntry(level, message, context = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level: level.toUpperCase(),
    msg: message,
  };

  if (context) {
    if (context instanceof Error) {
      entry.err = serializeError(context);
    } else if (typeof context === 'object') {
      // Serialize any errors in the context
      Object.entries(context).forEach(([key, value]) => {
        if (value instanceof Error) {
          entry[key] = serializeError(value);
        } else {
          entry[key] = value;
        }
      });
    }
  }

  return entry;
}

/**
 * Output a log entry
 * @param {string} level - Log level
 * @param {Object} entry - Formatted entry
 */
function output(level, entry) {
  if (IS_PROD) {
    // In production: send to Sentry/Datadog (currently just console)
    // TODO: Wire to error tracking service
    const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logFn(JSON.stringify(entry));
  } else {
    // In development: pretty print with colors
    const colors = {
      debug: '\x1b[90m',   // gray
      info: '\x1b[36m',    // cyan
      warn: '\x1b[33m',    // yellow
      error: '\x1b[31m',   // red
      reset: '\x1b[0m',
      bold: '\x1b[1m',
    };

    const color = colors[level] || '';
    const label = level.toUpperCase().padEnd(5);
    let output = `${color}${colors.bold}${label}${colors.reset} ${entry.msg}`;

    // Add context if present
    if (Object.keys(entry).length > 4) {
      const context = { ...entry };
      delete context.ts;
      delete context.level;
      delete context.msg;
      output += ` ${JSON.stringify(context, null, 2)}`;
    }

    const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logFn(output);
  }
}

/**
 * Logger object with debug, info, warn, error methods
 */
const logger = {
  /**
   * Log debug message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  debug(message, context) {
    if (LEVELS.debug >= MIN_LEVEL) {
      const entry = formatEntry('debug', message, context);
      output('debug', entry);
    }
  },

  /**
   * Log info message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  info(message, context) {
    if (LEVELS.info >= MIN_LEVEL) {
      const entry = formatEntry('info', message, context);
      output('info', entry);
    }
  },

  /**
   * Log warning message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  warn(message, context) {
    if (LEVELS.warn >= MIN_LEVEL) {
      const entry = formatEntry('warn', message, context);
      output('warn', entry);
    }
  },

  /**
   * Log error message
   * @param {string} message - Log message
   * @param {Error | Object} context - Error or context object
   */
  error(message, context) {
    if (LEVELS.error >= MIN_LEVEL) {
      const entry = formatEntry('error', message, context);
      output('error', entry);

      // In production, also send to error tracking service
      if (IS_PROD && context instanceof Error) {
        // TODO: Send to Sentry/Datadog
        // Sentry.captureException(context, { contexts: { ...entry } });
      }
    }
  },

  /**
   * Log API request
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @param {string} path - Request path
   * @param {number} statusCode - Response status code
   * @param {number} ms - Duration in milliseconds
   */
  logAPICall(method, path, statusCode, ms) {
    const level = statusCode >= 400 ? 'warn' : 'info';
    logger[level](`${method} ${path}`, {
      statusCode,
      duration_ms: ms,
    });
  },

  /**
   * Log unhandled error
   * @param {Error} err - The error
   * @param {string} context - Where error occurred
   */
  logUnhandledError(err, context) {
    logger.error(`Unhandled error in ${context}`, {
      error: err,
      stackTrace: err?.stack,
    });

    // In production, report to error tracking
    if (IS_PROD) {
      // TODO: Sentry.captureException(err);
    }
  },
};

export default logger;
