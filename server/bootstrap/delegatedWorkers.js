'use strict';

// Web replacements do not start job consumers. The existing background
// runtime stays running on its private network throughout web promotion.
const runtimeState = require('../services/runtimeState');

function backgroundReadinessUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Web runtime requires BACKGROUND_READINESS_URL.'); }
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash
      || url.pathname !== '/ready' || !/^[a-z0-9][a-z0-9-]{0,127}$/i.test(url.hostname)
      || url.hostname === 'localhost') {
    throw new Error('BACKGROUND_READINESS_URL must name the private background runtime readiness endpoint.');
  }
  return url.href;
}

class DelegatedWorkers {
  constructor({ url = process.env.BACKGROUND_READINESS_URL, fetchImpl = fetch, intervalMs = 5000, timeoutMs = 5000 } = {}) {
    this.url = backgroundReadinessUrl(url);
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
  }

  async observe() {
    if (this.stopping) return false;
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      let ok = false;
      try {
        const response = await this.fetch(this.url, { redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
        if (response.ok) {
          const result = await response.json();
          // Do not delegate to another web facade or accept liveness alone.
          ok = result.status === 'ready' && result.checks?.workers?.ok === true
            && [undefined, 'combined'].includes(result.checks.workers.mode);
        }
      } catch { /* A private dependency failure must not expose its URL/body. */ }
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
