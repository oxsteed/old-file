/**
 * hiring-manage-jobs.js - SOP guide: Manage posted jobs.
 * Screen sources: client/src/pages/MyJobsPage.jsx, client/src/pages/JobDetailPage.jsx,
 * client/src/pages/JobEditPage.jsx
 */

const guide = {
  id: 'hiring-manage-jobs',
  area: 'hiring',
  slug: 'manage-jobs',
  title: 'Manage posted jobs',
  audiences: ['customer'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Track, edit, reschedule, cancel, or complete the jobs you posted.',
  intendedRoles: ['Customer'],
  prerequisites: [
    { text: 'Be signed in with the Customer mode active.', guideId: 'account-signin', href: '/login' },
    { text: 'Have at least one posted job.', guideId: 'hiring-post-job', href: '/post-job' },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open My Jobs', type: 'terminal' },
      { id: 'find', label: 'Find the job', type: 'step' },
      { id: 'choose', label: 'Choose an action', type: 'decision' },
      { id: 'edit', label: 'Edit job details', type: 'step' },
      { id: 'assign', label: 'Review bids and assign a helper', type: 'step' },
      { id: 'cancel', label: 'Cancel the job with a reason', type: 'step' },
      { id: 'complete', label: 'Mark the job complete', type: 'step' },
      { id: 'done', label: 'Job updated', type: 'terminal' },
    ],
    edges: [
      { from: 'start', to: 'find' },
      { from: 'find', to: 'choose' },
      { from: 'choose', to: 'edit', label: 'Edit' },
      { from: 'choose', to: 'assign', label: 'Assign' },
      { from: 'choose', to: 'cancel', label: 'Cancel' },
      { from: 'choose', to: 'complete', label: 'Complete' },
      { from: 'edit', to: 'done' },
      { from: 'assign', to: 'done' },
      { from: 'cancel', to: 'done' },
      { from: 'complete', to: 'done' },
    ],
  },
  processMapText:
    '1. Open "My Jobs" (/my-jobs). 2. Find the job in the list (tabs include "Assigned to me"). ' +
    '3. Open the job detail page (/jobs/:id). 4. Choose what to do: "Edit job" to change the details, "Review bids" to compare bids and assign, ' +
    '"Cancel Job" to cancel with an optional reason, or "Mark as Complete" when the work is done. 5. Confirm any dialog; the job status updates.',
  steps: [
    {
      id: 'hiring-manage-jobs-s1',
      title: 'Open My Jobs and find the job',
      body: 'Choose "My Jobs" in the navigation, or open /my-jobs directly. The page heading is "My Jobs" with "Post a New Job" for new posts. Find your job in the list; tabs include "Assigned to me" ("Jobs you were hired for"). If you have no jobs yet, the empty state shows "No jobs posted yet." and "Post Your First Job".',
      expectedResult: 'Your posted jobs are listed with their status and bid counts.',
      screenshots: [
        {
          id: 'hiring-manage-jobs-s1-desktop',
          viewport: 'desktop',
          screen: '/my-jobs',
          state: 'My Jobs list with posted jobs, signed in, light mode',
          alt: 'My Jobs page with job cards listed',
          caption: 'The My Jobs list, desktop view.',
          annotations: [
            { n: 1, label: 'My Jobs heading', locator: 'h1' },
            { n: 2, label: 'Job cards with status', locator: '.job-card' },
            { n: 3, label: 'Post a New Job button', locator: 'a[href="/post-job"]' },
          ],
        },
        {
          id: 'hiring-manage-jobs-s1-mobile',
          viewport: 'mobile',
          screen: '/my-jobs',
          state: 'My Jobs list with posted jobs, signed in, light mode',
          alt: 'My Jobs list on a phone screen',
          caption: 'The My Jobs list, mobile view.',
          annotations: [
            { n: 1, label: 'Job cards', locator: '.job-card' },
          ],
        },
      ],
    },
    {
      id: 'hiring-manage-jobs-s2',
      title: 'Open the job detail page',
      body: 'Choose the job to open /jobs/:id. The detail page shows the description, schedule, budget, the "Bids" heading with the bid list, and action buttons such as "Review bids", "Find helpers", and the message option. The appointment section shows the scheduled time.',
      expectedResult: 'The job detail loads with all actions and the current bid list.',
      screenshots: [
        {
          id: 'hiring-manage-jobs-s2-desktop',
          viewport: 'desktop',
          screen: '/jobs/:id',
          state: 'Job detail with bids, signed in, light mode',
          alt: 'Job detail page with Bids section and action buttons',
          caption: 'The job detail page, desktop view.',
          annotations: [
            { n: 1, label: 'Job summary', locator: 'section' },
            { n: 2, label: 'Bids heading', locator: 'h2' },
            { n: 3, label: 'Action buttons', locator: '.job-actions' },
          ],
        },
        {
          id: 'hiring-manage-jobs-s2-mobile',
          viewport: 'mobile',
          screen: '/jobs/:id',
          state: 'Job detail with bids, signed in, light mode',
          alt: 'Job detail on a phone screen',
          caption: 'The job detail page, mobile view.',
          annotations: [
            { n: 1, label: 'Bids section', locator: 'section' },
          ],
        },
      ],
    },
    {
      id: 'hiring-manage-jobs-s3',
      title: 'Edit, cancel, or reschedule the job',
      body: 'To change details, choose "Edit job" (/jobs/:id/edit), update the fields, and save; helpers with existing bids are told to reconfirm ("The customer changed this job"). To cancel, choose "Cancel Job" in the "Cancel this job?" dialog, optionally add a cancellation reason ("Reason for cancellation (optional)"), and confirm ("Cancelling..."). The page warns: "This will remove your job listing. Helpers who bid will be notified."',
      expectedResult: 'The edit saves or the job moves to a cancelled state with notifications sent.',
      screenshots: [
        {
          id: 'hiring-manage-jobs-s3-desktop',
          viewport: 'desktop',
          screen: '/jobs/:id',
          state: 'Cancel job dialog open, signed in, light mode',
          alt: 'Cancel this job dialog with the reason field',
          caption: 'The Cancel this job dialog.',
          annotations: [
            { n: 1, label: 'Cancel this job? title', locator: '[role="dialog"] h2' },
            { n: 2, label: 'Cancellation reason field', locator: 'textarea' },
          ],
        },
        {
          id: 'hiring-manage-jobs-s3-mobile',
          viewport: 'mobile',
          screen: '/jobs/:id',
          state: 'Cancel job dialog open, signed in, light mode',
          alt: 'Cancel dialog on a phone screen',
          caption: 'The cancel dialog, mobile view.',
          annotations: [
            { n: 1, label: 'Cancellation reason field', locator: 'textarea' },
          ],
        },
      ],
    },
  ],
  confirmOutcome: 'The job shows its new state in My Jobs (edited details saved, or cancelled status). Helpers who bid are notified of cancellations and of edits that need reconfirmation.',
  recovery: [
    {
      problem: 'Editing is blocked because a bid was accepted.',
      solution: 'Once a bid is accepted, major changes are restricted. Cancel and repost the job if the scope truly changed.',
    },
    {
      problem: 'A helper must reconfirm after your edit.',
      solution: 'That is expected: "This helper must reconfirm their bid after your latest changes." Wait for the reconfirmation before assigning.',
    },
  ],
  supportContact: 'If a job is stuck in the wrong state after an action, contact support from the Help menu or visit /support.',
  relatedGuides: ['hiring-post-job', 'hiring-compare-bids', 'hiring-completion', 'hiring-cancellations'],
  siteLinks: [
    { label: 'My jobs', href: '/my-jobs' },
    { label: 'Post a job', href: '/post-job' },
  ],
  sources: [
    { type: 'route', ref: '/my-jobs' },
    { type: 'route', ref: '/jobs/:id' },
    { type: 'route', ref: '/jobs/:id/edit' },
    { type: 'screen', ref: 'client/src/pages/MyJobsPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/JobDetailPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/JobEditPage.jsx' },
    { type: 'handler', ref: 'GET /api/jobs, PATCH/PUT /api/jobs/:id, POST /api/jobs/:id/cancel' },
    { type: 'permission', ref: 'Authenticated (job owner for mutations).' },
  ],
};

export default guide;
