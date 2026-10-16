/**
 * helper-work-find-work.js - Guide: browse open jobs.
 *
 * Verified against: client/src/pages/JobListPage.jsx (search, categories,
 * filters), client/src/pages/SavedSearchesPage.jsx, route /jobs in App.jsx.
 */

export default {
  id: 'helper-work-find-work',
  area: 'helper-work',
  slug: 'browse-open-jobs',
  title: 'Browse open jobs',
  audiences: ['helper'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Find open jobs that match your skills, location, and schedule.',
  intendedRoles: ['Helper'],
  prerequisites: [
    { text: 'You can browse without signing in, but you need a signed-in helper account with completed onboarding to bid.', href: '/join?mode=helper' },
    { text: 'Keep your skills and availability up to date so matches are accurate.', guideId: 'helper-work-skills', href: '/dashboard?tab=skills' },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open the jobs page', type: 'terminal' },
      { id: 'search', label: 'Search or browse by category', type: 'step' },
      { id: 'filter', label: 'Apply filters', type: 'step' },
      { id: 'match', label: 'Good match found?', type: 'decision' },
      { id: 'refine', label: 'Refine the search', type: 'blocked' },
      { id: 'open', label: 'Open the job detail', type: 'step' },
      { id: 'save', label: 'Save the search for alerts (optional)', type: 'step' },
      { id: 'done', label: 'Job ready to bid on', type: 'terminal' },
    ],
    edges: [
      { from: 'start', to: 'search' },
      { from: 'search', to: 'filter' },
      { from: 'filter', to: 'match' },
      { from: 'match', to: 'open', label: 'Yes' },
      { from: 'match', to: 'refine', label: 'No' },
      { from: 'refine', to: 'search' },
      { from: 'open', to: 'save' },
      { from: 'save', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the jobs page. 2. Search by keyword or browse by category. 3. Apply filters such as job type and location. ' +
    '4. If you find a good match, open the job detail. If not, refine the search and try again. ' +
    '5. Optionally save the search to get alerts when matching jobs post. 6. The job is ready for you to bid on.',
  steps: [
    {
      id: 'helper-work-find-work-s1',
      title: 'Open the jobs page',
      body: 'Open /jobs (Find work). The hero panel titled "Find work that fits your skills" shows a search box, category browse links, and a Filters button.',
      expectedResult: 'The job list loads with open jobs shown as cards.',
      screenshots: [
        {
          id: 'helper-work-find-work-s1-desktop',
          viewport: 'desktop',
          screen: '/jobs',
          state: 'Jobs page with synthetic listings, light mode',
          alt: 'Jobs page hero with search box and category links above job cards',
          caption: 'The jobs page, desktop view.',
          annotations: [
            { n: 1, label: 'Search box', locator: 'input[placeholder]' },
            { n: 2, label: 'Browse by category', locator: '.browse-categories' },
          ],
        },
        {
          id: 'helper-work-find-work-s1-mobile',
          viewport: 'mobile',
          screen: '/jobs',
          state: 'Jobs page with synthetic listings, light mode',
          alt: 'Jobs page hero on a phone screen',
          caption: 'The jobs page, mobile view.',
          annotations: [
            { n: 1, label: 'Search box', locator: 'input[placeholder]' },
          ],
        },
      ],
    },
    {
      id: 'helper-work-find-work-s2',
      title: 'Search and filter',
      body: 'Type a keyword in the search box (for example lawn mowing or electrician), or browse by category. Choose Filters to narrow by job type and location, then choose Show results to apply.',
      expectedResult: 'The list refreshes to show only jobs matching your search and filters.',
      screenshots: [
        {
          id: 'helper-work-find-work-s2-desktop',
          viewport: 'desktop',
          screen: '/jobs',
          state: 'Jobs page with filters open and synthetic listings, light mode',
          alt: 'Filters panel open on the jobs page with job type and location options',
          caption: 'Filtering jobs, desktop view.',
          annotations: [
            { n: 1, label: 'Filters panel', locator: '[role="dialog"]' },
            { n: 2, label: 'Show results button', locator: 'button' },
          ],
        },
        {
          id: 'helper-work-find-work-s2-mobile',
          viewport: 'mobile',
          screen: '/jobs',
          state: 'Jobs page with filters open, light mode',
          alt: 'Filters panel on a phone screen',
          caption: 'Filtering jobs, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'helper-work-find-work-s3',
      title: 'Open a job that fits',
      body: 'Read the job cards for budget, location, and schedule. Choose a card to open the full job detail: description, photos, bids so far, and the Submit Your Bid form.',
      expectedResult: 'The job detail page loads with the full description and bid form.',
      screenshots: [
        {
          id: 'helper-work-find-work-s3-desktop',
          viewport: 'desktop',
          screen: '/jobs/:id',
          state: 'Job detail with synthetic data, light mode',
          alt: 'Job detail page with description, photos, and the bid form',
          caption: 'A job detail page, desktop view.',
          annotations: [
            { n: 1, label: 'Job description', locator: '.job-description' },
            { n: 2, label: 'Submit Your Bid form', locator: '.jdp-bid-form' },
          ],
        },
        {
          id: 'helper-work-find-work-s3-mobile',
          viewport: 'mobile',
          screen: '/jobs/:id',
          state: 'Job detail with synthetic data, light mode',
          alt: 'Job detail page on a phone screen',
          caption: 'A job detail page, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'helper-work-find-work-s4',
      title: 'Save the search for alerts',
      body: 'If you run a search you repeat often, save it at /saved-searches. The Saved searches page explains you get alerted when new jobs, helpers, or tools match what you are looking for. You must be signed in to save searches.',
      expectedResult: 'Your saved search appears on the Saved searches page and alerts are active.',
      screenshots: [
        {
          id: 'helper-work-find-work-s4-desktop',
          viewport: 'desktop',
          screen: '/saved-searches',
          state: 'Saved searches page with one synthetic search, light mode',
          alt: 'Saved searches page with a saved job search listed',
          caption: 'The Saved searches page, desktop view.',
          annotations: [
            { n: 1, label: 'Saved search', locator: '.saved-search-card' },
          ],
        },
        {
          id: 'helper-work-find-work-s4-mobile',
          viewport: 'mobile',
          screen: '/saved-searches',
          state: 'Saved searches page with one synthetic search, light mode',
          alt: 'Saved searches page on a phone screen',
          caption: 'The Saved searches page, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'You can open a job detail and see the Submit Your Bid form; saved searches list your search.',
  recovery: [
    {
      problem: 'No jobs match your search.',
      solution: 'Broaden the keyword, clear a filter, or browse by category. New jobs post regularly, so check back or save the search for alerts.',
    },
    {
      problem: 'The bid form asks you to sign in or finish onboarding.',
      solution: 'Sign in to your helper account and complete the onboarding steps. Bidding is gated server-side until onboarding is complete.',
    },
  ],
  supportContact: 'If job listings fail to load, contact OxSteed Support from the /support page.',
  relatedGuides: ['helper-work-bid', 'helper-work-skills'],
  siteLinks: [
    { label: 'Find work', href: '/jobs' },
    { label: 'Saved searches', href: '/saved-searches' },
    { label: 'My Bids', href: '/my-bids' },
  ],
  sources: [
    { type: 'route', ref: '/jobs' },
    { type: 'route', ref: '/saved-searches' },
    { type: 'screen', ref: 'client/src/pages/JobListPage.jsx' },
    { type: 'handler', ref: 'GET /api/jobs' },
  ],
};
