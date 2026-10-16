/**
 * samples.js - sample SOP content used until the coordinator provides the
 * real content contract file at client/src/sop/guides/index.js.
 *
 * Screenshot entries follow the screenshot sidecar contract: they describe
 * WHAT to capture (screen + state + locator-based annotations) and carry no
 * src or coordinates. The capture worker publishes client/src/sop/screenshots.json
 * keyed by "<guideId>/<stepId>/<viewport>"; the renderer merges the two.
 */

export const SAMPLE_AREAS = [
  { slug: 'account', title: 'Account', description: 'Sign in, profiles, settings, and security.' },
  { slug: 'hiring', title: 'Hiring', description: 'Post jobs, review bids, and hire helpers.' },
  { slug: 'helper-work', title: 'Helper work', description: 'Find work, submit bids, and complete jobs.' },
  { slug: 'business', title: 'Business', description: 'Onboard a business and manage teams.' },
  { slug: 'restaurants', title: 'Restaurants', description: 'Menus, food orders, and restaurant wallets.' },
  { slug: 'financial', title: 'Financial', description: 'Wallets, OxSteed Credit, payouts, and taxes.' },
  { slug: 'logistics', title: 'Logistics', description: 'Campaigns, procurement, and shipments.' },
  { slug: 'media', title: 'Media', description: 'Guides, videos, and creator tools.' },
  { slug: 'direct', title: 'Direct', description: 'Direct catalogs, quotes, and bookings.' },
  { slug: 'delivery', title: 'Delivery', description: 'Package and food delivery tracking.' },
  { slug: 'calendar', title: 'Calendar', description: 'Availability, appointments, and scheduling.' },
  { slug: 'messages', title: 'Messages', description: 'Conversations, inbox, and notifications.' },
  { slug: 'consulting', title: 'Consulting', description: 'Consulting intake, sessions, and feedback.' },
  { slug: 'rentals', title: 'Rentals', description: 'Tool and equipment rentals.' },
];

