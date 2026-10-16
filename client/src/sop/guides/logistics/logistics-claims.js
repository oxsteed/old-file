/**
 * logistics-claims - File and track claims.
 *
 * There is NO standalone claims page. Claims are filed through support
 * (the claim types are shortages, damage, delays, wrong items, customs
 * rejections, or fraud) and are listed in the Buyer Dashboard section
 * "Claims and resolution posture".
 *
 * Sources: client/src/pages/logistics/BuyerDashboardPage.jsx,
 * client/src/api/logistics.js (listMyClaims)
 * Routes: /logistics/buyer, /support
 */

const guide = {
  id: 'logistics-claims',
  area: 'logistics',
  slug: 'file-and-track-claims',
  title: 'File and track claims',
  audiences: ['logistics'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Report a logistics problem as a claim and track its resolution from the Buyer Dashboard.',
  intendedRoles: ['Logistics participant (buyer)'],
  prerequisites: [
    { text: 'A signed-in OxSteed account.', href: '/login' },
    { text: 'A shipment, order, or inventory outcome that needs operator review.', guideId: 'logistics-track-shipments', href: '/logistics/shipments' },
  ],
  processMap: {
    nodes: [
      { id: 'open-buyer', label: 'Open the Buyer Dashboard', type: 'terminal' },
      { id: 'claims-section', label: 'Find Claims and resolution posture', type: 'step' },
      { id: 'new', label: 'Need to file? Contact support', type: 'decision' },
      { id: 'file', label: 'File the claim via support with evidence', type: 'step' },
      { id: 'track', label: 'Track active claims in the dashboard', type: 'step' },
      { id: 'done', label: 'Claim resolved or refunded', type: 'terminal' },
    ],
    edges: [
      { from: 'open-buyer', to: 'claims-section' },
      { from: 'claims-section', to: 'new' },
      { from: 'new', to: 'file', label: 'Yes' },
      { from: 'new', to: 'track', label: 'No' },
      { from: 'file', to: 'track' },
      { from: 'track', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the Buyer Dashboard. 2. Scroll to the "Claims and resolution posture" section, which lists your claims and refund cases. ' +
    '3. There is no standalone claims page and no "File a claim" button: to file a new claim, contact support from /support with the claim type (shortage, damage, delay, wrong items, customs rejection, or fraud), the shipment or order reference, and your evidence. ' +
    '4. Once filed, the claim appears in the dashboard where you track it. 5. Resolution may end in operator review or a linked refund case.',
  steps: [
    {
      id: 'logistics-claims-s1',
      title: 'Open the Buyer Dashboard claims section',
      body: 'Sign in and open /logistics/buyer, the "Buyer Dashboard". The "Claims & refunds" metric at the top shows your open issues, and the "Claims and resolution posture" section below lists active claims ("{{count}} active claims"), refund cases ("{{count}} refund cases"), and delivery records tracked. The hint reads: "Use claims when a shipment, order, or inventory outcome needs operator intervention or evidence review."',
      expectedResult: 'You see your existing claims and their statuses in one section.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/buyer',
          state: 'Buyer Dashboard claims section with one active claim, signed in, light mode',
          alt: 'Buyer Dashboard Claims and resolution posture section',
          caption: 'The claims section of the Buyer Dashboard, desktop view.',
          annotations: [
            { n: 1, label: 'Claims and resolution posture heading', locator: 'h2' },
            { n: 2, label: 'Active claims count', locator: 'section' },
            { n: 3, label: 'Refund cases count', locator: 'section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/buyer',
          state: 'Buyer Dashboard claims section, signed in, light mode',
          alt: 'Claims section on a phone screen',
          caption: 'The claims section, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-claims-s2',
      title: 'File a new claim through support',
      body: 'Note: there is no standalone claims page and no in-app "File a claim" button. Open /support and open a support ticket or conversation. Include the claim type (shortage, damage, delay, wrong items, customs rejection, or fraud), the shipment or order reference, the claimed amount in USD if any, and attach evidence such as photos, documents, or delivery records.',
      expectedResult: 'Support confirms receipt of your claim filing.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/support',
          state: 'Support ticket form for a claim filing, signed in, light mode',
          alt: 'Support page where the claim is filed',
          caption: 'Filing a claim via support, desktop view.',
          annotations: [
            { n: 1, label: 'Support ticket form', locator: 'form' },
            { n: 2, label: 'Evidence attachments', locator: 'input[type="file"]' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/support',
          state: 'Support page, signed in, light mode',
          alt: 'Support page on a phone screen',
          caption: 'Filing a claim via support, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-claims-s3',
      title: 'Track the claim in the Buyer Dashboard',
      body: 'Return to /logistics/buyer. Filed claims appear in the "Claims and resolution posture" section with their status (open, reviewing, resolved). The metric note "Operator review may be needed on open issues" tells you when an operator still needs to act. Keep delivery status close to claims so you can connect failed fulfillment with actual release history.',
      expectedResult: 'Your filed claim is listed with its current status.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/buyer',
          state: 'Claims section with claim status listed, light mode',
          alt: 'Tracked claim with status in the dashboard',
          caption: 'Tracking a claim, desktop view.',
          annotations: [
            { n: 1, label: 'Claim row with status', locator: 'section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/buyer',
          state: 'Claims section with status, light mode',
          alt: 'Claim status on a phone screen',
          caption: 'Tracking a claim, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'logistics-claims-s4',
      title: 'Follow linked refunds in Finance',
      body: 'If the claim leads to a refund, open the "Finance workspace" link from the claims section, or go to /logistics/finance. The "Refund Requests" panel lists linked refund cases and their statuses. See the logistics refund requests guide for the refund workflow.',
      expectedResult: 'Any refund case linked to your claim is visible in Finance.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/logistics/finance',
          state: 'Finance page refund requests panel, light mode',
          alt: 'Finance page with refund cases linked to claims',
          caption: 'Linked refunds in Finance, desktop view.',
          annotations: [
            { n: 1, label: 'Refund Requests panel', locator: 'section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/logistics/finance',
          state: 'Finance refund panel, light mode',
          alt: 'Refund cases on a phone screen',
          caption: 'Linked refunds, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'Your claim is listed in the Buyer Dashboard "Claims and resolution posture" section with its status, and any linked refund case appears in Finance.',
  recovery: [
    {
      problem: 'You cannot find a "File a claim" button.',
      solution: 'That is expected: there is no standalone claims page. File through support at /support with the claim type, reference, and evidence.',
    },
    {
      problem: 'A claim stays open with "Operator review may be needed".',
      solution: 'Add any missing evidence through your support thread, then allow operator review time. Escalate via /support/escalation if it is urgent.',
    },
  ],
  supportContact: 'Claim filing and status: contact support from the in-app support page at /support.',
  relatedGuides: ['logistics-refund-requests', 'logistics-track-shipments'],
  siteLinks: [
    { label: 'Buyer Dashboard', href: '/logistics/buyer' },
    { label: 'Finance', href: '/logistics/finance' },
    { label: 'Support', href: '/support' },
  ],
  sources: [
    { type: 'route', ref: '/logistics/buyer' },
    { type: 'screen', ref: 'client/src/pages/logistics/BuyerDashboardPage.jsx' },
    { type: 'handler', ref: 'POST /api/logistics/claims' },
    { type: 'handler', ref: 'GET /api/logistics/claims' },
  ],
};

export default guide;
