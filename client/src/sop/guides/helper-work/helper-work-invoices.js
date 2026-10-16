/**
 * helper-work-invoices.js - Guide: create and send invoices (helper system).
 *
 * Verified against: client/src/pages/HelperDashboard.jsx (Invoices tab, gated by
 * helperInvoices flag), client/src/pages/InvoicesPage.jsx (invoice hub,
 * /invoices), /api/helpers/invoices handlers. This is the HELPER invoice
 * system; business invoices live in the business hub Invoices tab.
 */

export default {
  id: 'helper-work-invoices',
  area: 'helper-work',
  slug: 'create-and-send-invoices',
  title: 'Create and send invoices',
  audiences: ['helper'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Create professional invoices for your clients, send them, and track payment.',
  intendedRoles: ['Helper'],
  prerequisites: [
    { text: 'Sign in and switch to helper mode.', href: '/login' },
    { text: 'Know the client name and email, plus the work you are billing for.', href: '/helper/clients' },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open the dashboard Invoices tab', type: 'terminal' },
      { id: 'create', label: 'Choose Create Invoice', type: 'step' },
      { id: 'fill', label: 'Enter client and line items', type: 'step' },
      { id: 'check', label: 'Client name, email, and a line item entered?', type: 'decision' },
      { id: 'fix', label: 'Fill the required fields', type: 'blocked' },
      { id: 'save', label: 'Save as draft', type: 'step' },
      { id: 'send', label: 'Send the invoice to the client', type: 'step' },
      { id: 'done', label: 'Invoice sent; track payment', type: 'terminal' },
    ],
    edges: [
      { from: 'start', to: 'create' },
      { from: 'create', to: 'fill' },
      { from: 'fill', to: 'check' },
      { from: 'check', to: 'save', label: 'Yes' },
      { from: 'check', to: 'fix', label: 'No' },
      { from: 'fix', to: 'check' },
      { from: 'save', to: 'send' },
      { from: 'send', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the Invoices tab on your helper dashboard. 2. Choose Create Invoice. 3. Enter the client name, client email, and line items with quantities and prices. ' +
    '4. Check that the client name, email, and at least one line item are entered; if not, fill them in and check again. ' +
    '5. Save the invoice as a draft. 6. Send the invoice to the client. 7. Track the invoice status until it is paid.',
  steps: [
    {
      id: 'helper-work-invoices-s1',
      title: 'Open the Invoices tab',
      body: 'Open your helper dashboard (/dashboard or /helper-dashboard) and choose the Invoices tab. The tab is titled "Create and send invoices to clients" and lists your invoices with their statuses (Draft, Sent, Paid). You can also review all invoices at /invoices.',
      expectedResult: 'Your invoice list loads, or the empty state invites you to create one.',
      screenshots: [
        {
          id: 'helper-work-invoices-s1-desktop',
          viewport: 'desktop',
          screen: '/dashboard?tab=invoices',
          state: 'Invoices tab with synthetic invoices, light mode',
          alt: 'Invoices tab showing the Create Invoice button and invoice cards with statuses',
          caption: 'The Invoices tab, desktop view.',
          annotations: [
            { n: 1, label: 'Create Invoice button', locator: 'button' },
            { n: 2, label: 'Invoice with status', locator: '.invoice-card' },
          ],
        },
        {
          id: 'helper-work-invoices-s1-mobile',
          viewport: 'mobile',
          screen: '/dashboard?tab=invoices',
          state: 'Invoices tab with synthetic invoices, light mode',
          alt: 'Invoices tab on a phone screen',
          caption: 'The Invoices tab, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'helper-work-invoices-s2',
      title: 'Start a new invoice',
      body: 'Choose Create Invoice. The Create Invoice dialog opens with fields for the client and the billable work.',
      expectedResult: 'The Create Invoice dialog opens with empty fields.',
      screenshots: [
        {
          id: 'helper-work-invoices-s2-desktop',
          viewport: 'desktop',
          screen: '/dashboard?tab=invoices',
          state: 'Create Invoice dialog open, light mode',
          alt: 'Create Invoice dialog with client name, email, and line item fields',
          caption: 'The Create Invoice dialog, desktop view.',
          annotations: [
            { n: 1, label: 'Client Name field', locator: 'input' },
            { n: 2, label: 'Client Email field', locator: 'input' },
            { n: 3, label: 'Line Items section', locator: '.line-items' },
          ],
        },
        {
          id: 'helper-work-invoices-s2-mobile',
          viewport: 'mobile',
          screen: '/dashboard?tab=invoices',
          state: 'Create Invoice dialog open, light mode',
          alt: 'Create Invoice dialog on a phone screen',
          caption: 'The Create Invoice dialog, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'helper-work-invoices-s3',
      title: 'Enter the client and line items',
      body: 'Enter the Client Name and Client Email. In Line Items, add each piece of work with a Description, Qty, and Unit Price, using Add Item for more lines. Set the optional Tax Rate (%), Due Date, and Notes/Memo, and check the Subtotal, Tax, and Total.',
      expectedResult: 'Client details, at least one line item, and correct totals are shown.',
      screenshots: [
        {
          id: 'helper-work-invoices-s3-desktop',
          viewport: 'desktop',
          screen: '/dashboard?tab=invoices',
          state: 'Create Invoice dialog filled with synthetic data, light mode',
          alt: 'Invoice form filled in with a client and two line items plus totals',
          caption: 'A filled-in invoice, desktop view.',
          annotations: [
            { n: 1, label: 'Line item description', locator: 'input' },
            { n: 2, label: 'Add Item', locator: 'button' },
            { n: 3, label: 'Total', locator: '.invoice-total' },
          ],
        },
        {
          id: 'helper-work-invoices-s3-mobile',
          viewport: 'mobile',
          screen: '/dashboard?tab=invoices',
          state: 'Create Invoice dialog filled with synthetic data, light mode',
          alt: 'Filled-in invoice on a phone screen',
          caption: 'A filled-in invoice, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'helper-work-invoices-s4',
      title: 'Send the invoice and share the link',
      body: 'Save the invoice (it starts as a Draft). For a draft, choose Send to email it to the client. You can also open the public invoice link (/invoice/p/:token) to preview what the client sees or share it manually.',
      expectedResult: '"Invoice sent to client" appears and the status changes to Sent.',
      screenshots: [
        {
          id: 'helper-work-invoices-s4-desktop',
          viewport: 'desktop',
          screen: '/dashboard?tab=invoices',
          state: 'Invoices tab with a sent invoice, light mode',
          alt: 'Invoices tab showing a Sent invoice with a share link option',
          caption: 'A sent invoice, desktop view.',
          annotations: [
            { n: 1, label: 'Send button on draft', locator: 'button' },
            { n: 2, label: 'Public link view', locator: 'button' },
          ],
        },
        {
          id: 'helper-work-invoices-s4-mobile',
          viewport: 'mobile',
          screen: '/invoice/p/:token',
          state: 'Public invoice view, synthetic data, light mode',
          alt: 'Public invoice page as the client sees it',
          caption: 'The public invoice view, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'The invoice shows status Sent, and the client receives the invoice email or link.',
  recovery: [
    {
      problem: 'The invoice does not save.',
      solution: 'Client name, client email, and at least one line item with a description are required. Fill them and save again.',
    },
    {
      problem: 'The client says they never got the email.',
      solution: 'Open the public invoice link and share it with them directly, or use the resend option on the invoice.',
    },
  ],
  supportContact: 'If invoices fail to send, contact OxSteed Support from the /support page.',
  relatedGuides: ['helper-work-clients', 'helper-work-payouts'],
  siteLinks: [
    { label: 'Invoices tab', href: '/dashboard?tab=invoices' },
    { label: 'Invoice hub', href: '/invoices' },
  ],
  sources: [
    { type: 'route', ref: '/dashboard?tab=invoices' },
    { type: 'route', ref: '/invoice/p/:token' },
    { type: 'screen', ref: 'client/src/pages/HelperDashboard.jsx (invoices tab)' },
    { type: 'handler', ref: 'POST /api/helpers/invoices' },
    { type: 'flag', ref: 'helperInvoices: true (LAUNCH_VISIBILITY)' },
  ],
};
