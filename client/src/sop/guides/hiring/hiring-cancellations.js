/**
 * hiring-cancellations.js - SOP guide: Cancel a booking or job.
 * Screen sources: client/src/pages/MyBookingsPage.tsx, client/src/pages/MyJobsPage.jsx,
 * client/src/pages/HelperCancellationSettings.jsx
 */

const guide = {
  id: 'hiring-cancellations',
  area: 'hiring',
  slug: 'cancel-booking',
  title: 'Cancel a booking or job',
  audiences: ['customer', 'helper'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Cancel a booking or a posted job correctly, understanding what happens to payment and the other party.',
  intendedRoles: ['Customer', 'Helper'],
  prerequisites: [
    { text: 'Be signed in to your OxSteed account.', guideId: 'account-signin', href: '/login' },
    { text: 'Know which booking or job you want to cancel.', href: null },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open the booking or job', type: 'terminal' },
      { id: 'choose', label: 'Choose Cancel', type: 'step' },
      { id: 'reason', label: 'Add a reason if asked', type: 'step' },
      { id: 'confirm', label: 'Confirm the cancellation', type: 'step' },
      { id: 'done', label: 'Cancelled; the other party is notified', type: 'terminal' },
    ],
    edges: [
      { from: 'start', to: 'choose' },
      { from: 'choose', to: 'reason' },
      { from: 'reason', to: 'confirm' },
      { from: 'confirm', to: 'done' },
    ],
  },
  processMapText:
    '1. Find the booking on /my-bookings or the job on /my-jobs. 2. Choose Cancel (helpers use the helper-cancel action on incoming requests). ' +
    '3. Add a cancellation reason when asked ("Reason for cancellation (optional)"). 4. Confirm; the booking shows the Cancelled status or the job is removed from the listing. ' +
    '5. The other party is notified. Helpers set their own terms under /settings/payment-policies ("Payment & Cancellation Policies").',
  steps: [
    {
      id: 'hiring-cancellations-s1',
      title: 'Cancel a booking from My bookings',
      body: 'Open /my-bookings and find the booking. Choose Cancel on the booking card and confirm when asked ("Booking request cancelled"). The booking moves to the Cancelled status. Helpers cancel their side with the helper-cancel action on incoming requests.',
      expectedResult: 'The booking shows the Cancelled status.',
      screenshots: [
        {
          id: 'hiring-cancellations-s1-desktop',
          viewport: 'desktop',
          screen: '/my-bookings',
          state: 'Bookings list with cancel confirm, signed in, light mode',
          alt: 'Booking card with the Cancel action and confirmation',
          caption: 'Cancelling a booking, desktop view.',
          annotations: [
            { n: 1, label: 'Cancel action', locator: 'button' },
            { n: 2, label: 'Confirmation prompt', locator: '[role="dialog"]' },
          ],
        },
        {
          id: 'hiring-cancellations-s1-mobile',
          viewport: 'mobile',
          screen: '/my-bookings',
          state: 'Bookings list with cancel confirm, signed in, light mode',
          alt: 'Cancel action on a phone screen',
          caption: 'Cancelling a booking, mobile view.',
          annotations: [
            { n: 1, label: 'Cancel action', locator: 'button' },
          ],
        },
      ],
    },
    {
      id: 'hiring-cancellations-s2',
      title: 'Cancel a posted job from the job detail page',
      body: 'Open the job on /jobs/:id and choose "Cancel Job". The "Cancel this job?" dialog appears; add a cancellation reason in the "Cancellation reason (optional)" field and confirm ("Cancelling..."). The page warns: "This will remove your job listing. Helpers who bid will be notified."',
      expectedResult: 'The job is cancelled and bidding helpers are notified.',
      screenshots: [
        {
          id: 'hiring-cancellations-s2-desktop',
          viewport: 'desktop',
          screen: '/jobs/:id',
          state: 'Cancel this job dialog open, signed in, light mode',
          alt: 'Cancel this job dialog with reason field',
          caption: 'The Cancel this job dialog.',
          annotations: [
            { n: 1, label: 'Cancel this job? title', locator: '[role="dialog"] h2' },
            { n: 2, label: 'Cancellation reason field', locator: 'textarea' },
          ],
        },
        {
          id: 'hiring-cancellations-s2-mobile',
          viewport: 'mobile',
          screen: '/jobs/:id',
          state: 'Cancel this job dialog open, signed in, light mode',
          alt: 'Cancel dialog on a phone screen',
          caption: 'The cancel dialog, mobile view.',
          annotations: [
            { n: 1, label: 'Cancellation reason field', locator: 'textarea' },
          ],
        },
      ],
    },
    {
      id: 'hiring-cancellations-s3',
      title: 'Set your cancellation terms as a helper',
      body: 'Helpers: open /settings/payment-policies, the "Payment & Cancellation Policies" page ("Choose how customers pay you, and what happens when plans change."). Set "Minimum Notice Hours" ("How far ahead a customer must cancel under your terms."), the "Deposit Required (%)" ("Collected upfront when the booking is confirmed."), and enable payment methods: "OxSteed Platform Payment" ("Customers pay via OxSteed with standard cancellation protection") or "Custom Off-Platform Payment" ("Negotiate directly with customers (payment outside OxSteed)"). You must enable at least one payment method.',
      expectedResult: 'Your policies are saved and customers see your terms when reviewing your bid.',
      screenshots: [
        {
          id: 'hiring-cancellations-s3-desktop',
          viewport: 'desktop',
          screen: '/settings/payment-policies',
          state: 'Payment and Cancellation Policies page, helper, signed in, light mode',
          alt: 'Payment and Cancellation Policies settings',
          caption: 'The helper cancellation policy settings.',
          annotations: [
            { n: 1, label: 'Minimum Notice Hours', locator: 'input[name="minimumNoticeHours"]' },
            { n: 2, label: 'Deposit Required (%)', locator: 'input[name="depositPercent"]' },
            { n: 3, label: 'Payment method options', locator: 'fieldset' },
          ],
        },
        {
          id: 'hiring-cancellations-s3-mobile',
          viewport: 'mobile',
          screen: '/settings/payment-policies',
          state: 'Payment and Cancellation Policies page, helper, signed in, light mode',
          alt: 'Cancellation policy settings on a phone screen',
          caption: 'The policy settings, mobile view.',
          annotations: [
            { n: 1, label: 'Policy fields', locator: 'form' },
          ],
        },
      ],
    },
  ],
  confirmOutcome: 'Cancelled bookings show the Cancelled status; cancelled jobs disappear from the open listings. Helpers see their policy terms reflected on their bids.',
  recovery: [
    {
      problem: 'Cancellation is blocked or fails.',
      solution: 'Some states (for example already completed or in dispute) block cancellation. Check the current status; open a dispute or contact support if money is already involved.',
    },
    {
      problem: 'You cancelled by mistake.',
      solution: 'Cancellations are final. Rebook the same helper or repost the job; your history keeps the original details.',
    },
  ],
  supportContact: 'If a cancellation leaves payment in the wrong state, contact support from the Help menu or visit /support.',
  relatedGuides: ['hiring-book', 'hiring-manage-jobs', 'hiring-disputes', 'hiring-payment-records'],
  siteLinks: [
    { label: 'My bookings', href: '/my-bookings' },
    { label: 'My jobs', href: '/my-jobs' },
    { label: 'Payment policies', href: '/settings/payment-policies' },
  ],
  sources: [
    { type: 'route', ref: '/my-bookings' },
    { type: 'route', ref: '/my-jobs' },
    { type: 'route', ref: '/settings/payment-policies' },
    { type: 'screen', ref: 'client/src/pages/MyBookingsPage.tsx' },
    { type: 'screen', ref: 'client/src/pages/MyJobsPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/HelperCancellationSettings.jsx' },
    { type: 'handler', ref: 'POST /api/bookings/:bookingId/cancel, POST /api/jobs/:id/cancel, /api/helper-cancellation-policies' },
    { type: 'permission', ref: 'Authenticated.' },
  ],
};

export default guide;
