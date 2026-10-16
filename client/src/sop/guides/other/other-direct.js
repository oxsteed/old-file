/**
 * other-direct - Use Direct (OxSteed-operated services).
 * Sources: client/src/pages/DirectCatalogLanding.jsx,
 * client/src/pages/DirectCatalogDirectoryPage.jsx,
 * client/src/pages/DirectPortalPage.jsx (quote request, book, history views)
 * Routes: /direct, /direct/services, /direct/request-quote, /direct/book-slot, /direct/history
 */

const guide = {
  id: 'other-direct',
  area: 'direct',
  slug: 'use-direct-services',
  title: 'Use Direct (OxSteed-operated services)',
  audiences: ['customer'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Browse OxSteed-operated Direct services, request a quote or book a slot, and review your history.',
  intendedRoles: ['Customer'],
  prerequisites: [
    { text: 'No account needed to browse the catalog. Sign in to book, request quotes, or view history.', href: '/login' },
  ],
  processMap: {
    nodes: [
      { id: 'open', label: 'Open Direct', type: 'terminal' },
      { id: 'browse', label: 'Browse the Direct services catalog', type: 'step' },
      { id: 'service', label: 'Open a service', type: 'step' },
      { id: 'path', label: 'Instant book or quote required?', type: 'decision' },
      { id: 'book', label: 'Book a slot', type: 'step' },
      { id: 'quote', label: 'Request a Direct quote', type: 'step' },
      { id: 'history', label: 'Review quote requests, jobs, and receipts', type: 'step' },
      { id: 'done', label: 'Direct service arranged', type: 'terminal' },
    ],
    edges: [
      { from: 'open', to: 'browse' },
      { from: 'browse', to: 'service' },
      { from: 'service', to: 'path' },
      { from: 'path', to: 'book', label: 'Instant book' },
      { from: 'path', to: 'quote', label: 'Quote required' },
      { from: 'book', to: 'history' },
      { from: 'quote', to: 'history' },
      { from: 'history', to: 'done' },
    ],
  },
  processMapText:
    '1. Open Direct at /direct. 2. Browse the "Direct services" catalog using the category search. 3. Open a service to see availability and pricing. ' +
    '4. If the service supports instant booking, choose "Book" and pick a slot; if it shows "Quote required", choose "Request" and submit "Request a Direct quote". ' +
    '5. Review everything in "Service history" at /direct/history: "All of your Direct quote requests, jobs, and receipts in one place."',
  steps: [
    {
      id: 'other-direct-s1',
      title: 'Open Direct and browse the catalog',
      body: 'Open /direct. The landing shows "Direct service, organized for real work." and "Browse available Direct services, tools, and coverage from one place." Open /direct/services for the full catalog with the "Services" and "Skills" tabs. Use the search field ("Search {{category}} services...") to find what you need.',
      expectedResult: 'The catalog lists available Direct services with Book or Request actions.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/direct',
          state: 'Direct landing, guest, light mode',
          alt: 'Direct landing with the services catalog',
          caption: 'Direct services, desktop view.',
          annotations: [
            { n: 1, label: 'Hero heading', locator: 'h1' },
            { n: 2, label: 'Service list', locator: 'main' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/direct',
          state: 'Direct landing, guest, light mode',
          alt: 'Direct landing on a phone screen',
          caption: 'Direct services, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-direct-s2',
      title: 'Open a service and choose Book or Request',
      body: 'Open a service to see its detail: availability, the "next slot", and pricing. Services with instant booking show a "Book" button; services that need scoping show "Quote required" with a "Request" button instead. Sign in if you have not already; booking and quoting require an account.',
      expectedResult: 'You see the service detail with its booking or quote action.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/direct/services',
          state: 'Service detail with Book button, light mode',
          alt: 'Direct service detail with the Book action',
          caption: 'A Direct service, desktop view.',
          annotations: [
            { n: 1, label: 'Service details', locator: 'main' },
            { n: 2, label: 'Book button', locator: 'button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/direct/services',
          state: 'Service detail, light mode',
          alt: 'Service detail on a phone screen',
          caption: 'A Direct service, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-direct-s3',
      title: 'Book a slot or request a quote',
      body: 'For instant booking, pick a slot at /direct/book-slot and confirm. For quoted services, open /direct/request-quote: the page is titled "Request a Direct quote" with the subtitle "Keep it simple. Tell us what you need, where the work is, and when you want it done." The "What to include" checklist guides you, and you can attach photos. Submit, then look up the quote later at /direct/view-quote with the code you receive.',
      expectedResult: 'Your booking is confirmed, or your quote request is submitted with a lookup code.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/direct/request-quote',
          state: 'Request a Direct quote form, signed in, light mode',
          alt: 'Quote request form with the what to include checklist',
          caption: 'Requesting a Direct quote, desktop view.',
          annotations: [
            { n: 1, label: 'Request a Direct quote title', locator: 'h1' },
            { n: 2, label: 'What to include checklist', locator: 'section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/direct/request-quote',
          state: 'Quote request form, signed in, light mode',
          alt: 'Quote request on a phone screen',
          caption: 'Requesting a quote, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-direct-s4',
      title: 'Review your Direct history',
      body: 'Open /direct/history. The page is titled "Service history" with the subtitle "All of your Direct quote requests, jobs, and receipts in one place." If empty it shows "No Direct history yet". From here you can open a quote, a job, or a payment receipt.',
      expectedResult: 'Your quote requests, jobs, and receipts are listed together.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/direct/history',
          state: 'Service history with entries, signed in, light mode',
          alt: 'Direct service history list',
          caption: 'Service history, desktop view.',
          annotations: [
            { n: 1, label: 'Service history title', locator: 'h1' },
            { n: 2, label: 'History entries', locator: 'main' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/direct/history',
          state: 'Service history, signed in, light mode',
          alt: 'Service history on a phone screen',
          caption: 'Service history, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'Your booking or quote request appears in "Service history" at /direct/history.',
  recovery: [
    {
      problem: 'A service shows "Currently unavailable" or "Coming soon".',
      solution: 'The service is not bookable in your area right now. Request a quote instead, or check back later.',
    },
    {
      problem: 'You lost your quote lookup code.',
      solution: 'Sign in and open /direct/history: signed-in quote requests are listed there without a code.',
    },
  ],
  supportContact: 'Direct questions: contact support from the in-app support page at /support, or use Direct support at /direct/support.',
  relatedGuides: ['other-delivery'],
  siteLinks: [
    { label: 'Direct', href: '/direct' },
    { label: 'Services', href: '/direct/services' },
    { label: 'Request a quote', href: '/direct/request-quote' },
    { label: 'Service history', href: '/direct/history' },
  ],
  sources: [
    { type: 'route', ref: '/direct' },
    { type: 'route', ref: '/direct/services' },
    { type: 'route', ref: '/direct/request-quote' },
    { type: 'route', ref: '/direct/history' },
    { type: 'screen', ref: 'client/src/pages/DirectCatalogLanding.jsx' },
    { type: 'screen', ref: 'client/src/pages/DirectPortalPage.jsx' },
    { type: 'handler', ref: 'POST /api/direct/catalog/services/:id/book' },
    { type: 'handler', ref: 'POST /api/quote-requests' },
  ],
};

export default guide;
