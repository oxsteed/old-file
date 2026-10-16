/**
 * other-consulting - Request and deliver consulting.
 * Sources: client/src/pages/ConsultingIntakePage.jsx,
 * client/src/pages/ConsultingFullPortal.jsx,
 * client/src/pages/ConsultantContractorDashboard.jsx
 * Routes: /consulting-intake, /consulting/portal, /consulting/contractor-dashboard
 */

const guide = {
  id: 'other-consulting',
  area: 'consulting',
  slug: 'request-consulting',
  title: 'Request and deliver consulting',
  audiences: ['customer', 'helper'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Submit a consulting intake request, or manage consulting work as a consultant.',
  intendedRoles: ['Customer', 'Helper (consultant)'],
  prerequisites: [
    { text: 'No account needed for intake. Sign in to use the portal and contractor dashboard.', href: '/login' },
  ],
  processMap: {
    nodes: [
      { id: 'open', label: 'Open the consulting intake', type: 'terminal' },
      { id: 'steps', label: 'Complete Contact, Skill & Offer, Setup Needs, Package, Services', type: 'step' },
      { id: 'review', label: 'Review Your Submission', type: 'step' },
      { id: 'submit', label: 'Choose Submit & Get Started', type: 'step' },
      { id: 'portal', label: 'Track sessions in the consulting portal', type: 'step' },
      { id: 'dashboard', label: 'Consultants: work the contractor dashboard', type: 'step' },
      { id: 'done', label: 'Consulting requested or delivered', type: 'terminal' },
    ],
    edges: [
      { from: 'open', to: 'steps' },
      { from: 'steps', to: 'review' },
      { from: 'review', to: 'submit' },
      { from: 'submit', to: 'portal' },
      { from: 'portal', to: 'dashboard' },
      { from: 'dashboard', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the consulting intake at /consulting-intake, titled "Business Ascension Consulting Intake". ' +
    '2. Work through the steps: Contact, Skill & Offer, Setup Needs, Package, and Services. ' +
    '3. Review everything on "Review Your Submission". 4. Choose "Submit & Get Started". ' +
    '5. Track your sessions in the consulting portal at /consulting/portal. ' +
    '6. Consultants manage their pipeline from the contractor dashboard at /consulting/contractor-dashboard.',
  steps: [
    {
      id: 'other-consulting-s1',
      title: 'Open the consulting intake',
      body: 'Open /consulting-intake. The page is titled "Business Ascension Consulting Intake". The step indicator shows Contact, "Skill & Offer", "Setup Needs", Package, Services, and Confirm. Guests can complete intake without an account.',
      expectedResult: 'The intake form loads on the Contact step.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/consulting-intake',
          state: 'Consulting intake, Contact step, guest, light mode',
          alt: 'Consulting intake with the step indicator',
          caption: 'The consulting intake, desktop view.',
          annotations: [
            { n: 1, label: 'Intake title', locator: 'h1' },
            { n: 2, label: 'Step indicator', locator: 'ol' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/consulting-intake',
          state: 'Consulting intake, guest, light mode',
          alt: 'Intake on a phone screen',
          caption: 'The consulting intake, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-consulting-s2',
      title: 'Complete the intake steps',
      body: 'Fill in Contact (name, email, phone, business name, country), then "Skill & Offer", "Setup Needs", Package, and Services. Use "Back" to go to the previous step and "Next" to continue. Each step validates before you can move on.',
      expectedResult: 'All steps show as complete and you reach the Confirm step.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/consulting-intake',
          state: 'Intake mid-flow, Package step, light mode',
          alt: 'Package step of the consulting intake',
          caption: 'Completing intake steps, desktop view.',
          annotations: [
            { n: 1, label: 'Step fields', locator: 'form' },
            { n: 2, label: 'Next button', locator: 'button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/consulting-intake',
          state: 'Intake mid-flow, light mode',
          alt: 'Intake step on a phone screen',
          caption: 'Completing steps, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-consulting-s3',
      title: 'Review and submit',
      body: 'On the Confirm step, titled "Review Your Submission", check every section: contact details, selected skill and package, setup needs, and services. Choose "Submit & Get Started". You receive a confirmation of your request.',
      expectedResult: 'The intake is submitted and a confirmation appears.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/consulting-intake',
          state: 'Review Your Submission step, light mode',
          alt: 'Intake review with Submit and Get Started button',
          caption: 'Reviewing the submission, desktop view.',
          annotations: [
            { n: 1, label: 'Submission summary', locator: 'section' },
            { n: 2, label: 'Submit & Get Started button', locator: 'button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/consulting-intake',
          state: 'Review step, light mode',
          alt: 'Review on a phone screen',
          caption: 'Reviewing, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-consulting-s4',
      title: 'Track sessions in the portal and dashboard',
      body: 'Sign in and open /consulting/portal to track your consulting sessions. Consultants (helper-class mode) open /consulting/contractor-dashboard to manage their pipeline, referrals, and availability; availability itself is managed at /consultant-availability.',
      expectedResult: 'Your sessions and pipeline are visible in the portal and dashboard.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/consulting/portal',
          state: 'Consulting portal, signed in, light mode',
          alt: 'Consulting portal with sessions',
          caption: 'The consulting portal, desktop view.',
          annotations: [
            { n: 1, label: 'Sessions list', locator: 'main' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/consulting/portal',
          state: 'Consulting portal, signed in, light mode',
          alt: 'Portal on a phone screen',
          caption: 'The consulting portal, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'Your intake shows as submitted, and sessions appear in the consulting portal.',
  recovery: [
    {
      problem: 'You cannot move past a step.',
      solution: 'Complete every required field on the current step; validation errors are shown inline.',
    },
    {
      problem: 'The portal shows no sessions after submitting.',
      solution: 'Sessions appear after the request is matched. If nothing appears within a few days, contact support at /support.',
    },
  ],
  supportContact: 'Consulting questions: contact support from the in-app support page at /support.',
  relatedGuides: ['other-messages', 'other-calendar'],
  siteLinks: [
    { label: 'Consulting intake', href: '/consulting-intake' },
    { label: 'Consulting portal', href: '/consulting/portal' },
    { label: 'Consultant dashboard', href: '/consulting/contractor-dashboard' },
  ],
  sources: [
    { type: 'route', ref: '/consulting-intake' },
    { type: 'route', ref: '/consulting/portal' },
    { type: 'route', ref: '/consulting/contractor-dashboard' },
    { type: 'screen', ref: 'client/src/pages/ConsultingIntakePage.jsx' },
    { type: 'screen', ref: 'client/src/pages/ConsultingFullPortal.jsx' },
    { type: 'screen', ref: 'client/src/pages/ConsultantContractorDashboard.jsx' },
    { type: 'handler', ref: 'POST /api/consulting/submit' },
  ],
};

export default guide;
