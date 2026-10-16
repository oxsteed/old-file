/**
 * restaurant-pickup-delivery-handoff - Hand off pickup and delivery orders.
 * Sources: client/src/pages/food/FoodTrackPage.jsx,
 * client/src/pages/food/RestaurantRunnerPage.jsx,
 * client/src/pages/PublicTrackingPage.jsx
 * Routes: /food/track/:token, /restaurants/runner/:restaurantId, /t/:token
 */

const guide = {
  id: 'restaurant-pickup-delivery-handoff',
  area: 'restaurants',
  slug: 'restaurant-pickup-delivery-handoff',
  title: 'Hand off pickup and delivery orders',
  audiences: ['restaurant', 'customer'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Hand pickup orders to guests and complete runner deliveries with proof, so every order has a clear handoff record.',
  intendedRoles: ['Customer', 'Runner', 'Restaurant owner', 'Restaurant manager'],
  prerequisites: [
    { text: 'The order is marked ready in the kitchen display.', guideId: 'restaurant-preparation' },
    { text: 'Runners: sign in and open the runner page for your restaurant.' },
  ],
  processMap: {
    nodes: [
      { id: 'ready', label: 'Order is ready', type: 'terminal' },
      { id: 'fulfill', label: 'Pickup or delivery?', type: 'decision' },
      { id: 'pickup', label: 'Guest follows the track page and picks up', type: 'step' },
      { id: 'offer', label: 'Runner claims the delivery offer', type: 'step' },
      { id: 'deliver', label: 'Runner delivers with proof', type: 'step' },
      { id: 'settle', label: 'Runner settles cash and records remittance', type: 'step' },
      { id: 'done', label: 'Handoff complete', type: 'terminal' },
    ],
    edges: [
      { from: 'ready', to: 'fulfill' },
      { from: 'fulfill', to: 'pickup', label: 'Pickup' },
      { from: 'fulfill', to: 'offer', label: 'Delivery' },
      { from: 'offer', to: 'deliver' },
      { from: 'deliver', to: 'settle' },
      { from: 'settle', to: 'done' },
      { from: 'pickup', to: 'done' },
    ],
  },
  processMapText:
    'When the kitchen marks an order ready, pickup guests follow the track page to the counter while delivery orders go to the runner page as "New delivery offers". The runner claims the offer, shares live location, starts the delivery, logs proof, and marks it delivered. Cash orders are settled through "Create settlement", "Mark paid", and "Record remittance".',
  steps: [
    {
      id: 'restaurant-pickup-delivery-handoff-s1',
      title: 'Follow the track page as a guest',
      body: 'Open /food/track/:token ("Track Order"). It shows "Order", "Status", "Ready around", "Payment", "Items", and "Total". When the order is ready, pick it up at the counter. "Print Receipt" gives you the paper record.',
      expectedResult: 'You know when and where to collect the order, and you have the receipt.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/food/track/:token',
          state: 'Track Order page with order status, light mode',
          alt: 'Order tracking page with status and items',
          caption: 'Tracking a pickup order, desktop view.',
          annotations: [
            { n: 1, label: 'Order status', locator: 'main section' },
            { n: 2, label: 'Print Receipt button', locator: 'main button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/food/track/:token',
          state: 'Track Order page with order status, light mode',
          alt: 'Order tracking on a phone screen',
          caption: 'Tracking a pickup order, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-pickup-delivery-handoff-s2',
      title: 'Claim a delivery offer as a runner',
      body: 'Open /restaurants/runner/:restaurantId ("Runner"). Under "New delivery offers", choose "Claim" on an offer (or "Decline" to skip it). The page shows your "Active", "Delivered", "New offers", and "Failed" counts.',
      expectedResult: 'You see "Task claimed" and the delivery appears under your active tasks.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/restaurants/runner/:restaurantId',
          state: 'Runner page with new delivery offers, light mode',
          alt: 'Runner page with delivery offers and Claim buttons',
          caption: 'Claiming a delivery, desktop view.',
          annotations: [
            { n: 1, label: 'Status counts', locator: 'main section' },
            { n: 2, label: 'Claim button', locator: 'main article button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/restaurants/runner/:restaurantId',
          state: 'Runner page with new delivery offers, light mode',
          alt: 'Runner offers on a phone screen',
          caption: 'Claiming a delivery, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-pickup-delivery-handoff-s3',
      title: 'Start the delivery and share your location',
      body: 'Choose "Start delivery" on the claimed task. Choose "Share live location" so the customer sees "Runner nearby" with "location updated Xs ago". Use "Stop sharing" when the delivery is done.',
      expectedResult: 'The customer tracking page shows your live position.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/restaurants/runner/:restaurantId',
          state: 'Active delivery task with location sharing, light mode',
          alt: 'Active task with Start delivery and location sharing',
          caption: 'Starting a delivery, desktop view.',
          annotations: [
            { n: 1, label: 'Start delivery button', locator: 'main article button' },
            { n: 2, label: 'Share live location button', locator: 'main button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/restaurants/runner/:restaurantId',
          state: 'Active delivery task with location sharing, light mode',
          alt: 'Active task on a phone screen',
          caption: 'Starting a delivery, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-pickup-delivery-handoff-s4',
      title: 'Log proof and mark the delivery done',
      body: 'Choose "Log proof" on the task ("Proof for Order"), add a "Note" ("Describe the delivery..."), and choose "Save proof" ("Proof saved"). Then choose "Mark delivered". If something went wrong, use "Report issue" with "Severity" and "Description", then "Submit" ("Issue reported").',
      expectedResult: 'The delivery completes with proof on record.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/restaurants/runner/:restaurantId',
          state: 'Delivery task with proof form, light mode',
          alt: 'Proof of delivery form',
          caption: 'Logging proof of delivery, desktop view.',
          annotations: [
            { n: 1, label: 'Log proof button', locator: 'main article button' },
            { n: 2, label: 'Mark delivered button', locator: 'main article button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/restaurants/runner/:restaurantId',
          state: 'Delivery task with proof form, light mode',
          alt: 'Proof form on a phone screen',
          caption: 'Logging proof of delivery, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-pickup-delivery-handoff-s5',
      title: 'Settle cash collected on delivery',
      body: 'For cash orders, open "Settlements" and choose "Create settlement" ("Cash collected by the runner (amount)"). The restaurant uses "Approve" and "Mark paid" ("Payment reference"), then the runner uses "Record remittance" ("Cash remitted (expected {{amount}})") so "Cash collected" and "Cash remitted" reconcile.',
      expectedResult: 'The settlement shows as paid and remitted, with no open cash balance.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/restaurants/runner/:restaurantId',
          state: 'Runner settlements section, light mode',
          alt: 'Settlements with Create settlement and remittance controls',
          caption: 'Settling cash, desktop view.',
          annotations: [
            { n: 1, label: 'Settlements section', locator: 'main section' },
            { n: 2, label: 'Create settlement button', locator: 'main button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/restaurants/runner/:restaurantId',
          state: 'Runner settlements section, light mode',
          alt: 'Settlements on a phone screen',
          caption: 'Settling cash, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'The order shows as handed off: picked up at the counter, or delivered with proof and cash settled.',
  recovery: [
    {
      problem: 'The track page says "Order not found".',
      solution: 'The link token may be wrong or expired. Open the order from /orders instead, or ask the restaurant for a fresh link.',
    },
    {
      problem: 'Location sharing is unavailable on the runner device.',
      solution: 'You see "Location sharing is not supported on this device" or "Location permission was denied". Enable location permission in the browser and retry.',
    },
    {
      problem: 'Proof of delivery is required but you skipped it.',
      solution: 'You see "Proof of delivery is required before completing this task". Choose "Log proof", save the proof, then choose "Mark delivered".',
    },
  ],
  supportContact: 'For delivery issues, use the in-app support page at /support.',
  relatedGuides: ['restaurant-ordering', 'restaurant-preparation', 'restaurant-staff-tools'],
  siteLinks: [
    { label: 'My orders', href: '/orders' },
    { label: 'Restaurant dashboard', href: '/restaurants/merchant' },
  ],
  sources: [
    { type: 'route', ref: '/food/track/:token' },
    { type: 'route', ref: '/restaurants/runner/:restaurantId' },
    { type: 'route', ref: '/t/:token' },
    { type: 'screen', ref: 'client/src/pages/food/FoodTrackPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/food/RestaurantRunnerPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/PublicTrackingPage.jsx' },
  ],
};

export default guide;
