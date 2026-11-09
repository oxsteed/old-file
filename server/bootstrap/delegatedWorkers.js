'use strict';

// Web replacements do not start job consumers. The existing background
// runtime stays running on its private network throughout web promotion.
const logger = require('../utils/logger');
const runtimeState = require('../services/runtimeState');

const { backgroundProbeTimeoutMs, backgroundConfirmationTimeoutMs } = require('../config/readinessBudgets.json');

function backgroundReadinessUrl(value, setting = 'BACKGROUND_READINESS_URL') {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Web runtime requires a valid ${setting}.`); }
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash
      || url.pathname !== '/ready' || !/^[a-z0-9][a-z0-9-]{0,127}$/i.test(url.hostname)
      || url.hostname === 'localhost') {
    throw new Error(`${setting} must name a private background runtime readiness endpoint.`);
  }
  return url.href;
}

class DelegatedWorkers {
  constructor({
    url = process.env.BACKGROUND_READINESS_URL,
    fallbackUrl = process.env.BACKGROUND_READINESS_FALLBACK_URL,
    fetchImpl = fetch,
    intervalMs = 5000,
    timeoutMs = backgroundProbeTimeoutMs,
  } = {}) {
    this.urls = [backgroundReadinessUrl(url)];
    if (fallbackUrl) {
      const alternate = backgroundReadinessUrl(fallbackUrl, 'BACKGROUND_READINESS_FALLBACK_URL');
      if (alternate === this.urls[0]) throw new Error('Background readiness endpoints must be distinct.');
      this.urls.push(alternate);
    }
    if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 60000
        || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) {
      throw new TypeError('Background readiness observation requires bounded polling and timeout intervals.');
    }
    this.fetch = fetchImpl;
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.handles = [];
    this.started = false;
    this.starting = false;
    this.stopping = false;
    this.inFlight = null;
    this.timer = null;
    this.lastOk = null;
  }

  async probeEndpoint(url, signal) {
    try {
      const response = await this.fetch(url, { redirect: 'error', signal });
      if (!response.ok) return false;
      const result = await response.json();
      // Do not delegate to another web facade or accept liveness alone.
      return result.status === 'ready' && result.checks?.workers?.ok === true
        && [undefined, 'combined'].includes(result.checks.workers.mode);
    } catch {
      // Do not log the URL or body. Fetch errors can embed the private endpoint.
      const reason = signal.aborted ? signal.reason?.name : undefined;
      if (reason !== 'AbortError') logger.warn('Background readiness observation failed', { timedOut: reason === 'TimeoutError' });
      return false;
    }
  }

  async probe(timeoutMs) {
    const deadline = AbortSignal.timeout(timeoutMs);
    const complete = new AbortController();
    const signal = AbortSignal.any([deadline, complete.signal]);
    try {
      await Promise.any(this.urls.map(async url => {
        if (!await this.probeEndpoint(url, signal)) throw new Error('Background runtime unavailable');
      }));
      return 'ready';
    } catch {
      return deadline.aborted ? 'timeout' : 'unavailable';
    } finally {
      // Both endpoints share one deadline. A slow standby cannot hold up a
      // healthy response from the active worker.
      complete.abort();
    }
  }

  async observe() {
    if (this.stopping) return false;
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      let result = await this.probe(this.timeoutMs);
      // A missed deadline is inconclusive. Give a previously ready, serving
      // replica one bounded confirmation attempt before withdrawing traffic.
      if (result === 'timeout' && this.started && this.lastOk && !this.stopping
          && runtimeState.snapshot().acceptingTraffic) {
        // A confirmation must allow the same work as the initial probe. A
        // shorter deadline rejects a recovering worker before it can reply.
        result = await this.probe(Math.min(this.timeoutMs, backgroundConfirmationTimeoutMs));
      }
      const ok = result === 'ready';
      if (this.lastOk === true && !ok) logger.warn('Background runtime no longer ready');
      this.lastOk = ok;
      if (!this.stopping) runtimeState.update({ workersReady: ok, workerMode: 'delegated' });
      return ok;
    })();
    try { return await this.inFlight; } finally { this.inFlight = null; }
  }

  async start() {
    if (this.starting || this.started || this.stopping) throw new Error('Delegated worker observation is already running or draining.');
    this.starting = true;
    try {
      if (!await this.observe() || this.stopping) throw new Error('The background runtime is not ready; web replacement refused.');
      this.started = true;
      this.timer = setInterval(() => { void this.observe(); }, this.intervalMs);
      this.timer.unref?.();
    } finally { this.starting = false; }
    return this;
  }

  async stop() {
    this.stopping = true;
    runtimeState.update({ workersReady: false });
    clearInterval(this.timer);
    this.timer = null;
    const draining = this.handles.map(handle => Promise.resolve().then(() => handle?.stop?.()));
    await Promise.allSettled([this.inFlight, ...draining]);
    this.handles = [];
    this.started = false;
  }
}

module.exports = { DelegatedWorkers, backgroundReadinessUrl };
