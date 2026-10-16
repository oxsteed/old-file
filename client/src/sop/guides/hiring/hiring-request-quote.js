/**
 * hiring-request-quote.js - SOP guide: Request a quote (Direct).
 * Screen source: client/src/pages/DirectPortalPage.jsx (route: /direct/request-quote; also /request-quote, /quote-request)
 */

const guide = {
  id: 'hiring-request-quote',
  area: 'hiring',
  slug: 'request-direct-quote',
  title: 'Request a quote (Direct)',
  audiences: ['customer'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Request a quote from OxSteed Direct and look it up later with an email code.',
  intendedRoles: ['Customer'],
  prerequisites: [
    { text: 'Know what work you need, where it is, and when you want it.', href: null },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open the Direct quote request page', type: 'terminal' },
      { id: 'fill', label: 'Enter contact and job details', type: 'step' },
      { id: 'send', label: 'Submit the quote request', type: 'step' },
      { id: 'done', label: 'Request sent', type: 'terminal' },
      { id: 'lookup', label: 'Look up the quote with an email code', type: 'step' },
    ],
    edges: [
      { from: 'start', to: 'fill' },
      { from: 'fill', to: 'send' },
      { from: 'send', to: 'done' },
      { from: 'done', to: 'lookup' },
      { from: 'lookup', to: 'done' },
    ],
  },
  processMapText:
    '1. Open /direct/request-quote ("Request a Direct quote": "Keep it simple. Tell us what you need, where the work is, and when you want it done."). ' +
    '2. Fill in your details (First name, Last name, Email, Phone, Company name), describe the work and the timeline, and add a photo when helpful. ' +
    '3. Submit; the page confirms "Quote request sent." 4. Later, open /direct/view-quote ("View your quote") and verify with the email code to see your quote. ' +
    'Guests can request and look up by code; signing in adds detail views.',
  steps: [
    {
      id: 'hiring-request-quote-s1',
      title: 'Open the Direct quote request page',
      body: 'Open /direct/request-quote (also reachable at /request-quote or /quote-request). The page title is "Request a Direct quote" with the subtitle "Keep it simple. Tell us what you need, where the work is, and when you want it done." Guests can request without an account.',
      expectedResult: 'The quote request form loads with contact and job sections.',
      screenshots: [
        {
          id: 'hiring-request-quote-s1-desktop',
          viewport: 'desktop',
          screen: '/direct/request-quote',
          state: 'Blank quote request form, guest, light mode',
          alt: 'Request a Direct quote page with the form sections',
          caption: 'The Direct quote request page, desktop view.',
          annotations: [
            { n: 1, label: 'Request a Direct quote heading', locator: 'h1' },
            { n: 2, label: 'Your details section', locator: 'fieldset' },
          ],
        },
        {
          id: 'hiring-request-quote-s1-mobile',
          viewport: 'mobile',
          screen: '/direct/request-quote',
          state: 'Blank quote request form, guest, light mode',
          alt: 'Quote request form on a phone screen',
          caption: 'The request page, mobile view.',
          annotations: [
            { n: 1, label: 'Request form', locator: 'form' },
          ],
        },
      ],
    },
    {
      id: 'hiring-request-quote-s2',
      title: 'Enter your details and describe the work',
      body: 'Fill in the "Your details" section: First name, Last name, Email, Phone, Company name (optional), and contact method. Then describe the work and the timeline ("What to include" lists contact, work, and timeline hints). Add a photo when the job is visible.',
      expectedResult: 'All required fields are filled and the form validates.',
      screenshots: [
        {
          id: 'hiring-request-quote-s2-desktop',
          viewport: 'desktop',
          screen: '/direct/request-quote',
          state: 'Quote request form filled in, guest, light mode',
          alt: 'Filled contact and job details on the request form',
          caption: 'The filled request form.',
          annotations: [
            { n: 1, label: 'Contact fields', locator: 'input' },
            { n: 2, label: 'Work description', locator: 'textarea' },
            { n: 3, label: 'Photo upload', locator: 'input[type="file"]' },
          ],
        },
        {
          id: 'hiring-request-quote-s2-mobile',
          viewport: 'mobile',
          screen: '/direct/request-quote',
          state: 'Quote request form filled in, guest, light mode',
          alt: 'Request form fields on a phone screen',
          caption: 'The request form, mobile view.',
          annotations: [
            { n: 1, label: 'Contact fields', locator: 'input' },
          ],
        },
      ],
    },
    {
      id: 'hiring-request-quote-s3',
      title: 'Submit and confirm the request',
      body: 'Submit the form. The page confirms "Quote request sent." Keep your email address; quote updates and the lookup code go there.',
      expectedResult: 'The "Quote request sent." confirmation appears.',
      screenshots: [
        {
          id: 'hiring-request-quote-s3-desktop',
          viewport: 'desktop',
          screen: '/direct/request-quote',
          state: 'Quote request sent confirmation, guest, light mode',
          alt: 'Quote request sent confirmation',
          caption: 'The sent confirmation, desktop view.',
          annotations: [
            { n: 1, label: 'Quote request sent confirmation', locator: '.confirmation' },
          ],
        },
        {
          id: 'hiring-request-quote-s3-mobile',
          viewport: 'mobile',
          screen: '/direct/request-quote',
          state: 'Quote request sent confirmation, guest, light mode',
          alt: 'Confirmation on a phone screen',
          caption: 'The sent confirmation, mobile view.',
          annotations: [
            { n: 1, label: 'Quote request sent confirmation', locator: '.confirmation' },
          ],
        },
      ],
    },
    {
      id: 'hiring-request-quote-s4',
      title: 'Look up your quote with the email code',
      body: 'Open /direct/view-quote ("View your quote"). Enter your email and request the code, then enter the code to unlock your quote detail. Signing in gives fuller detail views at /direct/quotes/:id.',
      expectedResult: 'Your quote appears with its line items and status.',
      screenshots: [
        {
          id: 'hiring-request-quote-s4-desktop',
          viewport: 'desktop',
          screen: '/direct/view-quote',
          state: 'View your quote code lookup, guest, light mode',
          alt: 'View your quote page with the email code lookup',
          caption: 'The quote lookup page, desktop view.',
          annotations: [
            { n: 1, label: 'View your quote heading', locator: 'h1' },
            { n: 2, label: 'Email and code lookup', locator: 'form' },
          ],
        },
        {
          id: 'hiring-request-quote-s4-mobile',
          viewport: 'mobile',
          screen: '/direct/view-quote',
          state: 'View your quote code lookup, guest, light mode',
          alt: 'Quote lookup on a phone screen',
          caption: 'The quote lookup, mobile view.',
          annotations: [
            { n: 1, label: 'Email and code lookup', locator: 'form' },
          ],
        },
      ],
    },
  ],
  confirmOutcome: 'The "Quote request sent." confirmation appears, and /direct/view-quote shows your quote after code verification. My quote requests are also listed when you are signed in.',
  recovery: [
    {
      problem: 'The form will not submit.',
      solution: 'Complete the required contact fields and check the email and phone formats; the form flags invalid entries. Past dates are rejected.',
    },
    {
      problem: 'You cannot open your quote.',
      solution: 'Use the exact email from the request and the freshest code; codes expire. Signed-in users can also open /direct/quotes/:id.',
    },
  ],
  supportContact: 'For help with a Direct quote, contact support from the Help menu or visit /support.',
  relatedGuides: ['hiring-find-help', 'hiring-book', 'hiring-post-job'],
  siteLinks: [
    { label: 'Request a Direct quote', href: '/direct/request-quote' },
    { label: 'View your quote', href: '/direct/view-quote' },
    { label: 'Direct services', href: '/direct/services' },
  ],
  sources: [
    { type: 'route', ref: '/direct/request-quote' },
    { type: 'route', ref: '/direct/view-quote' },
    { type: 'screen', ref: 'client/src/pages/DirectPortalPage.jsx' },
    { type: 'handler', ref: 'POST /api/quote-requests, GET /api/quote-requests/my, POST /api/direct/public/lookup' },
    { type: 'permission', ref: 'Guest can request and look up by code; authenticated for detail.' },
  ],
};

export default guide;
