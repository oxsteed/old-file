/**
 * hiring-completion.js - SOP guide: Mark a job complete.
 * Screen sources: client/src/pages/JobDetailPage.jsx, client/src/pages/MyJobsPage.jsx,
 * client/src/pages/WorkAgreementPage.jsx
 */

const guide = {
  id: 'hiring-completion',
  area: 'hiring',
  slug: 'mark-job-complete',
  title: 'Mark a job complete',
  audiences: ['customer', 'helper'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Confirm a finished job so payment releases, reviews unlock, and the record closes.',
  intendedRoles: ['Customer', 'Helper'],
  prerequisites: [
    { text: 'Be signed in to your OxSteed account.', guideId: 'account-signin', href: '/login' },
    { text: 'The work itself must be finished and checked.', href: null },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open the finished job', type: 'terminal' },
      { id: 'customer', label: 'Customer chooses Mark as Complete', type: 'step' },
      { id: 'helper', label: 'Helper chooses Mark job done', type: 'step' },
      { id: 'confirm', label: 'Other party confirms?', type: 'decision' },
      { id: 'done', label: 'Job completed; reviews unlock', type: 'terminal' },
      { id: 'auto', label: 'Auto-confirm after no response', type: 'blocked' },
    ],
    edges: [
      { from: 'start', to: 'customer' },
      { from: 'start', to: 'helper' },
      { from: 'customer', to: 'confirm' },
      { from: 'helper', to: 'confirm' },
      { from: 'confirm', to: 'done', label: 'Confirmed' },
      { from: 'confirm', to: 'auto', label: 'No response' },
      { from: 'auto', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the finished job on /my-jobs or /jobs/:id. ' +
    '2. Customers choose "Mark as Complete"; helpers choose "Mark job done". ' +
    '3. The other party confirms. If the customer does not respond, it confirms automatically after the waiting period ("You marked this job done. Waiting for the customer to confirm; it confirms automatically if they don\'t respond."). ' +
    '4. Completion shows "Job completed successfully" and unlocks reviews. ' +
    '5. Work agreements have their own completion: open /agreements/:id and choose "Confirm complete"; both parties confirm before the agreement is marked complete.',
  steps: [
    {
      id: 'hiring-completion-s1',
      title: 'Open the finished job',
      body: 'Open /my-jobs and choose the job, or open /jobs/:id directly. Make sure the work is actually finished: completion triggers payment release and review eligibility.',
      expectedResult: 'The job detail shows the completion action for your role.',
      screenshots: [
        {
          id: 'hiring-completion-s1-desktop',
          viewport: 'desktop',
          screen: '/jobs/:id',
          state: 'Finished job detail, signed in, light mode',
          alt: 'Job detail page with the completion button visible',
          caption: 'The finished job with the completion action.',
          annotations: [
            { n: 1, label: 'Mark as Complete button', locator: 'button' },
          ],
        },
        {
          id: 'hiring-completion-s1-mobile',
          viewport: 'mobile',
          screen: '/jobs/:id',
          state: 'Finished job detail, signed in, light mode',
          alt: 'Job detail on a phone screen',
          caption: 'The completion action, mobile view.',
          annotations: [
            { n: 1, label: 'Mark as Complete button', locator: 'button' },
          ],
        },
      ],
    },
    {
      id: 'hiring-completion-s2',
      title: 'Mark the job complete and wait for confirmation',
      body: 'Customers choose "Mark as Complete"; helpers choose "Mark job done". The page confirms: "Job completed successfully", or, for the helper side, "You marked this job done. Waiting for the customer to confirm; it confirms automatically if they don\'t respond." Do not mark complete until the work is checked.',
      expectedResult: 'The job shows as completed (or pending the other party\'s confirmation).',
      screenshots: [
        {
          id: 'hiring-completion-s2-desktop',
          viewport: 'desktop',
          screen: '/jobs/:id',
          state: 'Job completed confirmation, signed in, light mode',
          alt: 'Job completed successfully confirmation',
          caption: 'The completed confirmation.',
          annotations: [
            { n: 1, label: 'Job completed successfully', locator: '.toast-success' },
          ],
        },
        {
          id: 'hiring-completion-s2-mobile',
          viewport: 'mobile',
          screen: '/jobs/:id',
          state: 'Job completed confirmation, signed in, light mode',
          alt: 'Completion confirmation on a phone screen',
          caption: 'The confirmation, mobile view.',
          annotations: [
            { n: 1, label: 'Job completed successfully', locator: '.toast-success' },
          ],
        },
      ],
    },
    {
      id: 'hiring-completion-s3',
      title: 'Complete the work agreement if one exists',
      body: 'If the job has a signed work agreement, completion is a separate step: open /agreements/:id, find the "Work finished?" section, and choose "Confirm complete". The agreement notes: "Both of you confirm before the agreement is marked complete." Once both confirm, held payment is released unless open issues remain.',
      expectedResult: 'The agreement shows as complete and payment releases to the helper.',
      screenshots: [
        {
          id: 'hiring-completion-s3-desktop',
          viewport: 'desktop',
          screen: '/agreements/:id',
          state: 'Work agreement with Confirm complete, signed in, light mode',
          alt: 'Work agreement page with the Confirm complete button',
          caption: 'Completing the work agreement.',
          annotations: [
            { n: 1, label: 'Confirm complete button', locator: 'button' },
          ],
        },
        {
          id: 'hiring-completion-s3-mobile',
          viewport: 'mobile',
          screen: '/agreements/:id',
          state: 'Work agreement with Confirm complete, signed in, light mode',
          alt: 'Agreement completion on a phone screen',
          caption: 'Completing the agreement, mobile view.',
          annotations: [
            { n: 1, label: 'Confirm complete button', locator: 'button' },
          ],
        },
      ],
    },
  ],
  confirmOutcome: 'The job shows the completed status and review eligibility opens. For agreements, both parties see the completed state and "Payment released to the helper."',
  recovery: [
    {
      problem: 'The job will not mark complete.',
      solution: 'Only the parties on the job can complete it, and some states (for example cancelled) block completion. Check the job status and your role first.',
    },
    {
      problem: 'Payment is still held after agreement completion.',
      solution: 'That is by design when open issues remain: "The agreement is complete, but the job payment is still held. It will be released once any open issues are resolved." Resolve the issues or open a dispute.',
    },
  ],
  supportContact: 'If completion is blocked by a state you cannot change, contact support from the Help menu or visit /support.',
  relatedGuides: ['hiring-reviews', 'hiring-manage-jobs', 'hiring-work-agreements', 'hiring-disputes'],
  siteLinks: [
    { label: 'My jobs', href: '/my-jobs' },
  ],
  sources: [
    { type: 'route', ref: '/my-jobs' },
    { type: 'route', ref: '/jobs/:id' },
    { type: 'route', ref: '/agreements/:id' },
    { type: 'screen', ref: 'client/src/pages/JobDetailPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/MyJobsPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/WorkAgreementPage.jsx' },
    { type: 'handler', ref: 'POST /api/jobs/:id/complete, POST /api/work-agreements/:id/complete' },
    { type: 'permission', ref: 'Authenticated.' },
  ],
};

export default guide;
