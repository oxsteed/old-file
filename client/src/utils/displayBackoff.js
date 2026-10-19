// Exponential backoff schedule for the public restaurant display feeds
// (queue board, kiosk, kitchen). Displays keep rendering their last-known
// state while retries back off, so a flaky network never blanks a wall TV.
export const DISPLAY_BACKOFF_DEFAULTS = Object.freeze({
  baseMs: 2000,
  factor: 2,
  capMs: 60000,
});

/**
 * Delay before the next retry after `failureCount` consecutive failures.
 * The first failure waits `baseMs`, then the delay doubles per failure
 * until it hits `capMs`. Deterministic (no jitter) so wall screens across
 * a venue retry on a predictable, testable cadence.
 */
export function computeDisplayBackoffMs(failureCount, options = {}) {
  const { baseMs, factor, capMs } = { ...DISPLAY_BACKOFF_DEFAULTS, ...options };
  const failures = Math.max(1, Math.floor(Number(failureCount) || 1));
  const safeBase = Math.max(0, Number(baseMs) || 0);
  const safeFactor = Math.max(1, Number(factor) || 1);
  const safeCap = Math.max(0, Number(capMs) || 0);
  const delay = safeBase * Math.pow(safeFactor, failures - 1);
  return Math.min(Math.round(delay), safeCap);
}
