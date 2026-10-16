/**
 * other-planned-needs - Plan recurring needs.
 * Sources: client/src/pages/PlannedNeedsPage.jsx
 * Route: /planned-needs
 */

const guide = {
  id: 'other-planned-needs',
  area: 'other',
  slug: 'plan-recurring-needs',
  title: 'Plan recurring needs',
  audiences: ['customer'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Create recurring household needs that auto-publish as job posts on your schedule.',
  intendedRoles: ['Customer'],
  prerequisites: [
    { text: 'A signed-in OxSteed account.', href: '/login' },
  ],
  processMap: {
    nodes: [
      { id: 'open', label: 'Open Planned Needs', type: 'terminal' },
      { id: 'add', label: 'Choose + Add Planned Need', type: 'step' },
      { id: 'fill', label: 'Set category, details, and schedule', type: 'step' },
      { id: 'auto', label: 'Turn on Auto-Publishing', type: 'step' },
      { id: 'manage', label: 'Complete or cancel needs as life changes', type: 'step' },
      { id: 'done', label: 'Needs publish on schedule', type: 'terminal' },
    ],
    edges: [
      { from: 'open', to: 'add' },
      { from: 'add', to: 'fill' },
      { from: 'fill', to: 'auto' },
      { from: 'auto', to: 'manage' },
      { from: 'manage', to: 'done' },
    ],
  },
  processMapText:
    '1. Open /planned-needs, titled "Planned Needs". 2. Choose "+ Add Planned Need". 3. Fill in the need: category (for example "Car Care" or "Personal Care"), details, and recurrence. ' +
    '4. Turn on "Auto-Publishing" so the need posts as a job on schedule. 5. Use "Complete" to finish a need, or "Cancel Planned Need" to stop it. ' +
    '6. "Browse helpers" connects you with preferred helpers for the work.',
  steps: [
    {
      id: 'other-planned-needs-s1',
      title: 'Open Planned Needs',
      body: 'Open /planned-needs while signed in. The page is titled "Planned Needs". Existing needs show with their categories, schedules, and auto-publish status. The "+ Add Planned Need" button starts a new one.',
      expectedResult: 'Your current planned needs are listed.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/planned-needs',
          state: 'Planned Needs with existing needs, signed in, light mode',
          alt: 'Planned Needs page with the needs list',
          caption: 'Planned Needs, desktop view.',
          annotations: [
            { n: 1, label: 'Planned Needs title', locator: 'h1' },
            { n: 2, label: '+ Add Planned Need button', locator: 'button' },
            { n: 3, label: 'Needs list', locator: 'main' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/planned-needs',
          state: 'Planned Needs, signed in, light mode',
          alt: 'Planned Needs on a phone screen',
          caption: 'Planned Needs, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-planned-needs-s2',
      title: 'Add a planned need',
      body: 'Choose "+ Add Planned Need" to open the "Add Planned Need" form. Set the "Category" (for example "Car Care", "Personal Care", or "Other"), describe the need, and choose how often it recurs. Choose "Add Need" to save.',
      expectedResult: 'The new need appears in your list.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/planned-needs',
          state: 'Add Planned Need form, light mode',
          alt: 'Add Planned Need form with category and schedule',
          caption: 'Adding a need, desktop view.',
          annotations: [
            { n: 1, label: 'Category selector', locator: 'select' },
            { n: 2, label: 'Recurrence', locator: 'select' },
            { n: 3, label: 'Add Need button', locator: 'button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/planned-needs',
          state: 'Add Planned Need form, light mode',
          alt: 'Add form on a phone screen',
          caption: 'Adding a need, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-planned-needs-s3',
      title: 'Turn on auto-publishing',
      body: 'Open the need and turn on "Auto-Publishing". With it on, the need automatically publishes as a job post on your schedule, so recurring work posts itself. The page shows the next auto-publish date and count.',
      expectedResult: 'Auto-publishing is on and the next publish date is shown.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/planned-needs',
          state: 'Auto-publishing enabled on a need, light mode',
          alt: 'Auto-Publishing toggle enabled',
          caption: 'Auto-publishing, desktop view.',
          annotations: [
            { n: 1, label: 'Auto-Publishing toggle', locator: 'button[role="switch"]' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/planned-needs',
          state: 'Auto-publishing enabled, light mode',
          alt: 'Auto-publishing on a phone screen',
          caption: 'Auto-publishing, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-planned-needs-s4',
      title: 'Complete or cancel a need',
      body: 'Use "Complete" to finish a need you no longer need to repeat, or "Cancel Planned Need" to stop it entirely ("Cancel Planned Need" asks for confirmation). Use "Browse helpers" to find preferred helpers for recurring work.',
      expectedResult: 'The need is completed or cancelled and stops publishing.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/planned-needs',
          state: 'Need actions visible, light mode',
          alt: 'Complete and cancel actions on a need',
          caption: 'Managing a need, desktop view.',
          annotations: [
            { n: 1, label: 'Complete button', locator: 'button' },
            { n: 2, label: 'Browse helpers link', locator: 'a' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/planned-needs',
          state: 'Need actions, light mode',
          alt: 'Need actions on a phone screen',
          caption: 'Managing a need, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'Your need is listed with auto-publishing on and a next publish date, and it posts as a job on schedule.',
  recovery: [
    {
      problem: 'A need published when you did not want it to.',
      solution: 'Open the need and turn off "Auto-Publishing", or use "Cancel Planned Need" to stop it entirely.',
    },
    {
      problem: 'Auto-publishing is on but nothing posted.',
      solution: 'Check the need schedule and next publish date. If the date passed with no post, contact support at /support.',
    },
  ],
  supportContact: 'Planned needs issues: contact support from the in-app support page at /support.',
  relatedGuides: ['other-car-care'],
  siteLinks: [
    { label: 'Planned Needs', href: '/planned-needs' },
  ],
  sources: [
    { type: 'route', ref: '/planned-needs' },
    { type: 'screen', ref: 'client/src/pages/PlannedNeedsPage.jsx' },
    { type: 'handler', ref: 'GET /api/planned-needs' },
    { type: 'handler', ref: 'POST /api/planned-needs' },
    { type: 'handler', ref: 'PUT /api/planned-needs/:id' },
  ],
};

export default guide;
