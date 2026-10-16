/**
 * helper-work-clients.js - Guide: manage client relationships.
 *
 * Verified against: client/src/pages/ClientManagementPage.jsx
 * (/helper/clients: stats, search, All/Unread/Quotes filters),
 * route /helper/clients in App.jsx.
 */

export default {
  id: 'helper-work-clients',
  area: 'helper-work',
  slug: 'manage-client-relationships',
  title: 'Manage client relationships',
  audiences: ['helper'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Keep track of every client, unread message, and sent quote in one workspace.',
  intendedRoles: ['Helper'],
  prerequisites: [
    { text: 'Sign in and switch to helper mode.', href: '/login' },
    { text: 'Have at least one conversation or quote started (clients appear from conversations and quote history).', href: '/messages' },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open the Client management page', type: 'terminal' },
      { id: 'review', label: 'Review stats and the client list', type: 'step' },
      { id: 'find', label: 'Search or filter for a client', type: 'step' },
      { id: 'open', label: 'Open the conversation', type: 'step' },
      { id: 'quotes', label: 'Review sent quotes for context', type: 'step' },
      { id: 'done', label: 'Relationship tracked', type: 'terminal' },
    ],
    edges: [
      { from: 'start', to: 'review' },
      { from: 'review', to: 'find' },
      { from: 'find', to: 'open' },
      { from: 'open', to: 'quotes' },
      { from: 'quotes', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the Client management page. 2. Review your stats and the client list. ' +
    '3. Search or filter to find a client. 4. Open the conversation to reply or follow up. ' +
    '5. Review the quotes you sent that client for context. 6. The relationship is tracked and up to date.',
  steps: [
    {
      id: 'helper-work-clients-s1',
      title: 'Open the Client management page',
      body: 'Open /helper/clients. The Client workspace page shows who you are working with, what needs your attention, and where each relationship stands. Stats at the top show Clients, Unread messages, and Sent quotes.',
      expectedResult: 'Your clients list loads with the stats accurate.',
      screenshots: [
        {
          id: 'helper-work-clients-s1-desktop',
          viewport: 'desktop',
          screen: '/helper/clients',
          state: 'Client management page with synthetic clients, light mode',
          alt: 'Client management page with stats cards and the client list',
          caption: 'The Client management page, desktop view.',
          annotations: [
            { n: 1, label: 'Clients stat', locator: '.client-management__stats' },
            { n: 2, label: 'Unread messages stat', locator: '.client-management__stats' },
            { n: 3, label: 'Sent quotes stat', locator: '.client-management__stats' },
          ],
        },
        {
          id: 'helper-work-clients-s1-mobile',
          viewport: 'mobile',
          screen: '/helper/clients',
          state: 'Client management page with synthetic clients, light mode',
          alt: 'Client management page on a phone screen',
          caption: 'The Client management page, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'helper-work-clients-s2',
      title: 'Search or filter for a client',
      body: 'Use the search box ("Search clients, messages, or jobs") to find someone, or use the filters: All, Unread, or Quotes (clients you have sent quotes to).',
      expectedResult: 'The list narrows to the matching clients.',
      screenshots: [
        {
          id: 'helper-work-clients-s2-desktop',
          viewport: 'desktop',
          screen: '/helper/clients',
          state: 'Client management page with Unread filter active, light mode',
          alt: 'Search box and All, Unread, and Quotes filters above the client list',
          caption: 'Searching and filtering clients, desktop view.',
          annotations: [
            { n: 1, label: 'Search box', locator: 'input[placeholder]' },
            { n: 2, label: 'All / Unread / Quotes filters', locator: '.client-management__filters' },
          ],
        },
        {
          id: 'helper-work-clients-s2-mobile',
          viewport: 'mobile',
          screen: '/helper/clients',
          state: 'Client management page with Unread filter active, light mode',
          alt: 'Filters on a phone screen',
          caption: 'Searching and filtering clients, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'helper-work-clients-s3',
      title: 'Open the conversation and follow up',
      body: 'On a client card, choose Open conversation to jump into the thread and reply, or Open messages to see all your threads. The card shows the last message and how many quotes you have sent that client.',
      expectedResult: 'The conversation opens with full history, ready for your reply.',
      screenshots: [
        {
          id: 'helper-work-clients-s3-desktop',
          viewport: 'desktop',
          screen: '/helper/clients',
          state: 'Client card with Open conversation control, light mode',
          alt: 'Client card showing last message, quote count, and Open conversation button',
          caption: 'A client card, desktop view.',
          annotations: [
            { n: 1, label: 'Last message and quote count', locator: '.client-card' },
            { n: 2, label: 'Open conversation', locator: 'button' },
          ],
        },
        {
          id: 'helper-work-clients-s3-mobile',
          viewport: 'mobile',
          screen: '/helper/clients',
          state: 'Client card with Open conversation control, light mode',
          alt: 'Client card on a phone screen',
          caption: 'A client card, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'Each client card shows the latest message and quote activity, and conversations open from the cards.',
  recovery: [
    {
      problem: 'A client is missing from the list.',
      solution: 'Clients appear from conversations and quote history. If you have never messaged or quoted them, start a conversation from /messages first.',
    },
    {
      problem: 'Unread counts look wrong.',
      solution: 'Open the conversation; reading the messages clears the unread count. Reload the page if the stat lags.',
    },
  ],
  supportContact: 'If the client list fails to load, contact OxSteed Support from the /support page.',
  relatedGuides: ['helper-work-quotes', 'helper-work-invoices'],
  siteLinks: [
    { label: 'Client management', href: '/helper/clients' },
    { label: 'Messages', href: '/messages' },
  ],
  sources: [
    { type: 'route', ref: '/helper/clients' },
    { type: 'screen', ref: 'client/src/pages/ClientManagementPage.jsx' },
    { type: 'handler', ref: 'GET /api/messages/conversations' },
    { type: 'handler', ref: 'GET /api/chat/quotes/history' },
  ],
};
