/**
 * submitGuard.js — one in-flight submission at a time.
 *
 * React state updates are async, so a Pay button disabled on `paying`
 * still has a double-submit window: a rapid double-tap can run the
 * handler twice before the re-render disables the button. A ref-held
 * guard closes that window synchronously. Release in `finally` so a
 * failed attempt can be retried.
 */
export function createSubmitGuard() {
  let held = false;
  return {
    get isHeld() {
      return held;
    },
    tryAcquire() {
      if (held) return false;
      held = true;
      return true;
    },
    release() {
      held = false;
    },
  };
}
