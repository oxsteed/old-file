/**
 * financial-statements - View statements.
 * Sources: client/src/pages/food/StatementCenterPage.jsx,
 * client/src/pages/food/CreditStatementsPage.jsx,
 * client/src/pages/food/StatementTransactionView.jsx,
 * client/src/pages/food/StatementAccessibleView.jsx
 * Routes: /statements, /restaurant-credit/statements,
 * /oxsteed-credit/statements, /statements/:documentId/entries/:entryId,
 * /statements/:documentId/accessible
 */

const guide = {
  id: 'financial-statements',
  area: 'financial',
  slug: 'financial-statements',
  title: 'View statements',
  audiences: ['customer', 'restaurant', 'helper', 'business'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Find and read the right statement: the statement center, product statements, transaction details, and accessible formats.',
  intendedRoles: ['Customer', 'Restaurant owner', 'Helper', 'Business owner'],
  prerequisites: [
    { text: 'Sign in to your OxSteed account.', href: '/login' },
  ],
  processMap: {
    nodes: [
      { id: 'open', label: 'Open the Statement center', type: 'terminal' },
      { id: 'choose', label: 'Choose an account', type: 'step' },
      { id: 'product', label: 'Open a product statement', type: 'step' },
      { id: 'period', label: 'Choose a period and apply', type: 'step' },
      { id: 'entry', label: 'Inspect a transaction entry', type: 'step' },
      { id: 'format', label: 'Use accessible formats', type: 'step' },
      { id: 'done', label: 'Statement reviewed', type: 'terminal' },
    ],
    edges: [
      { from: 'open', to: 'choose' },
      { from: 'choose', to: 'product' },
      { from: 'product', to: 'period' },
      { from: 'period', to: 'entry' },
      { from: 'entry', to: 'format' },
      { from: 'format', to: 'done' },
    ],
  },
  processMapText:
    'Open /statements ("Statement center": "Choose an account and a period, then review or download your records."). Note "Balances, currencies, and statement types stay separate." Choose an account ("Account and currency"), then open a product statement at /oxsteed-credit/statements or /restaurant-credit/statements ("Account statements": "Choose an account and statement period", then "Apply"). Inspect entries ("Entry details") and report issues. Use the accessible statement page for a tagged PDF, accessible HTML, or CSV.',
  steps: [
    {
      id: 'financial-statements-s1',
      title: 'Open the Statement center and choose an account',
      body: 'Open /statements. The "Statement center" shows "Choose an account" with your statement accounts. Use "Search all records" or "Period activity" to narrow, and "Change account" to switch. The note "Balances, currencies, and statement types stay separate." reminds you each account keeps its own records.',
      expectedResult: 'The accounts list loads with the selected account\'s periods.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/statements',
          state: 'Statement center with accounts, light mode',
          alt: 'Statement center with the account list',
          caption: 'The Statement center, desktop view.',
          annotations: [
            { n: 1, label: 'Page title', locator: 'main h1' },
            { n: 2, label: 'Choose an account', locator: 'main section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/statements',
          state: 'Statement center with accounts, light mode',
          alt: 'Statement center on a phone screen',
          caption: 'The Statement center, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'financial-statements-s2',
      title: 'Open a product statement and choose a period',
      body: 'Open /oxsteed-credit/statements ("OxSteed Credit" statements) or /restaurant-credit/statements ("Restaurant Credit" statements). "Choose an account and statement period" ("Select Apply to generate or retrieve your statement."), then choose "Apply". Dates use UTC; "Closed calendar months create immutable monthly documents on demand. Current or custom periods are interim reports."',
      expectedResult: 'The "Posted activity" list fills with the period\'s transactions and "Download PDF" / "Download CSV" appear.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/oxsteed-credit/statements',
          state: 'Account statements with period picker, light mode',
          alt: 'Statement page with account and period controls',
          caption: 'Choosing a statement period, desktop view.',
          annotations: [
            { n: 1, label: 'Account picker', locator: 'main select' },
            { n: 2, label: 'Period fields', locator: 'main input' },
            { n: 3, label: 'Apply button', locator: 'main button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/oxsteed-credit/statements',
          state: 'Account statements with period picker, light mode',
          alt: 'Statement page on a phone screen',
          caption: 'Choosing a statement period, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'financial-statements-s3',
      title: 'Filter and review posted activity',
      body: 'In "Posted activity", each row shows the date, type, "Credit"/"Debit", "Description", and "Balance after". Use "Advanced filters" to narrow by "Activity type", "Min amount"/"Max amount", "Direction" ("Debits and credits", "Debits only", "Credits only"), "Status", or related record ("Food orders", "Top-ups and funding", "Settlements and payouts", "Adjustments", "Refunds"), then "Apply filters".',
      expectedResult: 'The list shows "{{count}} of {{total}} transactions" matching your filters.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/oxsteed-credit/statements',
          state: 'Posted activity with advanced filters open, light mode',
          alt: 'Activity list with the advanced filters panel',
          caption: 'Filtering activity, desktop view.',
          annotations: [
            { n: 1, label: 'Advanced filters panel', locator: 'main section' },
            { n: 2, label: 'Posted activity list', locator: 'main div' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/oxsteed-credit/statements',
          state: 'Posted activity with advanced filters open, light mode',
          alt: 'Filters on a phone screen',
          caption: 'Filtering activity, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'financial-statements-s4',
      title: 'Inspect a transaction entry',
      body: 'Open an entry to reach /statements/:documentId/entries/:entryId ("Statement transaction": "Entry details"). Review "Posted (UTC)", "Type", "Amount", "Balance after", "Reference", and the related record ("View" opens the linked order or payment). If something looks wrong, use "Report an issue" with a "Reason" and "Details", then "Submit report" ("Tell us what looks wrong. Filing a report never moves money; it opens a case for review.").',
      expectedResult: 'The entry facts are clear and any issue is filed as a report.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/statements/:documentId/entries/:entryId',
          state: 'Statement transaction entry details, light mode',
          alt: 'Entry details with posted date, type, and amounts',
          caption: 'Inspecting an entry, desktop view.',
          annotations: [
            { n: 1, label: 'Entry details', locator: 'main section' },
            { n: 2, label: 'Report an issue button', locator: 'main button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/statements/:documentId/entries/:entryId',
          state: 'Statement transaction entry details, light mode',
          alt: 'Entry details on a phone screen',
          caption: 'Inspecting an entry, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'financial-statements-s5',
      title: 'Use accessible formats',
      body: 'Open /statements/:documentId/accessible ("Accessible statement": "Download a tagged PDF, an accessible HTML version, or a CSV of this statement."). Choose "Download accessible PDF" ("Tagged PDF": "A PDF with a tagged structure for screen readers."), "Open accessible HTML" ("Accessible HTML": "The same statement as a web page with a semantic table, headings, and right-to-left support for Arabic."), or "Download CSV" ("CSV data": "Every transaction row as plain data for spreadsheets and screen readers.").',
      expectedResult: 'The statement downloads in the format you chose.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/statements/:documentId/accessible',
          state: 'Accessible statement formats, light mode',
          alt: 'Accessible statement with PDF, HTML, and CSV options',
          caption: 'Accessible formats, desktop view.',
          annotations: [
            { n: 1, label: 'Tagged PDF card', locator: 'main section' },
            { n: 2, label: 'Accessible HTML card', locator: 'main section' },
            { n: 3, label: 'CSV data card', locator: 'main section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/statements/:documentId/accessible',
          state: 'Accessible statement formats, light mode',
          alt: 'Formats on a phone screen',
          caption: 'Accessible formats, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'You can open the right account, period, and entry, and download the statement in a usable format.',
  recovery: [
    {
      problem: 'The page shows "No statement accounts are available yet."',
      solution: 'Accounts appear here when available to you. If you expect one (for example after a top-up), use "Retry" and check the wallet first.',
    },
    {
      problem: 'The period shows "No posted activity in this period".',
      solution: 'Widen the From/To range or choose a different account; current or custom periods are interim reports and may legitimately be empty.',
    },
    {
      problem: 'A report cannot be opened from an entry.',
      solution: 'You see "A report cannot be opened from this statement entry. Contact Support for help." Use the in-app support page at /support instead.',
    },
  ],
  supportContact: 'For statement issues, use the in-app support page at /support.',
  relatedGuides: ['financial-archives', 'financial-downloads', 'financial-wallet', 'financial-oxsteed-credit', 'financial-restaurant-credit'],
  siteLinks: [
    { label: 'Statement center', href: '/statements' },
    { label: 'OxSteed Credit statements', href: '/oxsteed-credit/statements' },
    { label: 'Restaurant credit statements', href: '/restaurant-credit/statements' },
  ],
  sources: [
    { type: 'route', ref: '/statements' },
    { type: 'route', ref: '/restaurant-credit/statements' },
    { type: 'route', ref: '/oxsteed-credit/statements' },
    { type: 'route', ref: '/statements/:documentId/entries/:entryId' },
    { type: 'route', ref: '/statements/:documentId/accessible' },
    { type: 'screen', ref: 'client/src/pages/food/StatementCenterPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/food/CreditStatementsPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/food/StatementTransactionView.jsx' },
    { type: 'screen', ref: 'client/src/pages/food/StatementAccessibleView.jsx' },
  ],
};

export default guide;
