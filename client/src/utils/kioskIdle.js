/**
 * kioskIdle.js — FoodKioskPage idle-reset windows.
 *
 * The kiosk resets an idle guest after 60s so the next guest starts
 * clean. That window is too short for the payment/confirm step: a guest
 * who has a quote in front of them and pauses to read the total (or to
 * type card + PIN into the credit form) loses the cart and the quote.
 * `creditAttempt` only exists once the credit form is SUBMITTED, so it
 * does not exempt card/PIN entry or quote review — only the in-flight
 * attempt. The review step with a live quote therefore gets a longer
 * window; the post-order reset stays 60s by design.
 */
export const KIOSK_IDLE_RESET_MS = 60000;
export const KIOSK_PAYMENT_REVIEW_RESET_MS = 180000;

/**
 * Returns the idle-reset timeout for the current kiosk state, or null
 * when no idle timer should run at all.
 */
export function kioskIdleResetMs({ step, quoted, placing, creditAttempt, creditReceipt }) {
  if ((step === 'start' && !creditReceipt) || placing || creditAttempt) return null;
  if (step === 'review' && quoted) return KIOSK_PAYMENT_REVIEW_RESET_MS;
  return KIOSK_IDLE_RESET_MS;
}
