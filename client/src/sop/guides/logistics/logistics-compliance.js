/**
 * logistics-compliance - Check trade compliance and restrictions.
 * Sources: client/src/pages/logistics/CompliancePage.jsx
 * Route: /logistics/compliance
 */

const guide = {
  id: 'logistics-compliance',
  area: 'logistics',
  slug: 'check-trade-compliance',
  title: 'Check trade compliance and restrictions',
  audiences: ['logistics'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Check lane risk tiers, trade rules, and document requirements before committing to a lane.',
  intendedRoles: ['Logistics participant (buyer)', 'Logistics participant (organizer)'],
  prerequisites: [
    { text: 'A signed-in OxSteed account.', href: '/login' },
    { text: 'The lane and destination country you plan to use.', href: '/logistics/campaigns' },
  ],
  processMap: {
    nodes: [
      { id: 'open', label: 'Open the Compliance page', type: 'terminal' },
      { id: 'risk', label: 'Review the Lane Risk Overview', type: 'step' },
      { id: 'filter', label: 'Filter by lane or country', type: 'step' },
      { id: 'rules', label: 'Read Trade Rules and Document Requirements', type: 'step' },
      { id: 'gating', label: 'Business verification or manual approval needed?', type: 'decision' },
      { id: 'done', label: 'Lane is clear to use', type: 'terminal' },
    ],
    edges: [
      { from: 'open', to: 'risk' },
      { from: 'risk', to: 'filter' },
      { from: 'filter', to: 'rules' },
      { from: 'rules', to: 'gating' },
      { from: 'gating', to: 'done', label: 'No' },
      { from: 'gating', to: 'risk', label: 'Yes: complete the requirement first' },
    ],
  },
  processMapText:
    '1. Open the Compliance page. 2. Review the "Lane Risk Overview": risk tier, markup, customs complexity, and flags per lane. ' +
    '3. Filter by lane or country code to focus on your route. 4. Read the "Trade Rules" table and the "Document Requirements" section. ' +
    '5. Check whether the lane needs "Business Verification" or "Manual Approval". If it does, complete that requirement before committing; otherwise the lane is clear to use.',
  steps: [
    {
      id: 'logistics-compliance-s1',
      title: 'Open the Compliance page',
      body: 'Choose Compliance in the logistics navigation, or open /logistics/compliance directly. The page is titled "Compliance & Restrictions" with the subtitle "Lane risk tiers and trade rules governing your logistics lanes."',
      expectedResult: 'The compliance page loads with the lane risk and trade rules sections.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/compliance',
          state: 'Compliance page, signed in, light mode',
          alt: 'Compliance and Restrictions page',
          caption: 'The Compliance page, desktop view.',
          annotations: [
            { n: 1, label: 'Compliance & Restrictions title', locator: 'h1' },
            { n: 2, label: 'Lane Risk Overview', locator: 'section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/compliance',
          state: 'Compliance page, signed in, light mode',
          alt: 'Compliance page on a phone screen',
          caption: 'The Compliance page, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-compliance-s2',
      title: 'Review the Lane Risk Overview',
      body: 'Read the "Lane Risk Overview" table: columns Lane, Route, Risk Tier, Markup, Customs, and Flags. Risk tiers are Low, Managed, Restricted, or Prohibited. A Prohibited lane cannot be used; Restricted and Managed lanes may need extra steps.',
      expectedResult: 'You know the risk tier and customs complexity of your lane.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/compliance',
          state: 'Lane Risk Overview table, light mode',
          alt: 'Lane risk table with tiers and customs complexity',
          caption: 'The Lane Risk Overview, desktop view.',
          annotations: [
            { n: 1, label: 'Risk Tier column', locator: 'table' },
            { n: 2, label: 'Customs complexity column', locator: 'table' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/compliance',
          state: 'Lane Risk Overview, light mode',
          alt: 'Lane risk on a phone screen',
          caption: 'The Lane Risk Overview, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-compliance-s3',
      title: 'Filter by lane or country',
      body: 'Use "Filter by lane" (with the "All Lanes" option) and "Filter by country code" (placeholder "Country code (e.g. HT)") to narrow the view to your route. This focuses both the risk overview and the trade rules.',
      expectedResult: 'Only rules for your lane and country remain visible.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/compliance',
          state: 'Compliance filters applied, light mode',
          alt: 'Lane and country filters on the compliance page',
          caption: 'Filtering compliance data, desktop view.',
          annotations: [
            { n: 1, label: 'Filter by lane', locator: 'select' },
            { n: 2, label: 'Filter by country code', locator: 'input' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/compliance',
          state: 'Compliance filters, light mode',
          alt: 'Filters on a phone screen',
          caption: 'Filtering, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-compliance-s4',
      title: 'Read trade rules and document requirements',
      body: 'Read the "Trade Rules" table: columns Lane, Type, Country, Category, Severity, Doc Required, and Notes. Check the "Document Requirements" and "Risk Tiers" sections for what paperwork your goods need. Look for the flags "Business Verification" ("Business verification required") and "Manual Approval" ("Manual approval required"): when present, complete verification or wait for manual approval before pledging or organizing on that lane.',
      expectedResult: 'You know which documents and approvals your lane requires.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/compliance',
          state: 'Trade Rules and Document Requirements sections, light mode',
          alt: 'Trade rules table and document requirements',
          caption: 'Trade rules and documents, desktop view.',
          annotations: [
            { n: 1, label: 'Trade Rules table', locator: 'table' },
            { n: 2, label: 'Document Requirements section', locator: 'section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/compliance',
          state: 'Trade Rules section, light mode',
          alt: 'Trade rules on a phone screen',
          caption: 'Trade rules, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'You can state the risk tier, required documents, and any verification or approval your lane needs.',
  recovery: [
    {
      problem: 'The page shows "No lane risk data published yet."',
      solution: 'Risk data has not been published for that lane. Contact support at /support before committing units.',
    },
    {
      problem: 'Your lane is Restricted or requires manual approval.',
      solution: 'Complete business verification or submit for manual approval first. Campaigns and pledges on gated lanes are blocked until it clears.',
    },
  ],
  supportContact: 'Compliance questions: contact support from the in-app support page at /support.',
  relatedGuides: ['logistics-browse', 'logistics-organize-campaign'],
  siteLinks: [
    { label: 'Compliance', href: '/logistics/compliance' },
    { label: 'Campaigns', href: '/logistics/campaigns' },
  ],
  sources: [
    { type: 'route', ref: '/logistics/compliance' },
    { type: 'screen', ref: 'client/src/pages/logistics/CompliancePage.jsx' },
    { type: 'handler', ref: 'GET /api/logistics/compliance/restrictions' },
    { type: 'handler', ref: 'GET /api/logistics/trade-rules' },
  ],
};

export default guide;
