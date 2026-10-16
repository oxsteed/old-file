/**
 * logistics-sourcing - Create sourcing requests and collect supplier quotes.
 * Sources: client/src/pages/logistics/SourcingPage.jsx,
 * client/src/pages/logistics/NewRequestPage.jsx,
 * client/src/pages/logistics/RequestDetailPage.jsx
 * Routes: /logistics/sourcing, /logistics/sourcing/new, /logistics/requests/:id
 */

const guide = {
  id: 'logistics-sourcing',
  area: 'logistics',
  slug: 'create-sourcing-request',
  title: 'Create sourcing requests and collect supplier quotes',
  audiences: ['logistics', 'business'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Publish a sourcing request with product specs and logistics details so suppliers can send quotes.',
  intendedRoles: ['Logistics participant (buyer)', 'Business owner'],
  prerequisites: [
    { text: 'A signed-in OxSteed account.', href: '/login' },
    { text: 'Product details: title, category, quantity, target price, destination country.', href: '/logistics/sourcing' },
  ],
  processMap: {
    nodes: [
      { id: 'open-sourcing', label: 'Open the Sourcing page', type: 'terminal' },
      { id: 'new-request', label: 'Choose New Request', type: 'step' },
      { id: 'step1', label: 'Step 1: What and How Many', type: 'step' },
      { id: 'step2', label: 'Step 2: Logistics', type: 'step' },
      { id: 'step3', label: 'Step 3: Review and Submit', type: 'step' },
      { id: 'quotes', label: 'Supplier quotes arrive on the request', type: 'step' },
      { id: 'done', label: 'Compare quotes on the request detail', type: 'terminal' },
    ],
    edges: [
      { from: 'open-sourcing', to: 'new-request' },
      { from: 'new-request', to: 'step1' },
      { from: 'step1', to: 'step2' },
      { from: 'step2', to: 'step3' },
      { from: 'step3', to: 'quotes' },
      { from: 'quotes', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the Sourcing page. 2. Choose New Request. 3. Complete step 1, What and How Many: product title, category, specs, quantity, and pricing targets. ' +
    '4. Complete step 2, Logistics: lane, destination country, freight mode, need-by date, and attachments. ' +
    '5. Review everything in step 3 and choose Submit Request. 6. Supplier quotes arrive on the request, and you compare them on the request detail page.',
  steps: [
    {
      id: 'logistics-sourcing-s1',
      title: 'Open the Sourcing page',
      body: 'Choose Sourcing in the logistics navigation, or open /logistics/sourcing directly. The page is titled "Sourcing" with the subtitle "Request, quote, and convert, from first inquiry to purchase order." Your existing requests appear in a table with columns Reference, Title, Category, Lane, Qty, Status, and Quotes. Choose "New Request" to start.',
      expectedResult: 'The Sourcing page loads with your request table and the "New Request" button.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/sourcing',
          state: 'Sourcing page with existing requests, signed in, light mode',
          alt: 'Sourcing page with the request table and New Request button',
          caption: 'The Sourcing page, desktop view.',
          annotations: [
            { n: 1, label: 'New Request button', locator: 'button' },
            { n: 2, label: 'Request table', locator: 'table' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/sourcing',
          state: 'Sourcing page, signed in, light mode',
          alt: 'Sourcing page on a phone screen',
          caption: 'The Sourcing page, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-sourcing-s2',
      title: 'Describe what you need and how many',
      body: 'On the "New Sourcing Request" page, step 1 is "What & How Many". Enter "Product Title", choose "Category", write "Description / Specs", and enter "Quantity", "Target Unit Price (USD)", and "Total Budget (USD)". Use the "Back" and "Next" buttons to move between steps.',
      expectedResult: 'Step 1 fields are complete and "Next" moves you to the Logistics step.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/sourcing/new',
          state: 'New request step 1 filled in, light mode',
          alt: 'Step 1 of the sourcing request form with product fields',
          caption: 'Step 1: What and How Many, desktop view.',
          annotations: [
            { n: 1, label: 'Product Title field', locator: 'input' },
            { n: 2, label: 'Quantity and pricing fields', locator: 'input' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/sourcing/new',
          state: 'New request step 1, light mode',
          alt: 'Step 1 of the sourcing form on a phone screen',
          caption: 'Step 1, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-sourcing-s3',
      title: 'Set the logistics details',
      body: 'Step 2 is "Logistics". Choose the "Lane", "Destination Country", and "Preferred Freight Mode", set "Need By Date", and add "Attachments (optional)" such as spec sheets. Choose "Next" to continue.',
      expectedResult: 'The logistics fields are complete and you reach the review step.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/sourcing/new',
          state: 'New request step 2 filled in, light mode',
          alt: 'Step 2 of the sourcing request form with lane and freight fields',
          caption: 'Step 2: Logistics, desktop view.',
          annotations: [
            { n: 1, label: 'Lane selector', locator: 'select' },
            { n: 2, label: 'Freight mode and dates', locator: 'input' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/sourcing/new',
          state: 'New request step 2, light mode',
          alt: 'Step 2 on a phone screen',
          caption: 'Step 2, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-sourcing-s4',
      title: 'Review and submit the request',
      body: 'Step 3 is "Review & Submit" with the heading "Review your request". Check the summary of product, logistics, and pricing. Choose "Submit Request". You land on the request detail page, which shows the "Specifications" section and the "Quotes ({{count}})" section.',
      expectedResult: 'The request is published and the detail page shows "Quotes (0)" until suppliers respond.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/sourcing/new',
          state: 'Review step before submitting, light mode',
          alt: 'Review step with the Submit Request button',
          caption: 'Step 3: Review and Submit, desktop view.',
          annotations: [
            { n: 1, label: 'Request summary', locator: 'main section' },
            { n: 2, label: 'Submit Request button', locator: 'button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/sourcing/new',
          state: 'Review step, light mode',
          alt: 'Review step on a phone screen',
          caption: 'Step 3, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-sourcing-s5',
      title: 'Compare supplier quotes on the request detail',
      body: 'Open your request from the Sourcing table to return to its detail page at /logistics/requests/:id. The "Quotes ({{count}})" section lists each supplier quote with "Quoted qty", "Unit price", "Freight est", and "Lead time" in days. Use "← Back to Sourcing" to return to the table. Accepting a quote and paying happens in the finance and checkout flow (see the accept-quotes guide).',
      expectedResult: 'You can compare supplier quotes side by side on the request.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/requests/:id',
          state: 'Request detail with two supplier quotes, light mode',
          alt: 'Request detail page with the quotes table',
          caption: 'Comparing supplier quotes, desktop view.',
          annotations: [
            { n: 1, label: 'Quotes section', locator: 'section' },
            { n: 2, label: 'Quoted qty and unit price', locator: 'table' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/requests/:id',
          state: 'Request detail with quotes, light mode',
          alt: 'Request detail on a phone screen',
          caption: 'Comparing quotes, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'Your request appears in the Sourcing table and its detail page lists incoming supplier quotes.',
  recovery: [
    {
      problem: 'The request fails to submit.',
      solution: 'Go back through the steps and complete every required field. Check your connection and choose "Submit Request" again.',
    },
    {
      problem: 'No quotes arrive after a few days.',
      solution: 'Check that the lane and destination country are correct, and widen the target price range if it was very tight. Contact support at /support if the request looks stuck.',
    },
  ],
  supportContact: 'Sourcing or quote questions: contact support from the in-app support page at /support.',
  relatedGuides: ['logistics-accept-quotes', 'logistics-track-shipments'],
  siteLinks: [
    { label: 'Sourcing', href: '/logistics/sourcing' },
    { label: 'New sourcing request', href: '/logistics/sourcing/new' },
  ],
  sources: [
    { type: 'route', ref: '/logistics/sourcing' },
    { type: 'route', ref: '/logistics/sourcing/new' },
    { type: 'route', ref: '/logistics/requests/:id' },
    { type: 'screen', ref: 'client/src/pages/logistics/SourcingPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/logistics/NewRequestPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/logistics/RequestDetailPage.jsx' },
    { type: 'handler', ref: 'POST /api/logistics/requests' },
    { type: 'handler', ref: 'POST /api/logistics/requests/:requestId/quotes' },
  ],
};

export default guide;
