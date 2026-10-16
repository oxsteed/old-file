/**
 * financial-receipts - View receipts.
 * Sources: client/src/pages/DirectPortalPage.jsx,
 * client/src/pages/OrderDetailsPage.jsx,
 * client/src/pages/PayByQrPage.jsx
 * Routes: /direct/payments/:id (receipt view), /food/orders/:orderId
 */

const guide = {
  id: 'financial-receipts',
  area: 'financial',
  slug: 'financial-receipts',
  title: 'View receipts',
  audiences: ['customer'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Find the receipt for any payment: a Direct payment, a food order, or a QR payment.',
  intendedRoles: ['Customer'],
  prerequisites: [
    { text: 'Sign in to your OxSteed account for order and payment receipts.', href: '/login' },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Identify the payment', type: 'terminal' },
      { id: 'which', label: 'Direct, food order, or QR?', type: 'decision' },
      { id: 'direct', label: 'Open the Direct payment receipt', type: 'step' },
      { id: 'food', label: 'Open the food order detail', type: 'step' },
      { id: 'qr', label: 'Check the QR payment confirmation', type: 'step' },
      { id: 'done', label: 'Receipt reviewed', type: 'terminal' },
    ],
    edges: [
      { from: 'start', to: 'which' },
      { from: 'which', to: 'direct', label: 'Direct payment' },
      { from: 'which', to: 'food', label: 'Food order' },
      { from: 'which', to: 'qr', label: 'QR payment' },
      { from: 'direct', to: 'done' },
      { from: 'food', to: 'done' },
      { from: 'qr', to: 'done' },
    ],
  },
  processMapText:
    'OxSteed renders receipts in context rather than in a standalone receipts hub. For Direct payments, open /direct/payments/:id ("Receipt confirmation") and use "Confirm receipt". For food orders, open /food/orders/:orderId or /orders/:id, where the order detail shows items, the order summary, and payment details. For QR payments, the "Payment successful" screen is the receipt.',
  steps: [
    {
      id: 'financial-receipts-s1',
      title: 'Open a Direct payment receipt',
      body: 'Open /direct/payments/:id. The page shows "Receipt confirmation" ("Confirm that the proof has been received and tied to history."). Review the payment record, then choose "Confirm receipt" ("Receipt confirmed.").',
      expectedResult: 'The receipt is confirmed and tied to the payment history.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/direct/payments/:id',
          state: 'Direct payment receipt confirmation, light mode',
          alt: 'Direct payment receipt with confirm button',
          caption: 'A Direct payment receipt, desktop view.',
          annotations: [
            { n: 1, label: 'Receipt confirmation heading', locator: 'main h1' },
            { n: 2, label: 'Confirm receipt button', locator: 'main button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/direct/payments/:id',
          state: 'Direct payment receipt confirmation, light mode',
          alt: 'Receipt on a phone screen',
          caption: 'A Direct payment receipt, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'financial-receipts-s2',
      title: 'Review a food order as a receipt',
      body: 'Open the order from /orders or /food/orders/:orderId. The order detail is the receipt: the "Order summary" card shows "Subtotal", "Tax", "Shipping", "Discount", and "Total", and the "Payment details" card shows the "Payment method", payment "Status", and "Transaction ID". Items list each price and quantity ("Your order").',
      expectedResult: 'You can read every line item, the totals, and the payment record.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/food/orders/:orderId',
          state: 'Order detail with summary and payment cards, light mode',
          alt: 'Order detail with summary and payment details',
          caption: 'A food order receipt, desktop view.',
          annotations: [
            { n: 1, label: 'Your order items', locator: 'main section' },
            { n: 2, label: 'Order summary', locator: 'main section' },
            { n: 3, label: 'Payment details', locator: 'main section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/food/orders/:orderId',
          state: 'Order detail with summary and payment cards, light mode',
          alt: 'Order receipt on a phone screen',
          caption: 'A food order receipt, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'financial-receipts-s3',
      title: 'Print a food order receipt',
      body: 'On the order tracking page (/food/track/:token), choose "Print Receipt" for the paper record of the order ("Order", "Status", "Items", "Total").',
      expectedResult: 'The browser print dialog opens with the order receipt.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/food/track/:token',
          state: 'Track Order page with Print Receipt, light mode',
          alt: 'Track page with the Print Receipt button',
          caption: 'Printing a receipt, desktop view.',
          annotations: [
            { n: 1, label: 'Print Receipt button', locator: 'main button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/food/track/:token',
          state: 'Track Order page with Print Receipt, light mode',
          alt: 'Track page on a phone screen',
          caption: 'Printing a receipt, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'financial-receipts-s4',
      title: 'Keep the QR payment confirmation',
      body: 'After paying at /pay/:code, the "Payment successful" screen shows the amount and recipient and is your receipt. The optional "Email for receipt (optional)" field ("you@example.com") sends a copy to your email if you filled it in before paying.',
      expectedResult: 'You have a record of the payment on screen and, if you entered it, in your email.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/pay/:code/success',
          state: 'Payment successful confirmation, light mode',
          alt: 'QR payment success screen',
          caption: 'A QR payment receipt, desktop view.',
          annotations: [
            { n: 1, label: 'Payment successful heading', locator: 'main h2' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/pay/:code/success',
          state: 'Payment successful confirmation, light mode',
          alt: 'Success on a phone screen',
          caption: 'A QR payment receipt, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'You can find the receipt for the payment and read the items, totals, and payment method.',
  recovery: [
    {
      problem: 'You cannot find an old receipt.',
      solution: 'Open /orders for order history or /direct/history for "All of your Direct quote requests, jobs, and receipts in one place." Then open the record to see its receipt view.',
    },
    {
      problem: 'The order shows "Payment failed" or no payment details.',
      solution: 'The payment never completed. Use "Order again" on the order detail to place it again with a working payment method.',
    },
  ],
  supportContact: 'For receipt issues, use the in-app support page at /support.',
  relatedGuides: ['financial-qr-payments', 'restaurant-ordering', 'financial-statements'],
  siteLinks: [
    { label: 'My orders', href: '/orders' },
    { label: 'Wallet', href: '/wallet' },
  ],
  sources: [
    { type: 'route', ref: '/direct/payments/:id' },
    { type: 'route', ref: '/food/orders/:orderId' },
    { type: 'screen', ref: 'client/src/pages/DirectPortalPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/OrderDetailsPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/PayByQrPage.jsx' },
  ],
};

export default guide;
