// Enterprise metrics collection for security monitoring
// Tracks: requests, errors, latency, security events, database health

const logger = require('../utils/logger');
const os = require('os');

class MetricsCollector {
  constructor() {
    this.counters = new Map();
    this.histograms = new Map();
    this.gauges = new Map();
    this.securityEvents = [];
    this.maxSecurityEvents = 10000; // Keep last 10K events in memory
    this.cpuBaseline = process.cpuUsage();
    this.cpuBaselineAt = process.hrtime.bigint();
  }

  // ── COUNTERS ──────────────────────────────────────────────────
  incrementCounter(name, value = 1, tags = {}) {
    const key = `${name}:${JSON.stringify(tags)}`;
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  getCounter(name) {
    return Array.from(this.counters.entries())
      .filter(([k]) => k.startsWith(name))
      .reduce((sum, [, v]) => sum + v, 0);
  }

  // ── HISTOGRAMS (latency tracking) ──────────────────────────────
  recordHistogram(name, value, tags = {}) {
    const key = `${name}:${JSON.stringify(tags)}`;
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }
    this.histograms.get(key).push(value);

    // Keep only last 1000 samples per histogram
    const arr = this.histograms.get(key);
    if (arr.length > 1000) {
      arr.shift();
    }
  }

  getHistogramStats(name) {
    const key = `${name}:{}`;
    const values = this.histograms.get(key) || [];
    if (values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      count: values.length,
    };
  }

  // ── GAUGES (current state) ────────────────────────────────────
  setGauge(name, value, tags = {}) {
    const key = `${name}:${JSON.stringify(tags)}`;
    this.gauges.set(key, value);
  }

  getGauge(name) {
    const key = `${name}:{}`;
    return this.gauges.get(key);
  }

  // ── SECURITY EVENTS ──────────────────────────────────────────
  recordSecurityEvent(eventType, severity, userId, details = {}) {
    const event = {
      timestamp: new Date().toISOString(),
      type: eventType,
      severity, // 'critical', 'warning', 'info'
      userId,
      details,
    };

    this.securityEvents.push(event);
    if (this.securityEvents.length > this.maxSecurityEvents) {
      this.securityEvents.shift();
    }

    // Log critical/warning security events
    if (severity === 'critical') {
      logger.error('SECURITY EVENT', event);
    } else if (severity === 'warning') {
      logger.warn('SECURITY EVENT', event);
    }

    return event;
  }

  getSecurityEvents(since = null) {
    if (!since) {
      return this.securityEvents.slice(-100);
    }
    const sinceTime = new Date(since).getTime();
    return this.securityEvents.filter(e =>
      new Date(e.timestamp).getTime() >= sinceTime
    );
  }

  // ── HEALTH SNAPSHOT ──────────────────────────────────────────
  getSystemSnapshot() {
    const now = process.hrtime.bigint();
    const elapsedMicros = Number(now - this.cpuBaselineAt) / 1000;
    const cpu = process.cpuUsage(this.cpuBaseline);
    this.cpuBaseline = process.cpuUsage();
    this.cpuBaselineAt = now;
    const cpuMicros = cpu.user + cpu.system;
    const cores = Math.max(1, os.cpus().length);
    const memory = process.memoryUsage();

    return {
      uptimeSeconds: Math.round(process.uptime()),
      cpuPercent: elapsedMicros > 0 ? Math.round((cpuMicros / elapsedMicros / cores) * 1000) / 10 : 0,
      cpuCores: cores,
      memoryBytes: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        external: memory.external,
      },
      loadAverage: os.loadavg(),
    };
  }

  getHealthSnapshot() {
    return {
      timestamp: new Date().toISOString(),
      counters: {
        totalRequests: this.getCounter('http.requests'),
        totalErrors: this.getCounter('http.errors'),
        failedLogins: this.getCounter('auth.failed_login'),
        rateLimitHits: this.getCounter('ratelimit.exceeded'),
        suspiciousActivities: this.getCounter('security.suspicious'),
      },
      latency: {
        http: this.getHistogramStats('http.request_ms'),
        database: this.getHistogramStats('db.query_ms'),
        payment: this.getHistogramStats('payment.process_ms'),
      },
      system: this.getSystemSnapshot(),
      costSignals: {
        geoProviderAttempts: this.getCounter('geo.provider_attempt'),
        geoCacheHits: this.getCounter('geo.cache_hit'),
        directoryCacheHits: this.getCounter('directory.cache_hit'),
        directoryCacheMisses: this.getCounter('directory.cache_miss'),
      },
      security: {
        recentEvents: this.getSecurityEvents(),
        eventCount: this.securityEvents.length,
      },
    };
  }

  // ── ALERTS (detect anomalies) ──────────────────────────────
  checkAlerts() {
    const alerts = [];

    // High error rate
    const totalReqs = this.getCounter('http.requests');
    const totalErrors = this.getCounter('http.errors');
    if (totalReqs > 1000 && (totalErrors / totalReqs) > 0.05) {
      alerts.push({
        type: 'HIGH_ERROR_RATE',
        severity: 'critical',
        message: `Error rate ${((totalErrors / totalReqs) * 100).toFixed(2)}% (${totalErrors}/${totalReqs})`,
      });
    }

    // High rate limiting
    const rateLimitHits = this.getCounter('ratelimit.exceeded');
    if (rateLimitHits > 1000) {
      alerts.push({
        type: 'HIGH_RATE_LIMIT',
        severity: 'warning',
        message: `${rateLimitHits} rate limit hits in window`,
      });
    }

    // Failed login spike
    const failedLogins = this.getCounter('auth.failed_login');
    if (failedLogins > 100) {
      alerts.push({
        type: 'FAILED_LOGIN_SPIKE',
        severity: 'warning',
        message: `${failedLogins} failed login attempts detected`,
      });
    }

    // Slow database queries
    const dbStats = this.getHistogramStats('db.query_ms');
    if (dbStats && dbStats.p95 > 5000) {
      alerts.push({
        type: 'SLOW_QUERIES',
        severity: 'warning',
        message: `Database p95 latency ${dbStats.p95.toFixed(0)}ms`,
      });
    }

    return alerts;
  }

  reset() {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
    this.securityEvents = [];
  }
}

module.exports = new MetricsCollector();
