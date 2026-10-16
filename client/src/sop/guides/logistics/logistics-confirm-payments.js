/**
 * logistics-confirm-payments - Confirm payments at checkout (conditional).
 * Condition: requires LOGISTICS_PAYMENTS_ENABLED=true (default off).
 * Sources: client/src/pages/logistics/CheckoutPage.jsx,
 * client/src/pages/logistics/LogisticsPaymentsPage.jsx
 * Routes: /logistics/checkout, /logistics/payments
 *
 * Screenshots are OxSteed handoff/return screens only; never external
 * provider UIs. No real transactions are shown.
 */

const guide = {
  id: 'logistics-confirm-payments',
  area: 'logistics',
  slug: 'confirm-logistics-payment',
  title: 'Confirm payments at checkout',
  audiences: ['logistics'],
  revision: 1,
  availability: 'conditional',
  conditions: [
    'Requires LOGISTICS_PAYMENTS_ENABLED=true (default off). While disabled, every checkout route answers 503 and the checkout shows the disabled state "Online payments are not enabled yet. Please try again later."',
  ],
  goal: 'Confirm and pay a logistics order installment by card via Stripe or from OxSteed Credit.',
  intendedRoles: ['Logistics participant (buyer)'],
  prerequisites: [
    { text: 'A signed-in OxSteed account.', href: '/login' },
    { text: 'An accepted quote version on the order. Accept the current quote first.', guideId: 'logistics-accept-quotes', href: '/logistics/checkout' },
  ],
  processMap: {
    nodes: [
      { id: 'flag', label: 'Is logistics payments enabled?', type: 'decision' },
      { id: 'blocked', label: 'Disabled state: Online payments are not enabled yet', type: 'blocked' },
      { id: 'open', label: 'Open checkout', type: 'step' },
      { id: 'quote', label: 'Current quote accepted?', type: 'decision' },
      { id: 'method', label: 'Choose Card via Stripe or OxSteed Credit', type: 'step' },
      { id: 'confirm', label: 'Tick the confirmation box and choose Confirm and pay', type: 'step' },
      { id: 'done', label: 'Payment submitted; webhook confirms settlement', type: 'terminal' },
    ],
    edges: [
      { from: 'flag', to: 'blocked', label: 'No' },
      { from: 'flag', to: 'open', label: 'Yes' },
      { from: 'open', to: 'quote' },
      { from: 'quote', to: 'method', label: 'Yes' },
      { from: 'quote', to: 'open', label: 'No: accept the quote first' },
      { from: 'method', to: 'confirm' },
      { from: 'confirm', to: 'done' },
    ],
  },
  processMapText:
    '1. Check that logistics payments are enabled; otherwise checkout shows the disabled state and the routes answer 503. ' +
    '2. Open checkout. 3. Make sure the current quote version is accepted; payment is paused until it is. ' +
    '4. Choose how to pay the installment: "Card via Stripe" or "OxSteed Credit". Each installment uses exactly one method. ' +
    '5. Tick the confirmation checkbox and choose "Confirm and pay". 6. The payment is submitted; settlement is confirmed by a signed webhook, and history appears on the payments page.',
  steps: [
    {
      id: 'logistics-confirm-payments-s1',
      title: 'Open checkout and check the state',
      body: 'Open /logistics/checkout for your order. If logistics payments are disabled, you see "Online payments are not enabled yet. Please try again later." and cannot proceed. Otherwise the page shows "Review and confirm" with the line "You are about to pay {{amount}} ({{installment}}) for order {{reference}} using {{method}}."',
      expectedResult: 'The checkout page loads in its normal state without the disabled message.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/checkout',
          state: 'Checkout review step, payments enabled, light mode',
          alt: 'Checkout review and confirm step',
          caption: 'The checkout review step, desktop view.',
          annotations: [
            { n: 1, label: 'Review and confirm heading', locator: 'h2' },
            { n: 2, label: 'Amount and installment summary', locator: 'main section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/checkout',
          state: 'Checkout review step, payments enabled, light mode',
          alt: 'Checkout review on a phone screen',
          caption: 'The review step, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-confirm-payments-s2',
      title: 'Choose a payment method',
      body: 'Under "Choose how to pay this installment", pick "Card via Stripe" ("Pay with a debit or credit card. You enter card details each time; nothing is saved or auto-charged.") or "OxSteed Credit" ("Pay from your OxSteed Credit balance."). Card details are handled by Stripe; OxSteed never sees or stores your card number. The note reads: "Each installment is paid with exactly one method. No mixed funding, and nothing is charged without your explicit confirmation."',
      expectedResult: 'Your chosen method is selected and its detail panel is visible.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/checkout',
          state: 'Payment method step, card selected, light mode',
          alt: 'Payment method options with card selected',
          caption: 'Choosing a payment method, desktop view.',
          annotations: [
            { n: 1, label: 'Card via Stripe option', locator: 'fieldset' },
            { n: 2, label: 'OxSteed Credit option', locator: 'fieldset' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/checkout',
          state: 'Payment method step, light mode',
          alt: 'Payment method options on a phone screen',
          caption: 'Choosing a method, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-confirm-payments-s3',
      title: 'Confirm and pay',
      body: 'Tick the confirmation checkbox: "I confirm I want OxSteed to charge {{amount}} to {{method}} for the {{installment}} of order {{reference}}." Without the tick, the button stays blocked with "Please tick the confirmation box to continue." Then choose "Continue to confirmation" and "Confirm and pay {{amount}}". The button shows "Submitting payment…" while the payment is sent.',
      expectedResult: 'The payment attempt is submitted without a duplicate-charge error.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/checkout',
          state: 'Confirmation step with checkbox ticked, light mode',
          alt: 'Payment confirmation with the checkbox and Confirm and pay button',
          caption: 'Confirming payment, desktop view.',
          annotations: [
            { n: 1, label: 'Confirmation checkbox', locator: 'input[type="checkbox"]' },
            { n: 2, label: 'Confirm and pay button', locator: 'button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/checkout',
          state: 'Confirmation step, light mode',
          alt: 'Payment confirmation on a phone screen',
          caption: 'Confirming payment, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-confirm-payments-s4',
      title: 'Verify the payment in history',
      body: 'Open /logistics/payments to review the payment attempt and its status. Settlement is confirmed by signed webhook only; the payments page shows the current status per attempt. If the quote changed while you were checking out, you see "The quote changed while you were checking out. Review the new version before paying." and must accept the new version first.',
      expectedResult: 'The payment attempt appears in your payment history with its current status.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/payments',
          state: 'Payments page with attempt history, light mode',
          alt: 'Logistics payments history page',
          caption: 'Payment history, desktop view.',
          annotations: [
            { n: 1, label: 'Payment attempts list', locator: 'main section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/payments',
          state: 'Payments page, light mode',
          alt: 'Payment history on a phone screen',
          caption: 'Payment history, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'The payments page lists the attempt with its status, and no duplicate payment was created.',
  recovery: [
    {
      problem: 'You see "This payment was already submitted. Check the payment status instead of paying again."',
      solution: 'Do not pay again. Open /logistics/payments and check the existing attempt status; the charge is not duplicated.',
    },
    {
      problem: 'You see "The quote changed while you were checking out."',
      solution: 'Return to checkout, review the new quote version in the acceptance gate, and accept it before confirming payment.',
    },
    {
      problem: 'You see "Online payments are not enabled yet."',
      solution: 'Logistics payments are disabled in this environment. Contact support at /support; do not attempt payment another way.',
    },
  ],
  supportContact: 'Payment issues: contact support from the in-app support page at /support.',
  relatedGuides: ['logistics-accept-quotes', 'logistics-refund-requests'],
  siteLinks: [
    { label: 'Checkout', href: '/logistics/checkout' },
    { label: 'Payments', href: '/logistics/payments' },
  ],
  sources: [
    { type: 'route', ref: '/logistics/checkout' },
    { type: 'route', ref: '/logistics/payments' },
    { type: 'screen', ref: 'client/src/pages/logistics/CheckoutPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/logistics/LogisticsPaymentsPage.jsx' },
    { type: 'handler', ref: 'POST /api/logistics/checkout/attempt' },
    { type: 'flag', ref: 'LOGISTICS_PAYMENTS_ENABLED (default off; server/middleware/requireLogisticsPayments.js)' },
  ],
};

export default guide;
