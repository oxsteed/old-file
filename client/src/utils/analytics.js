/**
 * analytics.js — Lightweight GA4 event wrapper
 *
 * Sends custom events to GA4 via the gtag function loaded by consentScripts.ts.
 * Fails silently if gtag is not available (pre-consent, adblocker, etc.).
 *
 * Usage:
 *   import { trackEvent } from '../utils/analytics';
 *   trackEvent('job_posted', { job_type: 'tier3_escrow', category: 'plumbing' });
 */

/**
 * Fire a GA4 custom event.
 * @param {string} eventName  - snake_case event name (e.g. 'bid_placed')
 * @param {Object} [params]   - event parameters (merged with session defaults)
 */
export function trackEvent(eventName, params = {}) {
  try {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
      window.gtag('event', eventName, params);
    }
  } catch (_) {
    // Never throw — analytics must never break product functionality
  }
}

// ── Named event helpers ────────────────────────────────────────────────────

export const analytics = {
  jobPosted:         (jobType, category) => trackEvent('job_posted',         { job_type: jobType, category }),
  bidPlaced:         (jobId, amount)     => trackEvent('bid_placed',         { job_id: jobId, value: amount }),
  helperHired:       (jobId)             => trackEvent('helper_hired',       { job_id: jobId }),
  paymentInitiated:  (jobId, amount)     => trackEvent('payment_initiated',  { job_id: jobId, value: amount, currency: 'USD' }),
  paymentAuthorized: (jobId, amount)     => trackEvent('payment_authorized', { job_id: jobId, value: amount, currency: 'USD' }),
  reviewSubmitted:   (jobId, rating)     => trackEvent('review_submitted',   { job_id: jobId, rating }),
  upgradeClicked:    (fromTier, source)  => trackEvent('upgrade_clicked',    { from_tier: fromTier, source }),
  learnGuideViewed:  (guideId, title)    => trackEvent('learn_guide_viewed', { guide_id: guideId, guide_title: title }),
  learnBuyClicked:   (toolName, linkType)=> trackEvent('learn_buy_clicked',  { tool_name: toolName, link_type: linkType }),
};
