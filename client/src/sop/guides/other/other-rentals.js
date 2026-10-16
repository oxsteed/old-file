/**
 * other-rentals - Rent and list tools.
 * Sources: client/src/pages/ToolRentalsBrowse.jsx,
 * client/src/pages/ToolOwnerDashboard.jsx,
 * client/src/pages/ToolRentalsAnalytics.tsx
 * Routes: /tool-rentals, /tool-rentals/:toolId, /tool-rentals/analytics
 */

const guide = {
  id: 'other-rentals',
  area: 'rentals',
  slug: 'rent-list-tools',
  title: 'Rent and list tools',
  audiences: ['customer', 'helper'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Find a tool to rent from a neighbor, or list your own tool to earn money.',
  intendedRoles: ['Customer', 'Helper (tool owner)'],
  prerequisites: [
    { text: 'Guests can browse. Sign in to inquire, rent, or list a tool.', href: '/login' },
  ],
  processMap: {
    nodes: [
      { id: 'open', label: 'Open tool rentals', type: 'terminal' },
      { id: 'browse', label: 'Search and browse by category', type: 'step' },
      { id: 'open-tool', label: 'Open a tool listing', type: 'step' },
      { id: 'inquire', label: 'Choose Inquire About Rental', type: 'step' },
      { id: 'list', label: 'List your own tool from the dashboard', type: 'step' },
      { id: 'analytics', label: 'Owners: review the analytics dashboard', type: 'step' },
      { id: 'done', label: 'Rental arranged or tool listed', type: 'terminal' },
    ],
    edges: [
      { from: 'open', to: 'browse' },
      { from: 'browse', to: 'open-tool' },
      { from: 'open-tool', to: 'inquire' },
      { from: 'inquire', to: 'done' },
      { from: 'open', to: 'list', label: 'Listing a tool' },
      { from: 'list', to: 'analytics' },
      { from: 'analytics', to: 'done' },
    ],
  },
  processMapText:
    '1. Open /tool-rentals, titled "Rent Tools from Your Neighbors". 2. Use the search field ("Search tools, brands, or categories...") and "Browse by category" tiles to find a tool. ' +
    '3. Open the tool listing at /tool-rentals/:toolId. 4. Sign in and choose "Inquire About Rental" to start a rental. ' +
    'To list your own tool: 5. Choose "List Your Tool" (via the dashboard skills tab). 6. Owners review earnings and activity in the analytics dashboard at /tool-rentals/analytics.',
  steps: [
    {
      id: 'other-rentals-s1',
      title: 'Browse tools for rent',
      body: 'Open /tool-rentals. The hero reads "Rent Tools from Your Neighbors" with the subtitle "Find affordable tools for rent from trusted community members in your area." Use the search field ("Search tools, brands, or categories..."), the "Browse by category" tiles, and the "Filters" panel to narrow by category and city.',
      expectedResult: 'Tool listings appear with photos, prices, and locations.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/tool-rentals',
          state: 'Tool rentals browse, guest, light mode',
          alt: 'Tool rentals with the search field and category tiles',
          caption: 'Browsing tools, desktop view.',
          annotations: [
            { n: 1, label: 'Search field', locator: 'input' },
            { n: 2, label: 'Browse by category tiles', locator: 'section' },
            { n: 3, label: 'Tool listings', locator: 'main' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/tool-rentals',
          state: 'Tool rentals browse, guest, light mode',
          alt: 'Tool browse on a phone screen',
          caption: 'Browsing tools, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-rentals-s2',
      title: 'Open a tool and inquire',
      body: 'Choose a tool to open /tool-rentals/:toolId with its photos, rental terms, deposit, and availability. Sign in, then choose "Inquire About Rental" to start the conversation with the owner and arrange the rental.',
      expectedResult: 'Your inquiry reaches the tool owner.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/tool-rentals/:toolId',
          state: 'Tool detail with inquiry button, signed in, light mode',
          alt: 'Tool detail page with the inquiry action',
          caption: 'A tool listing, desktop view.',
          annotations: [
            { n: 1, label: 'Tool photos and terms', locator: 'main' },
            { n: 2, label: 'Inquire About Rental button', locator: 'button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/tool-rentals/:toolId',
          state: 'Tool detail, signed in, light mode',
          alt: 'Tool detail on a phone screen',
          caption: 'A tool listing, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-rentals-s3',
      title: 'List your own tool',
      body: 'To earn from a tool sitting in your garage, choose "List Your Tool". Tool listings are managed from the dashboard skills tab (/profile/tool-rentals redirects to /dashboard?tab=skills). Create the listing with photos, description, daily rate, and deposit, then publish it.',
      expectedResult: 'Your tool appears in the browse results for your area.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/tool-rentals',
          state: 'List Your Tool entry point, signed in, light mode',
          alt: 'List Your Tool call to action',
          caption: 'Listing a tool, desktop view.',
          annotations: [
            { n: 1, label: 'List Your Tool', locator: 'a' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/tool-rentals',
          state: 'List Your Tool entry point, signed in, light mode',
          alt: 'Listing entry on a phone screen',
          caption: 'Listing a tool, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-rentals-s4',
      title: 'Review owner analytics',
      body: 'Tool owners (tool_owner is a helper-class mode): open /tool-rentals/analytics for the owner analytics dashboard with rental activity, earnings, and favorites. Deposit handling (held, returned, withheld) is tracked per rental.',
      expectedResult: 'You can see rental activity and earnings for your tools.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/tool-rentals/analytics',
          state: 'Owner analytics dashboard, signed in, light mode',
          alt: 'Tool owner analytics dashboard',
          caption: 'Owner analytics, desktop view.',
          annotations: [
            { n: 1, label: 'Rental activity', locator: 'main' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/tool-rentals/analytics',
          state: 'Owner analytics, signed in, light mode',
          alt: 'Analytics on a phone screen',
          caption: 'Owner analytics, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'Your rental inquiry is with the owner, or your listed tool appears in browse results and analytics.',
  recovery: [
    {
      problem: 'No tools appear for your search.',
      solution: 'Clear filters and widen the category or city. Tool availability depends on owners near you.',
    },
    {
      problem: 'An owner does not respond to your inquiry.',
      solution: 'Inquire on another nearby listing, or adjust your requested dates.',
    },
  ],
  supportContact: 'Rental issues: contact support from the in-app support page at /support.',
  relatedGuides: ['other-messages'],
  siteLinks: [
    { label: 'Tool rentals', href: '/tool-rentals' },
    { label: 'Owner analytics', href: '/tool-rentals/analytics' },
  ],
  sources: [
    { type: 'route', ref: '/tool-rentals' },
    { type: 'route', ref: '/tool-rentals/:toolId' },
    { type: 'route', ref: '/tool-rentals/analytics' },
    { type: 'screen', ref: 'client/src/pages/ToolRentalsBrowse.jsx' },
    { type: 'screen', ref: 'client/src/pages/ToolOwnerDashboard.jsx' },
    { type: 'screen', ref: 'client/src/pages/ToolRentalsAnalytics.tsx' },
    { type: 'handler', ref: 'GET /api/tool-rentals/browse' },
    { type: 'flag', ref: 'toolRentals: true' },
  ],
};

export default guide;
