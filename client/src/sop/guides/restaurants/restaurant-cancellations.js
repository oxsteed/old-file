/**
 * restaurant-cancellations - Cancel a food order.
 * Sources: client/src/pages/OrderDetailsPage.jsx,
 * client/src/pages/food/FoodMerchantPage.jsx,
 * client/src/pages/food/FoodKitchenPage.jsx
 * Routes: /food/orders/:orderId, /orders
 */

const guide = {
  id: 'restaurant-cancellations',
  area: 'restaurants',
  slug: 'restaurant-cancellations',
  title: 'Cancel a food order',
  audiences: ['customer', 'restaurant'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Cancel an order that cannot be fulfilled, from the customer or the restaurant side, with the right money handling.',
  intendedRoles: ['Customer', 'Restaurant owner', 'Restaurant manager', 'Kitchen staff'],
  prerequisites: [
    { text: 'Sign in to your OxSteed account.', href: '/login' },
    { text: 'Open the order you want to cancel.' },
  ],
  processMap: {
    nodes: [
      { id: 'open', label: 'Open the order', type: 'terminal' },
      { id: 'who', label: 'Customer or restaurant?', type: 'decision' },
      { id: 'cancel', label: 'Customer: Cancel order with confirmation', type: 'step' },
      { id: 'ask', label: 'Food order: ask the restaurant via Get help', type: 'step' },
      { id: 'merchant', label: 'Restaurant: Cancel in the order center', type: 'step' },
      { id: 'money', label: 'Money follows the cancel (refund or credit)', type: 'step' },
      { id: 'done', label: 'Order cancelled', type: 'terminal' },
    ],
    edges: [
      { from: 'open', to: 'who' },
      { from: 'who', to: 'cancel', label: 'Customer, eligible order' },
      { from: 'who', to: 'ask', label: 'Customer, food order' },
      { from: 'who', to: 'merchant', label: 'Restaurant' },
      { from: 'cancel', to: 'money' },
      { from: 'ask', to: 'merchant' },
      { from: 'merchant', to: 'money' },
      { from: 'money', to: 'done' },
    ],
  },
  processMapText:
    'Open the order and decide who cancels it. Customers can cancel eligible non-food orders themselves with the "Cancel order" button after confirming. Food orders are cancelled by the restaurant from the order center, or by asking through "Get help with this order". The restaurant cancels from the order center or recalls the ticket in the kitchen. The payment is then refunded or returned to restaurant credit depending on how it was paid.',
  steps: [
    {
      id: 'restaurant-cancellations-s1',
      title: 'Open the order',
      body: 'Open the order from /orders or /food/orders/:orderId. The page shows the "Order summary", "Payment details", and the current order status.',
      expectedResult: 'You can see the order status and whether a cancel option is available.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/orders/:orderId',
          state: 'Order detail page with actions, light mode',
          alt: 'Order detail page with the action buttons',
          caption: 'Opening the order, desktop view.',
          annotations: [
            { n: 1, label: 'Order summary', locator: 'main section' },
            { n: 2, label: 'Order actions', locator: 'main div' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/orders/:orderId',
          state: 'Order detail page with actions, light mode',
          alt: 'Order detail on a phone screen',
          caption: 'Opening the order, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-cancellations-s2',
      title: 'Cancel an eligible order as a customer',
      body: 'For non-food orders in "pending" or "paid" status, choose "Cancel order" and confirm in the dialog. The "Cancel order" button only renders while the order is still cancellable; food orders are handled by the restaurant instead.',
      expectedResult: 'The order status changes to cancelled and you see "Order cancelled".',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/orders/:orderId',
          state: 'Order detail with Cancel order button, light mode',
          alt: 'Cancel order button on an order',
          caption: 'Cancelling as a customer, desktop view.',
          annotations: [
            { n: 1, label: 'Cancel order button', locator: 'main button.orders-btn-danger' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/orders/:orderId',
          state: 'Order detail with Cancel order button, light mode',
          alt: 'Cancel order on a phone screen',
          caption: 'Cancelling as a customer, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-cancellations-s3',
      title: 'Ask the restaurant about a food order',
      body: 'Food orders cannot be cancelled from the order detail page. Choose "Get help with this order" on the order and send a message asking the restaurant to cancel. The restaurant cancels from its side.',
      expectedResult: 'The restaurant receives your request and cancels the order for you.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/food/orders/:orderId',
          state: 'Order detail with Get help panel, light mode',
          alt: 'Get help with this order panel',
          caption: 'Asking the restaurant, desktop view.',
          annotations: [
            { n: 1, label: 'Get help with this order button', locator: 'main button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/food/orders/:orderId',
          state: 'Order detail with Get help panel, light mode',
          alt: 'Get help on a phone screen',
          caption: 'Asking the restaurant, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-cancellations-s4',
      title: 'Cancel an order in the restaurant order center',
      body: 'On the restaurant dashboard at /restaurants/merchant, open the "Orders" tab ("Manage live service and find every completed, cancelled, or refunded order."). Choose the order ("Select an order", then "Order details"). On orders with status received, accepted, or preparing, choose "Cancel" to set the order to cancelled. Advance other orders with the status button ("Start preparing", "Mark ready", "Complete") instead.',
      expectedResult: 'The order status becomes cancelled and appears in the "Order history" view.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/restaurants/merchant',
          state: 'Order center with order detail and Cancel button, light mode',
          alt: 'Order center order detail with the Cancel button',
          caption: 'Cancelling in the order center, desktop view.',
          annotations: [
            { n: 1, label: 'Orders tab', locator: '[role=tablist] button' },
            { n: 2, label: 'Cancel button', locator: 'main button.fd-btn-danger' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/restaurants/merchant',
          state: 'Order center with order detail and Cancel button, light mode',
          alt: 'Order center on a phone screen',
          caption: 'Cancelling in the order center, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-cancellations-s5',
      title: 'Recall a kitchen ticket if needed',
      body: 'If the ticket is already on the Kitchen display, use "Recall" on the item or "Reopen" on the order so the kitchen stops working it.',
      expectedResult: 'The kitchen stops preparing the cancelled order.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/restaurants/kitchen/:restaurantId',
          state: 'Kitchen ticket with Recall button, light mode',
          alt: 'Kitchen ticket with recall control',
          caption: 'Recalling a kitchen ticket, desktop view.',
          annotations: [
            { n: 1, label: 'Recall button', locator: 'main article button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/restaurants/kitchen/:restaurantId',
          state: 'Kitchen ticket with Recall button, light mode',
          alt: 'Kitchen ticket on a phone screen',
          caption: 'Recalling a kitchen ticket, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-cancellations-s6',
      title: 'Confirm the money handling',
      body: 'Cancellation does not automatically refund every payment type. Card orders are refunded by cancelling ("Card orders are refunded by cancelling the order. The card refund happens automatically."). Orders paid with Restaurant credit are re-credited to the restaurant wallet; direct or pay-at-restaurant orders are simply marked cancelled. Use the refund guide for refund-specific flows.',
      expectedResult: 'The order shows "Payment refunded" or the credit returns to the customer wallet.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/food/orders/:orderId',
          state: 'Cancelled order with payment status, light mode',
          alt: 'Cancelled order showing the payment status',
          caption: 'Checking payment status after cancellation, desktop view.',
          annotations: [
            { n: 1, label: 'Payment details section', locator: 'main section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/food/orders/:orderId',
          state: 'Cancelled order with payment status, light mode',
          alt: 'Cancelled order on a phone screen',
          caption: 'Checking payment status after cancellation, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'The order status is cancelled and the payment shows the right follow-up: refunded, re-credited, or marked.',
  recovery: [
    {
      problem: 'The "Cancel order" button is missing on a food order.',
      solution: 'That is expected: food orders are cancelled by the restaurant. Use "Get help with this order" to ask the restaurant to cancel.',
    },
    {
      problem: 'Cancelling failed.',
      solution: 'You see "Failed to cancel order" or "Could not update the order." Retry; if the order already moved to ready or completed, it can no longer be cancelled.',
    },
    {
      problem: 'The payment was not refunded after cancelling.',
      solution: 'Only card payments refund automatically on cancel. Restaurant credit returns to the wallet, and direct payments need the merchant refund flow. See the refunds guide.',
    },
  ],
  supportContact: 'For cancellation help, use the in-app support page at /support.',
  relatedGuides: ['restaurant-ordering', 'restaurant-refund-requests', 'restaurant-preparation'],
  siteLinks: [
    { label: 'My orders', href: '/orders' },
    { label: 'Restaurant dashboard', href: '/restaurants/merchant' },
  ],
  sources: [
    { type: 'route', ref: '/food/orders/:orderId' },
    { type: 'route', ref: '/orders' },
    { type: 'screen', ref: 'client/src/pages/OrderDetailsPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/food/FoodMerchantPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/food/FoodKitchenPage.jsx' },
  ],
};

export default guide;
