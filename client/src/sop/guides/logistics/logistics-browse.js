/**
 * logistics-browse - Browse logistics campaigns and lanes.
 * Sources: client/src/pages/logistics/LogisticsHomePage.jsx,
 * client/src/pages/logistics/CampaignsPage.jsx,
 * client/src/pages/logistics/CampaignDetailPage.jsx
 * Route: /logistics, /logistics/campaigns, /logistics/campaigns/:id
 */

const guide = {
  id: 'logistics-browse',
  area: 'logistics',
  slug: 'browse-logistics-campaigns',
  title: 'Browse logistics campaigns and lanes',
  audiences: ['logistics', 'customer'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Find an open pooled logistics campaign and review its pricing, lane, and timeline before joining.',
  intendedRoles: ['Customer', 'Logistics participant'],
  prerequisites: [
    { text: 'A free OxSteed account is enough to browse. Sign in to pledge or participate.', href: '/join' },
  ],
  processMap: {
    nodes: [
      { id: 'open-hub', label: 'Open the Logistics hub', type: 'terminal' },
      { id: 'browse', label: 'Browse open campaigns', type: 'step' },
      { id: 'filter', label: 'Search or filter by lane and status', type: 'step' },
      { id: 'open-campaign', label: 'Open a campaign card', type: 'step' },
      { id: 'review', label: 'Review unit economics, MOQ, and timeline', type: 'step' },
      { id: 'decide', label: 'Ready to join?', type: 'decision' },
      { id: 'done', label: 'Continue to pledging', type: 'terminal' },
    ],
    edges: [
      { from: 'open-hub', to: 'browse' },
      { from: 'browse', to: 'filter' },
      { from: 'filter', to: 'open-campaign' },
      { from: 'open-campaign', to: 'review' },
      { from: 'review', to: 'decide' },
      { from: 'decide', to: 'done', label: 'Yes' },
      { from: 'decide', to: 'filter', label: 'Not yet' },
    ],
  },
  processMapText:
    '1. Open the Logistics hub. 2. Browse the open campaigns list. 3. Use search and the lane and status filters to narrow the list. ' +
    '4. Open a campaign card to see its detail page. 5. Review the unit economics, MOQ progress, and timeline. ' +
    '6. If the campaign fits your needs, continue to pledging; otherwise refine your filters and keep browsing.',
  steps: [
    {
      id: 'logistics-browse-s1',
      title: 'Open the Logistics hub',
      body: 'Choose Logistics in the main navigation, or open /logistics directly. The page is titled "OxSteed Logistics" with the subtitle "End-to-end import, sourcing, pooled procurement, and distribution." Guests see the hero section "Global supply chains were built for corporations." plus the "How pooled buying works" section and role cards for buyer, organizer, and business.',
      expectedResult: 'The Logistics hub loads with open campaigns listed under "Open Campaigns".',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics',
          state: 'Logistics browsing hub, guest, light mode',
          alt: 'OxSteed Logistics hub with the open campaigns list',
          caption: 'The Logistics hub with open campaigns, desktop view.',
          annotations: [
            { n: 1, label: 'Page title', locator: 'h1.lx-hub-title' },
            { n: 2, label: 'Open campaigns list', locator: 'main section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics',
          state: 'Logistics browsing hub, guest, light mode',
          alt: 'OxSteed Logistics hub on a phone screen',
          caption: 'The Logistics hub, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-browse-s2',
      title: 'Search and filter campaigns',
      body: 'Use the "Search campaigns" field (placeholder "Search by product, lane, or title") to find a product. Use the "Status" and "Lane" dropdowns to narrow by lifecycle and trade lane. The results count shows "{{count}} campaigns". If nothing matches, you see "No campaigns match your filters" with a "Clear filters" button to reset.',
      expectedResult: 'The campaign list updates to match your search and filters.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/campaigns',
          state: 'Campaign list with search and filters applied, light mode',
          alt: 'Campaign search box and lane and status filters with results',
          caption: 'Searching and filtering campaigns, desktop view.',
          annotations: [
            { n: 1, label: 'Search campaigns field', locator: 'input[aria-label="Search campaigns"]' },
            { n: 2, label: 'Lane and Status filters', locator: 'main select' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/campaigns',
          state: 'Campaign list with search applied, light mode',
          alt: 'Campaign search on a phone screen',
          caption: 'Searching campaigns, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-browse-s3',
      title: 'Open a campaign and review the details',
      body: 'Choose "View Details" on a campaign card. The detail page shows the "Unit Economics" panel (Product Cost, Freight (est.), OxSteed Markup, Fees, Landed Cost / unit, Deposit (30%)), the "Timeline" panel (Open Date, Close Date, Lock Date, Expected Ship, Expected Arrival), and "MOQ progress" ("{{committed}} / {{target}} units committed"). Check the participants list and the delivery preference options (Warehouse Pickup, Ship to Me, Freight Forward).',
      expectedResult: 'You can see the full landed cost, timeline, and MOQ progress for the campaign.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/campaigns/:id',
          state: 'Campaign detail page, guest, light mode',
          alt: 'Campaign detail with unit economics, timeline, and MOQ progress',
          caption: 'A campaign detail page, desktop view.',
          annotations: [
            { n: 1, label: 'Unit Economics panel', locator: 'main section' },
            { n: 2, label: 'Timeline panel', locator: 'main aside' },
            { n: 3, label: 'MOQ progress', locator: 'main' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/campaigns/:id',
          state: 'Campaign detail page, guest, light mode',
          alt: 'Campaign detail on a phone screen',
          caption: 'A campaign detail page, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-browse-s4',
      title: 'Pick your path from the role cards',
      body: 'Back on the hub, the "Which one are you?" role cards offer three paths: "Join a group shipment" with the "Browse campaigns" button for buyers, "Run a group buy" with the "Start a campaign" button for organizers, and "Restock without the broker" with the "Explore procurement" button for businesses. Choose the card that matches what you want to do next.',
      expectedResult: 'You land on the buyer, organizer, or procurement entry point for your role.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics',
          state: 'Logistics hub role cards, light mode',
          alt: 'Role cards for buyer, organizer, and business paths',
          caption: 'Role cards on the Logistics hub, desktop view.',
          annotations: [
            { n: 1, label: 'Join a group shipment card', locator: 'main section' },
            { n: 2, label: 'Run a group buy card', locator: 'main section' },
            { n: 3, label: 'Restock without the broker card', locator: 'main section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics',
          state: 'Logistics hub role cards, light mode',
          alt: 'Role cards stacked on a phone screen',
          caption: 'Role cards, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'You opened a campaign detail page and can read its unit economics, MOQ progress, and timeline.',
  recovery: [
    {
      problem: 'You see "No campaigns match your filters".',
      solution: 'Choose "Clear filters" and broaden the lane or status selection, or try a simpler search term.',
    },
    {
      problem: 'The hub shows "No campaigns yet".',
      solution: 'No campaigns are open right now. Check back later, or organize one yourself with "Organize a campaign".',
    },
  ],
  supportContact: 'Questions about a campaign or lane: contact support from the in-app support page at /support.',
  relatedGuides: ['logistics-pledge', 'logistics-organize-campaign'],
  siteLinks: [
    { label: 'Logistics', href: '/logistics' },
    { label: 'Campaigns', href: '/logistics/campaigns' },
  ],
  sources: [
    { type: 'route', ref: '/logistics' },
    { type: 'route', ref: '/logistics/campaigns' },
    { type: 'screen', ref: 'client/src/pages/logistics/LogisticsHomePage.jsx' },
    { type: 'screen', ref: 'client/src/pages/logistics/CampaignsPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/logistics/CampaignDetailPage.jsx' },
  ],
};

export default guide;
