'use strict';

// One in-flight pass per process. Stop accepting ticks synchronously, then
// let the current pass settle before its database/storage clients are closed.
function createDrainablePoller({ run, onError = () => {} }) {
  let interval = null, delay = null, inFlight = null, stopping = true, stopPromise = null;
  function tick() {
    if (stopping || inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(() => { if (!stopping) return run({ isStopping: () => stopping }); })
      .catch(error => { try { onError(error); } catch { /* logging may be shutting down too */ } })
      .finally(() => { inFlight = null; });
    return inFlight;
  }
  return {
    start({ intervalMs, initialDelayMs = 0 } = {}) {
      if (!stopping || inFlight) return false;
      if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > 2147483647
        || !Number.isFinite(initialDelayMs) || initialDelayMs < 0 || initialDelayMs > 2147483647) {
        throw new TypeError('Poll intervals and startup delay must be bounded positive durations');
      }
      stopping = false;stopPromise = null;
      const begin = () => {
        delay = null;
        if (stopping) return;
        interval = setInterval(tick, intervalMs);interval.unref?.();
        tick();
      };
      if (initialDelayMs) { delay = setTimeout(begin, initialDelayMs);delay.unref?.(); }
      else begin();
      return true;
    },
    stop() {
      if (stopPromise) return stopPromise;
      stopping = true;
      clearInterval(interval);clearTimeout(delay);interval = null;delay = null;
      stopPromise = Promise.resolve(inFlight).then(() => undefined);
      return stopPromise;
    },
    get started() { return !stopping; },
  };
}

module.exports = { createDrainablePoller };
