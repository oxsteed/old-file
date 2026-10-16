/**
 * logistics-track-shipments - Track shipments.
 * Sources: client/src/pages/logistics/ShipmentsPage.jsx,
 * client/src/pages/logistics/ShipmentDetailPage.jsx
 * Routes: /logistics/shipments, /logistics/shipments/:id
 */

const guide = {
  id: 'logistics-track-shipments',
  area: 'logistics',
  slug: 'track-shipments',
  title: 'Track shipments',
  audiences: ['logistics'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Monitor your logistics shipments, review milestones and documents, and spot exceptions early.',
  intendedRoles: ['Logistics participant (buyer)', 'Logistics participant (organizer)'],
  prerequisites: [
    { text: 'A signed-in OxSteed account.', href: '/login' },
    { text: 'At least one shipment tied to your orders or campaigns.', guideId: 'logistics-pledge', href: '/logistics/buyer' },
  ],
  processMap: {
    nodes: [
      { id: 'open-list', label: 'Open the Shipments page', type: 'terminal' },
      { id: 'filter', label: 'Filter by lifecycle stage', type: 'step' },
      { id: 'open-shipment', label: 'Open a shipment', type: 'step' },
      { id: 'review-details', label: 'Review details, milestones, and documents', type: 'step' },
      { id: 'exception', label: 'Exception flagged?', type: 'decision' },
      { id: 'follow-up', label: 'Follow up with support or the organizer', type: 'step' },
      { id: 'done', label: 'Shipment tracked', type: 'terminal' },
    ],
    edges: [
      { from: 'open-list', to: 'filter' },
      { from: 'filter', to: 'open-shipment' },
      { from: 'open-shipment', to: 'review-details' },
      { from: 'review-details', to: 'exception' },
      { from: 'exception', to: 'follow-up', label: 'Yes' },
      { from: 'exception', to: 'done', label: 'No' },
      { from: 'follow-up', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the Shipments page. 2. Filter by lifecycle stage to find the shipment you need. 3. Open the shipment detail page. ' +
    '4. Review the shipment details, milestones, and documents. 5. If an exception is flagged, follow up with support or your organizer. ' +
    '6. Otherwise the shipment stays tracked until delivery.',
  steps: [
    {
      id: 'logistics-track-shipments-s1',
      title: 'Open the Shipments page',
      body: 'Choose Shipments in the logistics navigation, or open /logistics/shipments directly. The page is titled "Shipments" with the subtitle "Track your goods in transit." The table shows columns Reference, Route, Carrier, Tracking #, Weight, CBM, ETA, and Status. From the Buyer Dashboard you can also use "Back to Buyer workspace" to return.',
      expectedResult: 'Your shipments appear in the table with carrier, tracking number, ETA, and status.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/shipments',
          state: 'Shipments list with several shipments, signed in, light mode',
          alt: 'Shipments table with reference, route, carrier, ETA, and status',
          caption: 'The Shipments page, desktop view.',
          annotations: [
            { n: 1, label: 'Shipments title', locator: 'h1' },
            { n: 2, label: 'Shipments table', locator: 'table' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/shipments',
          state: 'Shipments list, signed in, light mode',
          alt: 'Shipments list on a phone screen',
          caption: 'The Shipments page, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-track-shipments-s2',
      title: 'Filter by lifecycle stage',
      body: 'Use the "Filter by lifecycle stage" dropdown to narrow the list, for example to in-transit or exception shipments. The "All" option clears the filter and shows every shipment.',
      expectedResult: 'The table shows only shipments in the selected lifecycle stage.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/shipments',
          state: 'Lifecycle filter dropdown open, light mode',
          alt: 'Filter by lifecycle stage dropdown',
          caption: 'Filtering shipments, desktop view.',
          annotations: [
            { n: 1, label: 'Lifecycle filter', locator: 'select' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/shipments',
          state: 'Lifecycle filter applied, light mode',
          alt: 'Filtered shipments on a phone screen',
          caption: 'Filtering shipments, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-track-shipments-s3',
      title: 'Open a shipment detail page',
      body: 'Choose the shipment reference to open /logistics/shipments/:id. The "Shipment details" section shows Carrier, Tracking number, Booking ref, Origin port, Destination port, Total cartons, Total weight (kg), Total CBM, and ETA. Use "← Back to Shipments" to return to the list.',
      expectedResult: 'The shipment detail page loads with carrier, route, and ETA visible.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/shipments/:id',
          state: 'Shipment detail, details section visible, light mode',
          alt: 'Shipment details with carrier, ports, and ETA',
          caption: 'A shipment detail page, desktop view.',
          annotations: [
            { n: 1, label: 'Shipment details section', locator: 'section' },
            { n: 2, label: 'Carrier and tracking number', locator: 'section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/shipments/:id',
          state: 'Shipment detail, light mode',
          alt: 'Shipment detail on a phone screen',
          caption: 'A shipment detail page, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-track-shipments-s4',
      title: 'Review milestones and documents',
      body: 'Scroll to the "Milestones" section to see recorded movement events with locations and notes. The "Documents ({{count}})" section lists shipping documents; if none exist it shows "No shipping documents uploaded." If a shipment carries an "Exception" status, follow up with support at /support or your campaign organizer before it reaches customs or the warehouse.',
      expectedResult: 'You can trace the shipment timeline and open its documents.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/shipments/:id',
          state: 'Milestones and documents sections, light mode',
          alt: 'Milestones timeline and shipping documents',
          caption: 'Milestones and documents, desktop view.',
          annotations: [
            { n: 1, label: 'Milestones section', locator: 'section' },
            { n: 2, label: 'Documents section', locator: 'section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/shipments/:id',
          state: 'Milestones section, light mode',
          alt: 'Milestones on a phone screen',
          caption: 'Milestones, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'You can open any shipment and read its milestones, documents, and current status.',
  recovery: [
    {
      problem: 'The list shows "No shipments found."',
      solution: 'Check the lifecycle filter is set to "All". If still empty, no shipments are tied to your account yet; confirm your campaign reached lock.',
    },
    {
      problem: 'Tracking info looks stale or missing.',
      solution: 'Milestone and document data is recorded by the carrier feed and operators. Contact support at /support with the shipment reference.',
    },
  ],
  supportContact: 'Shipment or tracking issues: contact support from the in-app support page at /support.',
  relatedGuides: ['logistics-pledge', 'logistics-distribution'],
  siteLinks: [
    { label: 'Shipments', href: '/logistics/shipments' },
    { label: 'Buyer Dashboard', href: '/logistics/buyer' },
  ],
  sources: [
    { type: 'route', ref: '/logistics/shipments' },
    { type: 'route', ref: '/logistics/shipments/:id' },
    { type: 'screen', ref: 'client/src/pages/logistics/ShipmentsPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/logistics/ShipmentDetailPage.jsx' },
    { type: 'handler', ref: 'GET /api/logistics/shipments/:id' },
  ],
};

export default guide;
