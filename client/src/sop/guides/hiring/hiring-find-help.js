/**
 * hiring-find-help.js - SOP guide: Find helpers and services.
 * Screen sources: client/src/pages/HelpersDirectoryPage.tsx, client/src/pages/HelperBusinessProfilePage.tsx
 */

const guide = {
  id: 'hiring-find-help',
  area: 'hiring',
  slug: 'find-helpers',
  title: 'Find helpers and services',
  audiences: ['customer'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Find a skilled local helper by searching the helper directory and reviewing their public profile.',
  intendedRoles: ['Customer'],
  prerequisites: [
    { text: 'Know the service you need and your ZIP code.', href: null },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open the helper directory', type: 'terminal' },
      { id: 'search', label: 'Search by skill and location', type: 'step' },
      { id: 'filter', label: 'Apply filters and sort by distance', type: 'step' },
      { id: 'review', label: 'Open a helper profile and review it', type: 'step' },
      { id: 'decide', label: 'Helper fits?', type: 'decision' },
      { id: 'next', label: 'Book, message, or post a job', type: 'terminal' },
      { id: 'again', label: 'Try another helper or widen filters', type: 'blocked' },
    ],
    edges: [
      { from: 'start', to: 'search' },
      { from: 'search', to: 'filter' },
      { from: 'filter', to: 'review' },
      { from: 'review', to: 'decide' },
      { from: 'decide', to: 'next', label: 'Yes' },
      { from: 'decide', to: 'again', label: 'No' },
      { from: 'again', to: 'review' },
    ],
  },
  processMapText:
    '1. Open the helper directory (/helpers). 2. Search with the hero search box ("Try \'lawn mowing\', \'electrician\', or \'deep clean\'..."). ' +
    '3. Open "Filters", add your ZIP code in the sidebar to sort by distance, and clear filters with "Clear" when needed. ' +
    '4. Open a helper\'s public profile at /helpers/:id and review services, reviews, and response stats. ' +
    '5. If the helper fits, use "Book Now" to request a time, "Message Helper" to ask questions, or post a job for everyone.',
  steps: [
    {
      id: 'hiring-find-help-s1',
      title: 'Open the helper directory and search',
      body: 'Open /helpers. The page heading is "Find a skilled local helper" with the subtitle "Browse background-checked, licensed, and insured helpers. Book in minutes - satisfaction guaranteed." Type the service into the hero search box (placeholder "Try \'lawn mowing\', \'electrician\', or \'deep clean\'..."). Browsing is free for guests; sign-in is required later to book.',
      expectedResult: 'Matching helpers appear below the search with a count like "{{count}} helpers found".',
      screenshots: [
        {
          id: 'hiring-find-help-s1-desktop',
          viewport: 'desktop',
          screen: '/helpers',
          state: 'Directory loaded with search results, guest, light mode',
          alt: 'Helper directory hero with search box and helper cards',
          caption: 'The helper directory search, desktop view.',
          annotations: [
            { n: 1, label: 'Hero search box', locator: 'input[type="search"]' },
            { n: 2, label: 'Filters panel', locator: 'aside' },
            { n: 3, label: 'Helper cards', locator: '.helper-card' },
          ],
        },
        {
          id: 'hiring-find-help-s1-mobile',
          viewport: 'mobile',
          screen: '/helpers',
          state: 'Directory loaded with search results, guest, light mode',
          alt: 'Helper directory on a phone screen',
          caption: 'The directory, mobile view.',
          annotations: [
            { n: 1, label: 'Hero search box', locator: 'input[type="search"]' },
            { n: 2, label: 'Helper cards', locator: '.helper-card' },
          ],
        },
      ],
    },
    {
      id: 'hiring-find-help-s2',
      title: 'Filter and sort the results',
      body: 'Choose "Filters" to narrow by skill ("Browse by skill") or job ("Filter by specific job:"). Add your ZIP code in the sidebar hint area ("Add your ZIP code in the sidebar to sort helpers by distance from you.") so the closest helpers come first. Use "Show results" to apply and "Clear" to reset.',
      expectedResult: 'The list refreshes with helpers matching your filters, sorted by distance.',
      screenshots: [
        {
          id: 'hiring-find-help-s2-desktop',
          viewport: 'desktop',
          screen: '/helpers',
          state: 'Filters open, guest, light mode',
          alt: 'Open filters panel with skill and distance options',
          caption: 'The filters panel with the ZIP code hint.',
          annotations: [
            { n: 1, label: 'Filters panel', locator: 'aside' },
            { n: 2, label: 'ZIP code hint', locator: 'aside' },
          ],
        },
        {
          id: 'hiring-find-help-s2-mobile',
          viewport: 'mobile',
          screen: '/helpers',
          state: 'Filters open, guest, light mode',
          alt: 'Filters on a phone screen',
          caption: 'The filters, mobile view.',
          annotations: [
            { n: 1, label: 'Filters panel', locator: 'aside' },
          ],
        },
      ],
    },
    {
      id: 'hiring-find-help-s3',
      title: 'Open a helper profile and review it',
      body: 'Choose a helper card to open the public profile at /helpers/:id. Review the services and pricing ("starting from"), the reviews and rating, trust signals (background checked, response rate, jobs completed), and the FAQs. The profile is public, so you can share the link with others.',
      expectedResult: 'The profile shows the helper\'s services, reviews, and availability signals.',
      screenshots: [
        {
          id: 'hiring-find-help-s3-desktop',
          viewport: 'desktop',
          screen: '/helpers/:id',
          state: 'Public helper profile loaded, guest, light mode',
          alt: 'Helper profile with services, reviews, and booking buttons',
          caption: 'A public helper profile, desktop view.',
          annotations: [
            { n: 1, label: 'Helper summary', locator: 'header' },
            { n: 2, label: 'Services and pricing', locator: 'section' },
            { n: 3, label: 'Reviews and trust signals', locator: 'section' },
          ],
        },
        {
          id: 'hiring-find-help-s3-mobile',
          viewport: 'mobile',
          screen: '/helpers/:id',
          state: 'Public helper profile loaded, guest, light mode',
          alt: 'Helper profile on a phone screen',
          caption: 'A helper profile, mobile view.',
          annotations: [
            { n: 1, label: 'Helper summary', locator: 'header' },
          ],
        },
      ],
    },
    {
      id: 'hiring-find-help-s4',
      title: 'Book, message, or save the helper',
      body: 'When the helper fits, choose "Book Now" in the hero to start a booking, or "Message Helper" to ask a question first. Use the save control to keep the helper for later. Booking and messaging require sign-in; you will be asked to sign in if you are a guest.',
      expectedResult: 'The booking flow starts, or a message thread opens with the helper.',
      screenshots: [
        {
          id: 'hiring-find-help-s4-desktop',
          viewport: 'desktop',
          screen: '/helpers/:id',
          state: 'Helper profile hero with CTAs, guest, light mode',
          alt: 'Profile hero with Book Now and Message Helper buttons',
          caption: 'The profile call-to-action buttons.',
          annotations: [
            { n: 1, label: 'Book Now button', locator: 'button' },
            { n: 2, label: 'Message Helper button', locator: 'button' },
          ],
        },
        {
          id: 'hiring-find-help-s4-mobile',
          viewport: 'mobile',
          screen: '/helpers/:id',
          state: 'Helper profile hero with CTAs, guest, light mode',
          alt: 'Profile CTAs on a phone screen',
          caption: 'The profile CTAs, mobile view.',
          annotations: [
            { n: 1, label: 'Sticky Book button', locator: '.sticky-bar button' },
          ],
        },
      ],
    },
  ],
  confirmOutcome: 'The profile you chose shows verified reviews and clear services. Starting a booking or a message thread confirms you picked the right helper.',
  recovery: [
    {
      problem: 'No helpers appear for your search.',
      solution: 'Widen the filters: remove the ZIP code, choose "Clear", or search a broader skill term. You can also browse the Direct catalog of OxSteed-operated services.',
    },
    {
      problem: 'You are asked to sign in when you choose Book Now.',
      solution: 'Sign in or create an account first; guests can browse but booking requires an account.',
    },
  ],
  supportContact: 'For help finding a service, contact support from the Help menu or visit /support.',
  relatedGuides: ['hiring-book', 'hiring-post-job', 'hiring-message', 'hiring-request-quote'],
  siteLinks: [
    { label: 'Find helpers', href: '/helpers' },
    { label: 'Discover', href: '/discover' },
    { label: 'Direct services', href: '/direct/services' },
  ],
  sources: [
    { type: 'route', ref: '/helpers' },
    { type: 'route', ref: '/helpers/:id' },
    { type: 'screen', ref: 'client/src/pages/HelpersDirectoryPage.tsx' },
    { type: 'screen', ref: 'client/src/pages/HelperBusinessProfilePage.tsx' },
    { type: 'handler', ref: 'GET /api/users/helpers/search' },
    { type: 'permission', ref: 'Guest can browse the directory; sign-in required to book.' },
  ],
};

export default guide;
