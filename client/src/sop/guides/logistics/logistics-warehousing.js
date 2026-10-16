/**
 * logistics-warehousing - Manage warehousing and inventory receipts.
 *
 * The Warehousing page is READ-ONLY: it lists inventory receipts,
 * allocations, delivery orders, and warehouses. Receiving and reconciliation
 * are performed by operators; this page shows status, expected vs received
 * quantities, and shortages.
 *
 * Sources: client/src/pages/logistics/WarehousingPage.jsx
 * Route: /logistics/warehousing
 */

const guide = {
  id: 'logistics-warehousing',
  area: 'logistics',
  slug: 'manage-warehousing',
  title: 'Manage warehousing and inventory receipts',
  audiences: ['logistics'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Review inventory receipts, allocations, delivery orders, and warehouses to confirm stock is received and released.',
  intendedRoles: ['Logistics participant (distributor)', 'Logistics participant (organizer)'],
  prerequisites: [
    { text: 'A signed-in OxSteed account.', href: '/login' },
    { text: 'Stock moving through your campaigns or orders.', guideId: 'logistics-track-shipments', href: '/logistics/shipments' },
  ],
  processMap: {
    nodes: [
      { id: 'open', label: 'Open the Warehousing page', type: 'terminal' },
      { id: 'receipts', label: 'Review the Inventory Receipts tab', type: 'step' },
      { id: 'shortage', label: 'Shortage or mismatch?', type: 'decision' },
      { id: 'reconcile', label: 'Follow up with the operator or support', type: 'step' },
      { id: 'tabs', label: 'Check Allocations, Delivery Orders, Warehouses', type: 'step' },
      { id: 'done', label: 'Inventory status confirmed', type: 'terminal' },
    ],
    edges: [
      { from: 'open', to: 'receipts' },
      { from: 'receipts', to: 'shortage' },
      { from: 'shortage', to: 'reconcile', label: 'Yes' },
      { from: 'shortage', to: 'tabs', label: 'No' },
      { from: 'reconcile', to: 'tabs' },
      { from: 'tabs', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the Warehousing page. 2. Review the "Inventory Receipts" tab: expected vs received quantities, shortages, and status per receipt. ' +
    'The page is read-only; receiving and reconciliation are performed by operators, and you monitor status here. ' +
    '3. If a receipt shows a shortage or mismatch, follow up with the operator or support. ' +
    '4. Check the "Allocations", "Delivery Orders", and "Warehouses" tabs for downstream and upstream status. 5. Confirm the inventory position is correct.',
  steps: [
    {
      id: 'logistics-warehousing-s1',
      title: 'Open the Warehousing page',
      body: 'Choose Warehousing in the logistics navigation, or open /logistics/warehousing directly. The page is titled "Warehousing" with the subtitle "Receive, reconcile, allocate, and release inventory to buyers." Four tabs sit in the tab list ("Warehousing views"): "Inventory Receipts", "Allocations", "Delivery Orders", and "Warehouses".',
      expectedResult: 'The Warehousing page loads with the Inventory Receipts tab selected.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/warehousing',
          state: 'Warehousing page, receipts tab, signed in, light mode',
          alt: 'Warehousing page with the four tabs visible',
          caption: 'The Warehousing page, desktop view.',
          annotations: [
            { n: 1, label: 'Warehousing title', locator: 'h1' },
            { n: 2, label: 'Tab list', locator: '[role="tablist"]' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/warehousing',
          state: 'Warehousing page, signed in, light mode',
          alt: 'Warehousing page on a phone screen',
          caption: 'The Warehousing page, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-warehousing-s2',
      title: 'Review inventory receipts',
      body: 'On the "Inventory Receipts" tab, the table shows columns Reference, Warehouse, Expected, Received, Shortage, and Status. A fully received row has received equal to expected; a short row flags a shortage. Note: this page has no Receive or Reconcile buttons; receiving is recorded by operators and you monitor it here. If data fails to load, the page shows "Data unavailable" with a "Try again" button.',
      expectedResult: 'You can read expected, received, shortage, and status for each receipt.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/warehousing',
          state: 'Inventory receipts table with statuses, light mode',
          alt: 'Inventory receipts table',
          caption: 'Inventory receipts, desktop view.',
          annotations: [
            { n: 1, label: 'Receipts table', locator: 'table' },
            { n: 2, label: 'Expected vs Received columns', locator: 'table' },
            { n: 3, label: 'Status column', locator: 'table' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/warehousing',
          state: 'Inventory receipts table, light mode',
          alt: 'Receipts on a phone screen',
          caption: 'Inventory receipts, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-warehousing-s3',
      title: 'Check allocations and delivery orders',
      body: 'Choose the "Allocations" tab to see buyer allocations with Buyer, Qty, Release Method, and Released columns. Choose "Delivery Orders" for outbound delivery status. These views are also read-only here; release and delivery actions live on the Distribution board.',
      expectedResult: 'You can confirm which allocations are released and where deliveries stand.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/warehousing',
          state: 'Allocations tab, light mode',
          alt: 'Allocations table with release status',
          caption: 'Allocations, desktop view.',
          annotations: [
            { n: 1, label: 'Allocations tab selected', locator: '[role="tab"][aria-selected="true"]' },
            { n: 2, label: 'Release status columns', locator: 'table' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/warehousing',
          state: 'Allocations tab, light mode',
          alt: 'Allocations on a phone screen',
          caption: 'Allocations, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-warehousing-s4',
      title: 'Review the warehouses list',
      body: 'Choose the "Warehouses" tab to see the warehouses involved in your supply chain, including bonded status where shown. If a tab shows "No receipts found", "No allocations found", "No delivery orders found", or "No warehouses found", there is simply no data for that view yet.',
      expectedResult: 'You can see the warehouse list for your supply chain.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/warehousing',
          state: 'Warehouses tab, light mode',
          alt: 'Warehouses list',
          caption: 'Warehouses, desktop view.',
          annotations: [
            { n: 1, label: 'Warehouses list', locator: 'main section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/warehousing',
          state: 'Warehouses tab, light mode',
          alt: 'Warehouses on a phone screen',
          caption: 'Warehouses, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'Each tab shows current data: receipts with expected vs received, allocations with release status, and the warehouse list.',
  recovery: [
    {
      problem: 'A receipt shows a shortage that does not match reality.',
      solution: 'Contact the warehouse operator or support at /support with the receipt reference; reconciliation is operator-performed.',
    },
    {
      problem: 'A tab shows "No receipts found."',
      solution: 'No inventory has been received against your account yet. Confirm upstream shipments reached the warehouse.',
    },
  ],
  supportContact: 'Warehousing or receipt questions: contact support from the in-app support page at /support.',
  relatedGuides: ['logistics-distribution', 'logistics-track-shipments'],
  siteLinks: [
    { label: 'Warehousing', href: '/logistics/warehousing' },
    { label: 'Distribution', href: '/logistics/distribution' },
  ],
  sources: [
    { type: 'route', ref: '/logistics/warehousing' },
    { type: 'screen', ref: 'client/src/pages/logistics/WarehousingPage.jsx' },
    { type: 'handler', ref: 'GET /api/logistics/inventory-receipts' },
    { type: 'handler', ref: 'GET /api/logistics/warehouses' },
  ],
};

export default guide;
