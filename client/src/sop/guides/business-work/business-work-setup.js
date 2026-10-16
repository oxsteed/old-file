/**
 * business-work-setup.js - Guide: set up a business (launch request, onboarding, franchise).
 *
 * Verified against: client/src/pages/ConsultingIntakePage.jsx (/consulting-intake:
 * package select, multi-step form, Submit & Get Started), client/src/pages/BusinessLaunchStatusPage.jsx
 * (/business-launch-status: email lookup, Check Status, launch progress),
 * routes /business/:businessId/onboarding, /franchise/apply, /franchise/status in App.jsx.
 */

export default {
  id: 'business-work-setup',
  area: 'business-work',
  slug: 'set-up-a-business',
  title: 'Set up a business (launch request, onboarding, franchise)',
  audiences: ['business'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Submit a business launch request, track its progress, and finish onboarding once approved.',
  intendedRoles: ['Business owner'],
  prerequisites: [
    { text: 'Know your skill or service, your target market, and whether you have a business name.', href: '/consulting-intake' },
    { text: 'An OxSteed account so your request can be linked to you.', href: '/login' },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open the launch intake form', type: 'terminal' },
      { id: 'package', label: 'Choose a launch package', type: 'step' },
      { id: 'form', label: 'Complete the intake form', type: 'step' },
      { id: 'submit', label: 'Submit and Get Started', type: 'step' },
      { id: 'track', label: 'Track at business-launch-status', type: 'step' },
      { id: 'decision', label: 'Launch approved?', type: 'decision' },
      { id: 'wait', label: 'Complete kickoff steps from the status page', type: 'blocked' },
      { id: 'onboard', label: 'Complete business onboarding', type: 'step' },
      { id: 'done', label: 'Business live', type: 'terminal' },
    ],
    edges: [
      { from: 'start', to: 'package' },
      { from: 'package', to: 'form' },
      { from: 'form', to: 'submit' },
      { from: 'submit', to: 'track' },
      { from: 'track', to: 'decision' },
      { from: 'decision', to: 'onboard', label: 'Yes' },
      { from: 'decision', to: 'wait', label: 'Not yet' },
      { from: 'wait', to: 'track' },
      { from: 'onboard', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the launch intake form. 2. Choose a launch package. 3. Complete the intake form steps. ' +
    '4. Choose Submit and Get Started. 5. Track your request at the launch status page with your email. ' +
    '6. If the launch is not approved yet, complete the kickoff steps shown on the status page and check back. ' +
    '7. When approved, complete business onboarding. 8. Your business is live and you can open the business hub.',
  steps: [
    {
      id: 'business-work-setup-s1',
      title: 'Open the launch intake form',
      body: 'Open /consulting-intake. This is the public business launch intake: the submit endpoint is rate-limited and open to guests, while status views need you signed in. Launch requests go through a request and approval flow, not instant provisioning.',
      expectedResult: 'The intake form opens at the package selection step.',
      screenshots: [
        {
          id: 'business-work-setup-s1-desktop',
          viewport: 'desktop',
          screen: '/consulting-intake',
          state: 'Intake form, package selection step, light mode',
          alt: 'Launch intake form showing the launch package options',
          caption: 'The launch intake form, desktop view.',
          annotations: [
            { n: 1, label: 'Launch package options', locator: '.package-options' },
          ],
        },
        {
          id: 'business-work-setup-s1-mobile',
          viewport: 'mobile',
          screen: '/consulting-intake',
          state: 'Intake form, package selection step, light mode',
          alt: 'Package options on a phone screen',
          caption: 'The launch intake form, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'business-work-setup-s2',
      title: 'Complete the intake steps',
      body: 'Choose a package, then step through the form with Next and Back: your contact details (Email, First Name, Last Name, Phone Number), your skill or service ("What is your primary skill or service?"), your target market, revenue status, business name ideas, country, business phase, and urgency. The final step shows a review.',
      expectedResult: 'The review step shows your full intake summary with no missing required fields.',
      screenshots: [
        {
          id: 'business-work-setup-s2-desktop',
          viewport: 'desktop',
          screen: '/consulting-intake',
          state: 'Intake form, business details step with synthetic data, light mode',
          alt: 'Intake form business details step with skill, market, and business name fields',
          caption: 'Completing the intake, desktop view.',
          annotations: [
            { n: 1, label: 'Skill and market fields', locator: 'input, textarea' },
            { n: 2, label: 'Next button', locator: 'button' },
          ],
        },
        {
          id: 'business-work-setup-s2-mobile',
          viewport: 'mobile',
          screen: '/consulting-intake',
          state: 'Intake form, contact step with synthetic data, light mode',
          alt: 'Contact step on a phone screen',
          caption: 'Completing the intake, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'business-work-setup-s3',
      title: 'Submit and get started',
      body: 'On the review step, choose Submit and Get Started. The button shows Submitting while your request posts. You will get a confirmation with what happens next.',
      expectedResult: 'A confirmation page appears with your next steps.',
      screenshots: [
        {
          id: 'business-work-setup-s3-desktop',
          viewport: 'desktop',
          screen: '/consulting-intake',
          state: 'Intake form review step, synthetic data, light mode',
          alt: 'Review step with the Submit and Get Started button',
          caption: 'Submitting the intake, desktop view.',
          annotations: [
            { n: 1, label: 'Submit and Get Started button', locator: 'button' },
          ],
        },
        {
          id: 'business-work-setup-s3-mobile',
          viewport: 'mobile',
          screen: '/consulting-intake',
          state: 'Intake form review step, synthetic data, light mode',
          alt: 'Review step on a phone screen',
          caption: 'Submitting the intake, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'business-work-setup-s4',
      title: 'Track your launch request',
      body: 'Open /business-launch-status ("Track Your Business Launch"). Enter the email you used on the intake and choose Check Status. Your request card shows Launch progress, the current phase out of 25, and a "What is Next?" list. Choose View details for the full intake and timeline.',
      expectedResult: 'Your request appears with its current phase and next steps.',
      screenshots: [
        {
          id: 'business-work-setup-s4-desktop',
          viewport: 'desktop',
          screen: '/business-launch-status',
          state: 'Launch status page with synthetic request, light mode',
          alt: 'Launch status page showing launch progress, current phase, and next steps',
          caption: 'Tracking a launch request, desktop view.',
          annotations: [
            { n: 1, label: 'Email lookup and Check Status', locator: 'input, button' },
            { n: 2, label: 'Launch progress', locator: '.launch-progress' },
            { n: 3, label: 'What is Next list', locator: '.next-steps' },
          ],
        },
        {
          id: 'business-work-setup-s4-mobile',
          viewport: 'mobile',
          screen: '/business-launch-status',
          state: 'Launch status page with synthetic request, light mode',
          alt: 'Launch status on a phone screen',
          caption: 'Tracking a launch request, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'business-work-setup-s5',
      title: 'Complete business onboarding or the franchise track',
      body: 'When your launch is approved, complete onboarding at /business/:businessId/onboarding. If you are applying for a franchise instead, use /franchise/apply and track it at /franchise/status. After onboarding, open the business hub to manage your business.',
      expectedResult: 'Onboarding completes and your business appears in the business hub.',
      screenshots: [
        {
          id: 'business-work-setup-s5-desktop',
          viewport: 'desktop',
          screen: '/business/:businessId/onboarding',
          state: 'Business onboarding page, light mode',
          alt: 'Business onboarding page with setup checklist',
          caption: 'Business onboarding, desktop view.',
          annotations: [
            { n: 1, label: 'Onboarding checklist', locator: '.onboarding-checklist' },
          ],
        },
        {
          id: 'business-work-setup-s5-mobile',
          viewport: 'mobile',
          screen: '/business/:businessId/onboarding',
          state: 'Business onboarding page, light mode',
          alt: 'Onboarding checklist on a phone screen',
          caption: 'Business onboarding, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'Your business appears in the business hub at /business-hub and you can open its workspace.',
  recovery: [
    {
      problem: 'The status page says no intake forms found for your email.',
      solution: 'Check you typed the same email used on the intake form. If you submitted as a guest, try the exact address again.',
    },
    {
      problem: 'Your request stays pending for days.',
      solution: 'The team reviews submissions usually within 24 hours and reaches out by email. Check your inbox and spam for the scheduling link and pre-kickoff questionnaire.',
    },
  ],
  supportContact: 'If your approved business never appears in the hub, contact OxSteed Support from the /support page.',
  relatedGuides: ['business-work-select', 'business-work-team-access'],
  siteLinks: [
    { label: 'Launch intake', href: '/consulting-intake' },
    { label: 'Track your launch', href: '/business-launch-status' },
    { label: 'Franchise apply', href: '/franchise/apply' },
    { label: 'Business hub', href: '/business-hub' },
  ],
  sources: [
    { type: 'route', ref: '/consulting-intake' },
    { type: 'route', ref: '/business-launch-status' },
    { type: 'route', ref: '/business/:businessId/onboarding' },
    { type: 'screen', ref: 'client/src/pages/ConsultingIntakePage.jsx' },
    { type: 'screen', ref: 'client/src/pages/BusinessLaunchStatusPage.jsx' },
    { type: 'handler', ref: 'POST /consulting/business-launch/submit' },
  ],
};
