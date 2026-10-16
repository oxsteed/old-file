/**
 * helper-work-payouts.js - Guide: receive payouts.
 *
 * Verified against: client/src/pages/helper/HelperPayoutsPage.jsx
 * (/helper/payouts: balance, instant payout button, tax gate),
 * route /helper/payouts in App.jsx.
 */

export default {
  id: 'helper-work-payouts',
  area: 'helper-work',
  slug: 'receive-payouts',
  title: 'Receive payouts',
  audiences: ['helper'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Get the money you earned for completed jobs into your bank account.',
  intendedRoles: ['Helper'],
  prerequisites: [
    { text: 'Sign in and switch to helper mode.', href: '/login' },
    { text: 'Complete Stripe payout onboarding (connect your bank details).', href: '/helper/payouts' },
    { text: 'Complete your W-9 tax form in Settings (tax tab); withdrawals are gated on tax identity.', href: '/settings' },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open the Payouts page', type: 'terminal' },
      { id: 'check', label: 'Tax documents complete?', type: 'decision' },
      { id: 'w9', label: 'Complete the W-9 tax form', type: 'blocked' },
      { id: 'balance', label: 'Review your available balance', type: 'step' },
      { id: 'request', label: 'Request an instant payout', type: 'step' },
      { id: 'confirm', label: 'Confirm the payout request', type: 'step' },
      { id: 'done', label: 'Payout requested', type: 'terminal' },
    ],
    edges: [
      { from: 'start', to: 'check' },
      { from: 'check', to: 'balance', label: 'Yes' },
      { from: 'check', to: 'w9', label: 'No' },
      { from: 'w9', to: 'balance' },
      { from: 'balance', to: 'request' },
      { from: 'request', to: 'confirm' },
      { from: 'confirm', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the Payouts page. 2. If your tax documents are incomplete, complete the W-9 first; otherwise payouts stay blocked. ' +
    '3. Review your available and pending balances. 4. Request an instant payout. ' +
    '5. Confirm the request. 6. The payout is requested and heads to your bank.',
  steps: [
    {
      id: 'helper-work-payouts-s1',
      title: 'Open the Payouts page',
      body: 'Open /helper/payouts. The Payouts page shows your balance breakdown: Available, Pending, and Available for instant payout.',
      expectedResult: 'Your balances load on the page.',
      screenshots: [
        {
          id: 'helper-work-payouts-s1-desktop',
          viewport: 'desktop',
          screen: '/helper/payouts',
          state: 'Payouts page with synthetic balances, light mode',
          alt: 'Payouts page showing available, pending, and instant-available balances',
          caption: 'The Payouts page, desktop view.',
          annotations: [
            { n: 1, label: 'Available balance', locator: 'dt, dd' },
            { n: 2, label: 'Pending balance', locator: 'dt, dd' },
            { n: 3, label: 'Available for instant payout', locator: 'dt, dd' },
          ],
        },
        {
          id: 'helper-work-payouts-s1-mobile',
          viewport: 'mobile',
          screen: '/helper/payouts',
          state: 'Payouts page with synthetic balances, light mode',
          alt: 'Payouts page on a phone screen',
          caption: 'The Payouts page, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'helper-work-payouts-s2',
      title: 'Clear the tax gate',
      body: 'If you see the "Tax documents required" notice, choose Complete W-9 and finish the W-9 tax form in the Settings tax tab. Payouts stay blocked with "Payout blocked: tax identity required" until your tax identity is on file.',
      expectedResult: 'The tax notice clears and the payout button becomes available.',
      screenshots: [
        {
          id: 'helper-work-payouts-s2-desktop',
          viewport: 'desktop',
          screen: '/helper/payouts',
          state: 'Payouts page showing the tax gate notice, light mode',
          alt: 'Payouts page with the Tax documents required notice and Complete W-9 button',
          caption: 'The tax gate, desktop view.',
          annotations: [
            { n: 1, label: 'Tax documents required notice', locator: '.tax-blocked' },
            { n: 2, label: 'Complete W-9 button', locator: 'button' },
          ],
        },
        {
          id: 'helper-work-payouts-s2-mobile',
          viewport: 'mobile',
          screen: '/helper/payouts',
          state: 'Payouts page showing the tax gate notice, light mode',
          alt: 'Tax gate notice on a phone screen',
          caption: 'The tax gate, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'helper-work-payouts-s3',
      title: 'Request an instant payout',
      body: 'Choose the "Pay out {amount} now" button. Instant payouts are limited per request (shown on the page, e.g. a maximum amount) and to one per day. Confirm the request when prompted.',
      expectedResult: '"Instant payout of {amount} requested." appears.',
      screenshots: [
        {
          id: 'helper-work-payouts-s3-desktop',
          viewport: 'desktop',
          screen: '/helper/payouts',
          state: 'Payouts page with instant payout button, light mode',
          alt: 'Payouts page with the Pay out now button and the daily limit note',
          caption: 'Requesting an instant payout, desktop view.',
          annotations: [
            { n: 1, label: 'Pay out now button', locator: 'button' },
            { n: 2, label: 'Limit note', locator: 'p' },
          ],
        },
        {
          id: 'helper-work-payouts-s3-mobile',
          viewport: 'mobile',
          screen: '/helper/payouts',
          state: 'Payouts page with instant payout button, light mode',
          alt: 'Instant payout button on a phone screen',
          caption: 'Requesting an instant payout, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'The success message confirms the requested amount, and the payout moves out of your available balance toward your bank.',
  recovery: [
    {
      problem: '"No balance is available for instant payout yet."',
      solution: 'Your earnings are still pending (for example, a completed job awaiting settlement). Wait for the pending balance to become available.',
    },
    {
      problem: '"Payouts are not enabled yet."',
      solution: 'Finish your Stripe onboarding to connect a bank account before requesting payouts.',
    },
    {
      problem: 'Payout blocked: tax identity required.',
      solution: 'Complete your W-9 in the Settings tax tab, then return to the Payouts page.',
    },
  ],
  supportContact: 'If a requested payout never arrives, contact OxSteed Support from the /support page.',
  relatedGuides: ['helper-work-earnings', 'helper-work-invoices'],
  siteLinks: [
    { label: 'Payouts', href: '/helper/payouts' },
    { label: 'Tax settings', href: '/settings' },
  ],
  sources: [
    { type: 'route', ref: '/helper/payouts' },
    { type: 'screen', ref: 'client/src/pages/helper/HelperPayoutsPage.jsx' },
    { type: 'handler', ref: 'POST /payments/payout/instant' },
    { type: 'permission', ref: 'tax-identity (W-9) gate on withdrawals' },
  ],
};