export const SAMPLE_GUIDES = [
  {
    id: 'post-a-job',
    area: 'hiring',
    slug: 'post-a-job',
    title: 'Post a job',
    audiences: ['customer'],
    revision: 1,
    availability: 'supported',
    conditions: [],
    goal: 'Publish a job post so qualified helpers can find it and send you bids.',
    intendedRoles: ['Customer'],
    prerequisites: [
      { text: 'Sign in to your OxSteed account.', guideId: 'sign-in-to-oxsteed' },
      { text: 'Know the service you need, the job location, and your budget.' },
    ],
    processMap: {
      nodes: [
        { id: 'start', label: 'Open the Post a job page', type: 'terminal' },
        { id: 'describe', label: 'Describe the job', type: 'step' },
        { id: 'details', label: 'Set location, schedule, and budget', type: 'step' },
        { id: 'review', label: 'Details complete?', type: 'decision' },
        { id: 'fix', label: 'Complete the highlighted fields', type: 'blocked' },
        { id: 'publish', label: 'Publish the job', type: 'step' },
        { id: 'live', label: 'Job is live and bids arrive', type: 'terminal' },
      ],
      edges: [
        { from: 'start', to: 'describe' },
        { from: 'describe', to: 'details' },
        { from: 'details', to: 'review' },
        { from: 'review', to: 'publish', label: 'Yes' },
        { from: 'review', to: 'fix', label: 'No' },
        { from: 'fix', to: 'review' },
        { from: 'publish', to: 'live' },
      ],
    },
    processMapText:
      '1. Open the Post a job page. 2. Describe the job. 3. Set the location, schedule, and budget. ' +
      '4. Check whether every required detail is complete. If not, complete the highlighted fields and check again. ' +
      '5. Publish the job. 6. The job goes live and helpers can send bids.',
    steps: [
      {
        id: 'open-post-job',
        title: 'Open the Post a job page',
        body: 'From the home page, choose Post a job in the main navigation, or open /post-job directly. The page shows a hero panel titled "Post a job" with the job form below it.',
        expectedResult: 'The job posting form loads with the Title field at the top.',
        screenshots: [
          {
            viewport: 'desktop',
            screen: '/post-job',
            state: 'Hero panel with the job title field visible',
            alt: 'Post a job page hero with the title field visible',
            caption: 'The Post a job page, desktop view.',
            annotations: [
              { n: 1, label: 'Page title', locator: 'h1.pjw-page-title' },
              { n: 2, label: 'Job title field', locator: '.pjw-hero-copy input' },
            ],
          },
        ],
      },
      {
        id: 'describe-job',
        title: 'Describe the job',
        body: 'Enter a clear Title, choose a Category, and write a Description that states the work, the materials involved, and how you will judge the result. Attach photos when the job has visible damage or a specific layout.',
        expectedResult: 'Each required field shows a completed state and no validation errors.',
        screenshots: [
          {
            viewport: 'desktop',
            screen: '/post-job',
            state: 'Job description section with title, category, and description filled in',
            alt: 'Job description section with title, category, and description fields filled in',
            caption: 'A completed job description section, desktop view.',
            annotations: [
              { n: 1, label: 'Title', locator: 'input[name="title"]' },
              { n: 2, label: 'Category', locator: 'select[name="category"]' },
              { n: 3, label: 'Description', locator: 'textarea[name="description"]' },
            ],
          },
        ],
      },
      {
        id: 'set-details',
        title: 'Set location, schedule, and budget',
        body: 'Enter the job Location, pick your preferred Schedule, and set a Budget range. Use the budget helper text as a sanity check against similar jobs.',
        expectedResult: 'Location, schedule, and budget all show entered values.',
        screenshots: [
          {
            viewport: 'mobile',
            screen: '/post-job',
            state: 'Location, schedule, and budget fields on a phone screen',
            alt: 'Location, schedule, and budget fields on a phone screen',
            caption: 'Location, schedule, and budget fields, mobile view.',
            annotations: [
              { n: 1, label: 'Location', locator: 'input[name="location"]' },
              { n: 2, label: 'Schedule', locator: 'input[name="schedule"]' },
              { n: 3, label: 'Budget', locator: 'input[name="budget"]' },
            ],
          },
        ],
      },
      {
        id: 'publish-job',
        title: 'Review and publish',
        body: 'Review the summary panel. The Publish button stays disabled until every required field is complete. When it is enabled, choose Publish job.',
        expectedResult: 'A confirmation appears and the job is listed with status Open.',
        screenshots: [
          {
            viewport: 'desktop',
            screen: '/post-job',
            state: 'Review summary with the Publish job button enabled',
            alt: 'Review summary with the enabled Publish job button',
            caption: 'The review summary with Publish job enabled, desktop view.',
            annotations: [
              { n: 1, label: 'Publish job button', locator: 'button.pjw-publish' },
            ],
          },
        ],
      },
    ],
    confirmOutcome: 'Open Jobs and confirm your post appears with status Open. You also receive a confirmation message in Messages.',
    recovery: [
      {
        problem: 'The Publish button is disabled.',
        solution: 'Scroll up and complete every field marked with an asterisk. The summary panel lists the missing items.',
      },
      {
        problem: 'The job posted but no bids arrive.',
        solution: 'Add photos and a more specific description, then use Edit job to update the post. Clear pricing ranges attract more bids.',
      },
    ],
    supportContact: 'If your post does not appear within 10 minutes, contact OxSteed Support from the Help menu.',
    relatedGuides: ['sign-in-to-oxsteed'],
    siteLinks: [
      { label: 'Post a job', href: '/post-job' },
      { label: 'My jobs', href: '/jobs' },
      { label: 'Find a helper', href: '/helpers' },
    ],
    sources: [
      { type: 'route', ref: '/post-job' },
      { type: 'screen', ref: 'PostJobPage posting form' },
    ],
  },
  {
    id: 'sign-in-to-oxsteed',
    area: 'account',
    slug: 'sign-in',
    title: 'Sign in to your account',
    audiences: ['customer', 'helper', 'business'],
    revision: 1,
    availability: 'supported',
    conditions: [],
    goal: 'Sign in securely so you can book services, message helpers, and manage your account.',
    intendedRoles: ['Customer', 'Helper', 'Business owner'],
    prerequisites: [
      { text: 'An OxSteed account. New here? Create one first.', href: '/join' },
    ],
    processMap: {
      nodes: [
        { id: 'start', label: 'Open the sign in page', type: 'terminal' },
        { id: 'enter', label: 'Enter email and password', type: 'step' },
        { id: 'check', label: 'Details correct?', type: 'decision' },
        { id: 'reset', label: 'Use Forgot password to reset', type: 'blocked' },
        { id: 'signedin', label: 'Signed in to your dashboard', type: 'terminal' },
      ],
      edges: [
        { from: 'start', to: 'enter' },
        { from: 'enter', to: 'check' },
        { from: 'check', to: 'signedin', label: 'Yes' },
        { from: 'check', to: 'reset', label: 'No' },
        { from: 'reset', to: 'enter' },
      ],
    },
    processMapText:
      '1. Open the sign in page. 2. Enter your email and password. 3. If the details are correct you land on your dashboard. ' +
      'If not, use Forgot password to reset, then sign in again.',
    steps: [
      {
        id: 'open-sign-in',
        title: 'Open the sign in page',
        body: 'Choose Sign in in the top navigation, or open /login directly. The page shows the OxSteed logo, an Email field, and a Password field.',
        expectedResult: 'The sign in form is visible with empty Email and Password fields.',
        screenshots: [
          {
            viewport: 'desktop',
            screen: '/login',
            state: 'Sign in form with empty email and password fields',
            alt: 'Sign in page with email and password fields',
            caption: 'The sign in page, desktop view.',
            annotations: [
              { n: 1, label: 'Email field', locator: 'input[name="email"]' },
              { n: 2, label: 'Password field', locator: 'input[name="password"]' },
            ],
          },
        ],
      },
      {
        id: 'enter-credentials',
        title: 'Enter your email and password',
        body: 'Type the email address you registered with and your password. Passwords are case sensitive. Choose Sign in to continue.',
        expectedResult: 'The button shows a loading state, then you are redirected.',
        screenshots: [
          {
            viewport: 'mobile',
            screen: '/login',
            state: 'Sign in form filled in on a phone screen',
            alt: 'Sign in form filled in on a phone screen',
            caption: 'The sign in form, mobile view.',
            annotations: [
              { n: 1, label: 'Sign in button', locator: 'button[type="submit"]' },
            ],
          },
        ],
      },
      {
        id: 'verify-landing',
        title: 'Confirm you landed on your dashboard',
        body: 'After sign in, your dashboard loads with your name in the account menu. If you have two-factor authentication enabled, enter the code from your authenticator app when prompted.',
        expectedResult: 'Your dashboard is visible and the account menu shows your name.',
        screenshots: [
          {
            viewport: 'desktop',
            screen: '/dashboard',
            state: 'Dashboard after sign in with the account menu visible',
            alt: 'Dashboard after sign in with the account menu open',
            caption: 'A signed-in dashboard, desktop view.',
            annotations: [
              { n: 1, label: 'Account menu', locator: '.account-menu' },
            ],
          },
        ],
      },
    ],
    confirmOutcome: 'Your dashboard loads and the account menu shows your name or email.',
    recovery: [
      {
        problem: 'You see "Invalid email or password".',
        solution: 'Check for typos and caps lock, then try again. After several attempts, use Forgot password to reset.',
      },
      {
        problem: 'You never receive the password reset email.',
        solution: 'Check your spam folder and confirm you typed the registered email address. Wait 5 minutes before requesting again.',
      },
    ],
    supportContact: 'If you cannot access your account after a reset, contact OxSteed Support from the Help menu.',
    relatedGuides: ['post-a-job'],
    siteLinks: [
      { label: 'Sign in', href: '/login' },
      { label: 'Join OxSteed', href: '/join' },
    ],
    sources: [
      { type: 'route', ref: '/login' },
      { type: 'screen', ref: 'Login page form' },
    ],
  },
];

export const SAMPLE_HANDBOOKS = [
  {
    role: 'customer',
    title: 'Customer handbook',
    guideIds: ['sign-in-to-oxsteed', 'post-a-job', 'book-a-helper', 'pay-with-qr', 'track-a-delivery'],
  },
  {
    role: 'helper',
    title: 'Helper handbook',
    guideIds: ['sign-in-to-oxsteed', 'complete-your-profile', 'submit-a-bid', 'withdraw-earnings'],
  },
  {
    role: 'business',
    title: 'Business handbook',
    guideIds: ['sign-in-to-oxsteed', 'onboard-your-business', 'manage-team-roles', 'run-payroll'],
  },
  {
    role: 'restaurant',
    title: 'Restaurant handbook',
    guideIds: ['sign-in-to-oxsteed', 'set-up-your-menu', 'accept-food-orders', 'top-up-food-wallet'],
  },
  {
    role: 'logistics',
    title: 'Logistics handbook',
    guideIds: ['sign-in-to-oxsteed', 'join-a-campaign', 'track-a-shipment', 'request-a-pickup'],
  },
];
