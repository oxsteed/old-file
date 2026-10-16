/**
 * logistics-distribution - Manage distribution and deliveries.
 * Sources: client/src/pages/logistics/DistributionPage.jsx,
 * client/src/pages/logistics/DistributorResellerPage.jsx
 * Routes: /logistics/distribution, /logistics/distributor
 */

const guide = {
  id: 'logistics-distribution',
  area: 'logistics',
  slug: 'manage-distribution',
  title: 'Manage distribution and deliveries',
  audiences: ['logistics'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Review allocations and delivery orders, and keep final-mile handoffs moving.',
  intendedRoles: ['Logistics participant (distributor)', 'Logistics participant (organizer)'],
  prerequisites: [
    { text: 'A signed-in OxSteed account with distributor or organizer access.', href: '/login' },
    { text: 'Stock that has arrived and been warehoused upstream.', guideId: 'logistics-warehousing', href: '/logistics/warehousing' },
  ],
  processMap: {
    nodes: [
      { id: 'open-board', label: 'Open the Distribution board', type: 'terminal' },
      { id: 'review-allocations', label: 'Review the allocation queue', type: 'step' },
      { id: 'preview', label: 'Choose Preview on an allocation', type: 'step' },
      { id: 'check-deliveries', label: 'Check the delivery execution list', type: 'step' },
      { id: 'distributor', label: 'Open the Distributor workspace for pressure points', type: 'step' },
      { id: 'done', label: 'Handoffs monitored', type: 'terminal' },
    ],
    edges: [
      { from: 'open-board', to: 'review-allocations' },
      { from: 'review-allocations', to: 'preview' },
      { from: 'preview', to: 'check-deliveries' },
      { from: 'check-deliveries', to: 'distributor' },
      { from: 'distributor', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the Distribution board. 2. Review the allocation queue: each card shows the recipient, warehouse, release method, and allocated quantity. ' +
    '3. Choose Preview on an allocation to inspect it. 4. Check the "Delivery execution" section for delivery orders and their status. ' +
    '5. Open the Distributor workspace to see pressure points: pending release lots, deliveries in motion, and failed or cancelled drops. ' +
    '6. Keep monitoring until every lot is handed off.',
  steps: [
    {
      id: 'logistics-distribution-s1',
      title: 'Open the Distribution board',
      body: 'Choose Distribution in the logistics navigation, or open /logistics/distribution directly. The page is titled "Distribution" with the "Allocation queue" section and the "Delivery execution" section. A link "Open warehousing →" jumps to the warehousing page for upstream stock.',
      expectedResult: 'The Distribution board loads with allocation cards and delivery orders.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/distribution',
          state: 'Distribution board with allocations and deliveries, signed in, light mode',
          alt: 'Distribution board with the allocation queue',
          caption: 'The Distribution board, desktop view.',
          annotations: [
            { n: 1, label: 'Distribution title', locator: 'h1' },
            { n: 2, label: 'Allocation queue', locator: 'main section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/distribution',
          state: 'Distribution board, signed in, light mode',
          alt: 'Distribution board on a phone screen',
          caption: 'The Distribution board, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-distribution-s2',
      title: 'Review the allocation queue',
      body: 'Each allocation card shows the buyer or recipient name, the warehouse, the release method (for example "release pending"), and "Allocated qty". Release methods include Local pickup, Ship to buyer, Freight forward, Release to distributor, Bulk handoff, and Restock route. Choose "Preview" on a card to inspect the allocation in detail.',
      expectedResult: 'You can read the recipient, release method, and quantity for each allocation.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/distribution',
          state: 'Allocation queue with cards, light mode',
          alt: 'Allocation cards with release methods and quantities',
          caption: 'The allocation queue, desktop view.',
          annotations: [
            { n: 1, label: 'Allocation card', locator: '.lx-item-card' },
            { n: 2, label: 'Preview button', locator: 'button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/distribution',
          state: 'Allocation queue, light mode',
          alt: 'Allocation cards on a phone screen',
          caption: 'The allocation queue, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-distribution-s3',
      title: 'Check the delivery execution list',
      body: 'Scroll to "Delivery execution". Each delivery order card shows the recipient, status, and tracking details. The stats strip at the top summarizes Allocations, Released, Delivery Orders, and In Transit counts.',
      expectedResult: 'You can see which deliveries are in transit and which are complete.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/distribution',
          state: 'Delivery execution section, light mode',
          alt: 'Delivery execution list with delivery orders',
          caption: 'Delivery execution, desktop view.',
          annotations: [
            { n: 1, label: 'Stats strip', locator: 'main' },
            { n: 2, label: 'Delivery execution list', locator: 'section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/distribution',
          state: 'Delivery execution section, light mode',
          alt: 'Delivery execution on a phone screen',
          caption: 'Delivery execution, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-distribution-s4',
      title: 'Work the Distributor workspace pressure points',
      body: 'Open /logistics/distributor, the "Distributor / Reseller Workspace". The actions "Open distribution board" and "Check warehouse readiness" sit under the subtitle "Track allocated inventory, manage release methods, and keep final-mile handoff execution clean across resale or community distribution." The "Distribution pressure points" panel flags lots waiting on release, scheduled deliveries, and failed or cancelled drops that need rerouting or recipient follow-up.',
      expectedResult: 'You know which lots need release action and which deliveries failed.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/distributor',
          state: 'Distributor workspace, signed in, light mode',
          alt: 'Distributor workspace with pressure points panel',
          caption: 'The Distributor workspace, desktop view.',
          annotations: [
            { n: 1, label: 'Distributor / Reseller Workspace title', locator: 'h1' },
            { n: 2, label: 'Distribution pressure points', locator: 'section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/distributor',
          state: 'Distributor workspace, signed in, light mode',
          alt: 'Distributor workspace on a phone screen',
          caption: 'The Distributor workspace, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'Allocation cards show released quantities and delivery orders show current status on the board.',
  recovery: [
    {
      problem: 'The board shows "No allocations available."',
      solution: 'Allocations are created upstream after warehousing receives stock. Check /logistics/warehousing first.',
    },
    {
      problem: 'A delivery failed or was cancelled.',
      solution: 'Find it in the pressure points panel, reroute or contact the recipient, then confirm the new delivery status on the board.',
    },
  ],
  supportContact: 'Distribution or delivery issues: contact support from the in-app support page at /support.',
  relatedGuides: ['logistics-warehousing', 'logistics-track-shipments'],
  siteLinks: [
    { label: 'Distribution', href: '/logistics/distribution' },
    { label: 'Distributor workspace', href: '/logistics/distributor' },
  ],
  sources: [
    { type: 'route', ref: '/logistics/distribution' },
    { type: 'route', ref: '/logistics/distributor' },
    { type: 'screen', ref: 'client/src/pages/logistics/DistributionPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/logistics/DistributorResellerPage.jsx' },
    { type: 'handler', ref: 'GET /api/logistics/deliveries' },
    { type: 'handler', ref: 'PATCH /api/logistics/deliveries/:id/status' },
  ],
};

export default guide;
