/**
 * other-delivery - Request and track deliveries.
 * Sources: client/src/pages/DeliveryLandingPage.jsx,
 * client/src/pages/DeliveryPage.jsx,
 * client/src/pages/DeliveryDetailPage.jsx,
 * client/src/pages/PublicTrackingPage.jsx
 * Routes: /delivery, /delivery/jobs/:id, /t/:token
 */

const guide = {
  id: 'other-delivery',
  area: 'delivery',
  slug: 'request-delivery',
  title: 'Request and track deliveries',
  audiences: ['customer', 'helper'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Get a delivery quote, post the delivery job, and track it; or claim a delivery job as a driver.',
  intendedRoles: ['Customer', 'Helper (driver)'],
  prerequisites: [
    { text: 'Guests can see the landing and get quotes. Sign in to post or claim delivery jobs.', href: '/login' },
  ],
  processMap: {
    nodes: [
      { id: 'open', label: 'Open Delivery', type: 'terminal' },
      { id: 'role', label: 'Requesting or driving?', type: 'decision' },
      { id: 'details', label: 'Enter pickup, drop-off, package, and speed', type: 'step' },
      { id: 'quote', label: 'Choose Get a quote', type: 'step' },
      { id: 'post', label: 'Choose Post delivery', type: 'step' },
      { id: 'track', label: 'Track at /delivery/jobs/:id or /t/:token', type: 'step' },
      { id: 'claim', label: 'Choose Claim delivery on an open job', type: 'step' },
      { id: 'done', label: 'Delivery posted or claimed', type: 'terminal' },
    ],
    edges: [
      { from: 'open', to: 'role' },
      { from: 'role', to: 'details', label: 'Requesting' },
      { from: 'role', to: 'claim', label: 'Driving' },
      { from: 'details', to: 'quote' },
      { from: 'quote', to: 'post' },
      { from: 'post', to: 'track' },
      { from: 'track', to: 'done' },
      { from: 'claim', to: 'done' },
    ],
  },
  processMapText:
    '1. Open Delivery at /delivery. Guests see the landing page; signed-in users see the delivery workspace. ' +
    '2. If you are requesting a delivery: enter the Pickup and Drop-off addresses, Package size, Weight (lb), Speed, and Delivery notes. ' +
    '3. Choose "Get a quote" to see "Your estimated price" with the route distance, duration, and breakdown. ' +
    '4. Choose "Post delivery" to publish the job. 5. Track it at /delivery/jobs/:id, or share the public tracking link /t/:token. ' +
    'If you are driving: open the driver view titled "Deliver nearby work", choose "Claim delivery" on an open job, and move it through pickup, transit, and drop-off.',
  steps: [
    {
      id: 'other-delivery-s1',
      title: 'Open Delivery and enter the route',
      body: 'Open /delivery. The customer form is titled "Book a delivery" with the body "Tell us where it starts, where it is going, and how quickly it needs to arrive." Enter "Pickup" ("Choose a pickup address") and "Drop-off" ("Choose a drop-off address"). Choose an address suggestion for both stops so the route can be priced accurately.',
      expectedResult: 'Both stops show selected addresses.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/delivery',
          state: 'Book a delivery form, guest, light mode',
          alt: 'Book a delivery form with pickup and drop-off fields',
          caption: 'Booking a delivery, desktop view.',
          annotations: [
            { n: 1, label: 'Book a delivery title', locator: 'h1' },
            { n: 2, label: 'Pickup field', locator: 'input' },
            { n: 3, label: 'Drop-off field', locator: 'input' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/delivery',
          state: 'Book a delivery form, guest, light mode',
          alt: 'Delivery form on a phone screen',
          caption: 'Booking a delivery, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-delivery-s2',
      title: 'Set package details and get a quote',
      body: 'Set "Package size", "Weight (lb)", "Speed", and "Delivery notes" ("Access instructions, landmarks, or special handling"). Choose "Get a quote". The panel "Your estimated price" shows the route ("{{miles}} mi route", "About {{minutes}} min") and the breakdown: Delivery, Platform fee, Tolls and parking, and Customer total. Quotes expire: "Quote valid for {{minutes}} minutes".',
      expectedResult: 'The estimated price panel shows the route and the customer total.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/delivery',
          state: 'Quote panel with estimated price, light mode',
          alt: 'Estimated price panel with route and total',
          caption: 'The delivery quote, desktop view.',
          annotations: [
            { n: 1, label: 'Package details', locator: 'fieldset' },
            { n: 2, label: 'Your estimated price panel', locator: 'aside' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/delivery',
          state: 'Quote panel, light mode',
          alt: 'Estimated price on a phone screen',
          caption: 'The delivery quote, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-delivery-s3',
      title: 'Post the delivery and track it',
      body: 'Choose "Post delivery". You see "Delivery posted". Open the job at /delivery/jobs/:id to follow the timeline, message the driver with "Open messages", or cancel with "Cancel delivery" ("Cancelling releases the job and notifies the other party. This cannot be undone."). Share the public tracking link /t/:token with the recipient so they can follow without signing in.',
      expectedResult: 'The delivery job is posted and tracking is available.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/delivery/jobs/:id',
          state: 'Delivery job detail with timeline, signed in, light mode',
          alt: 'Delivery job detail with the tracking timeline',
          caption: 'Tracking a delivery, desktop view.',
          annotations: [
            { n: 1, label: 'Route summary', locator: 'section' },
            { n: 2, label: 'Timeline', locator: 'section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/delivery/jobs/:id',
          state: 'Delivery job detail, signed in, light mode',
          alt: 'Delivery tracking on a phone screen',
          caption: 'Tracking a delivery, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-delivery-s4',
      title: 'Claim a delivery as a driver',
      body: 'Drivers: open /delivery while signed in as a helper to see the driver view titled "Deliver nearby work" with the body "Claim a route that fits your day and move it through pickup, transit, and drop-off." Open "My deliveries" for your claimed jobs. On an open job choose "Claim delivery", then move it through pickup, transit, and drop-off using the status actions.',
      expectedResult: 'The job is claimed and appears under "My deliveries".',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/delivery',
          state: 'Driver view with open deliveries, signed in as helper, light mode',
          alt: 'Driver delivery list with Claim delivery buttons',
          caption: 'The driver view, desktop view.',
          annotations: [
            { n: 1, label: 'Deliver nearby work title', locator: 'h1' },
            { n: 2, label: 'Claim delivery button', locator: 'button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/delivery',
          state: 'Driver view, signed in as helper, light mode',
          alt: 'Driver view on a phone screen',
          caption: 'The driver view, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'The delivery job is posted and trackable, or claimed and listed under "My deliveries".',
  recovery: [
    {
      problem: 'You see "This delivery quote has expired. Get a new quote to continue."',
      solution: 'Choose "Get a quote" again to refresh the price, then post.',
    },
    {
      problem: 'You see "The delivery details changed after pricing. Get a new quote before posting."',
      solution: 'Re-check the stops and package details, then get a fresh quote before posting.',
    },
  ],
  supportContact: 'Delivery issues: contact support from the in-app support page at /support.',
  relatedGuides: ['other-direct'],
  siteLinks: [
    { label: 'Delivery', href: '/delivery' },
  ],
  sources: [
    { type: 'route', ref: '/delivery' },
    { type: 'route', ref: '/delivery/jobs/:id' },
    { type: 'route', ref: '/t/:token' },
    { type: 'screen', ref: 'client/src/pages/DeliveryPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/DeliveryDetailPage.jsx' },
    { type: 'handler', ref: 'POST /api/local-delivery/quote' },
    { type: 'handler', ref: 'POST /api/local-delivery/jobs/:id/claim' },
  ],
};

export default guide;
