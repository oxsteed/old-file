// Metrics tracking middleware
// Records request metrics (latency, errors, rates) for monitoring

const metricsService = require('../services/metricsService');

/**
 * Middleware to track HTTP request metrics
 */
function metricsMiddleware(req, res, next) {
  const startTime = Date.now();
  const method = req.method;
  const path = req.path;

  // Track request
  metricsService.incrementCounter('http.requests', 1, { method, path });

  // Wrap response.end to capture response time and status
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - startTime;

    // Record latency
    metricsService.recordHistogram('http.request_ms', duration, { method, path });

    // Record status code
    const statusCode = res.statusCode || 200;
    metricsService.incrementCounter('http.responses', 1, {
      method,
      path,
      status: statusCode,
    });

    // Track errors
    if (statusCode >= 400) {
      metricsService.incrementCounter('http.errors', 1, { status: statusCode });

      // Alert on 5xx errors
      if (statusCode >= 500) {
        metricsService.recordSecurityEvent('server_error', 'warning', req.user?.id, {
          path,
          status: statusCode,
          duration,
        });
      }
    }

    // Set gauge for last response time
    metricsService.setGauge('http.last_request_ms', duration);

    // Call original end
    originalEnd.call(this, chunk, encoding);
  };

  next();
}

/**
 * Middleware to track database query metrics
 * (should be integrated into pool.query wrapper)
 */
function trackDatabaseMetrics(duration, query, success, error = null) {
  if (success) {
    metricsService.recordHistogram('db.query_ms', duration);
    metricsService.incrementCounter('db.queries.success', 1);
  } else {
    metricsService.incrementCounter('db.queries.failure', 1);
    metricsService.recordSecurityEvent('database_error', 'warning', null, {
      error: error?.message,
      duration,
    });
  }
}

/**
 * Middleware to track authentication events
 */
function trackAuthMetrics(event, userId, success, details = {}) {
  if (event === 'login') {
    if (success) {
      metricsService.incrementCounter('auth.login_success', 1);
    } else {
      metricsService.incrementCounter('auth.failed_login', 1);
      metricsService.recordSecurityEvent('failed_login', 'info', userId, details);
    }
  }

  if (event === 'logout') {
    metricsService.incrementCounter('auth.logout', 1);
  }

  if (event === 'refresh') {
    if (success) {
      metricsService.incrementCounter('auth.token_refresh', 1);
    }
  }
}

/**
 * Middleware to track payment metrics
 */
function trackPaymentMetrics(action, userId, amountCents, duration, success, error = null) {
  if (action === 'capture') {
    if (success) {
      metricsService.incrementCounter('payment.capture_success', 1);
      metricsService.recordHistogram('payment.process_ms', duration);
    } else {
      metricsService.incrementCounter('payment.capture_failure', 1);
      metricsService.recordSecurityEvent('payment_error', 'high', userId, {
        amount: amountCents,
        error,
      });
    }
  }

  if (action === 'refund') {
    if (success) {
      metricsService.incrementCounter('payment.refund', 1);
    }
  }
}

module.exports = {
  metricsMiddleware,
  trackDatabaseMetrics,
  trackAuthMetrics,
  trackPaymentMetrics,
};
