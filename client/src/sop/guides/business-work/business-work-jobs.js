/**
 * business-work-jobs.js - Guide: post and manage jobs as a business.
 *
 * Verified against: client/src/pages/PostJobPage.jsx (multi-step wizard,
 * Post Job button), client/src/components/careers/HiringPipelineBoard.jsx
 * (Hiring tab: Post a role, pipeline stages), client/src/pages/BusinessHubPage.jsx
 * (hiring tab), routes /post-job and /business-hub in App.jsx.
 */

export default {
  id: 'business-work-jobs',
  area: 'business-work',
  slug: 'post-and-manage-jobs-as-business',
  title: 'Post and manage jobs as a business',
  audiences: ['business'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Post gig jobs for helpers and run hiring pipelines for team roles, all from your business.',
  intendedRoles: ['Business owner', 'Business manager'],
  prerequisites: [
    { text: 'Sign in and open your business in the business hub.', guideId: 'business-work-select', href: '/business-hub' },
    { text: 'Know the work, the location, and the budget for the job you want to post.', href: '/post-job' },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Choose what to hire for', type: 'terminal' },
      { id: 'gig', label: 'Post a gig job at post-job', type: 'step' },
      { id: 'role', label: 'Post a team role in the Hiring tab', type: 'step' },
      { id: 'manage', label: 'Manage applicants and bids', type: 'step' },
      { id: 'done', label: 'Hires tracked', type: 'terminal' },
    ],
    edges: [
      { from: 'start', to: 'gig' },
      { from: 'start', to: 'role' },
      { from: 'gig', to: 'manage' },
      { from: 'role', to: 'manage' },
      { from: 'manage', to: 'done' },
    ],
  },
  processMapText:
    '1. Decide whether you need gig work or a team role. 2. For gig work, post a job at /post-job using the standard wizard. ' +
    '3. For team roles, post a role in the Hiring tab of the business hub. ' +
    '4. Manage bids on gig jobs and move role applicants through the hiring pipeline. 5. Your hires are tracked.',
  steps: [
    {
      id: 'business-work-jobs-s1',
      title: 'Post a gig job',
      body: 'Open /post-job. The wizard steps you through the job: describe the work ("Tell OxSteed what needs to get done."), define who is qualified to bid ("Define who is qualified to bid."), then review ("Check the post before it goes live."). Choose Post Job to publish.',
      expectedResult: 'The job goes live and helpers can send bids.',
      screenshots: [
        {
          id: 'business-work-jobs-s1-desktop',
          viewport: 'desktop',
          screen: '/post-job',
          state: 'Post a job wizard, details step with synthetic data, light mode',
          alt: 'Post a job wizard details step with title, category, and description',
          caption: 'Posting a gig job, desktop view.',
          annotations: [
            { n: 1, label: 'Job details step', locator: '.pjw-step' },
            { n: 2, label: 'Post Job button', locator: 'button' },
          ],
        },
        {
          id: 'business-work-jobs-s1-mobile',
          viewport: 'mobile',
          screen: '/post-job',
          state: 'Post a job wizard, review step with synthetic data, light mode',
          alt: 'Review step of the job wizard on a phone screen',
          caption: 'Posting a gig job, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'business-work-jobs-s2',
      title: 'Manage gig jobs and bids',
      body: 'Manage posted jobs from My Jobs (/my-jobs): edit, cancel, assign, and mark jobs complete. Compare bids on each job and accept or decline them.',
      expectedResult: 'Your jobs show current statuses and winning bids.',
      screenshots: [
        {
          id: 'business-work-jobs-s2-desktop',
          viewport: 'desktop',
          screen: '/my-jobs',
          state: 'My Jobs page with synthetic business jobs, light mode',
          alt: 'My Jobs page with job cards and bid counts',
          caption: 'Managing posted jobs, desktop view.',
          annotations: [
            { n: 1, label: 'Job card with bids', locator: '.job-card' },
          ],
        },
        {
          id: 'business-work-jobs-s2-mobile',
          viewport: 'mobile',
          screen: '/my-jobs',
          state: 'My Jobs page with synthetic business jobs, light mode',
          alt: 'My Jobs on a phone screen',
          caption: 'Managing posted jobs, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'business-work-jobs-s3',
      title: 'Post a team role in the Hiring tab',
      body: 'Open /business-hub?tab=hiring for your business. The Hiring pipeline board lets you post a role (choose Post a role) with title, department, employment type, location, pay, and description.',
      expectedResult: 'The role posts and appears on the pipeline board.',
      screenshots: [
        {
          id: 'business-work-jobs-s3-desktop',
          viewport: 'desktop',
          screen: '/business-hub?tab=hiring',
          state: 'Hiring tab with synthetic roles, light mode',
          alt: 'Hiring pipeline board with roles and the Post a role button',
          caption: 'The Hiring tab, desktop view.',
          annotations: [
            { n: 1, label: 'Post a role button', locator: 'button' },
            { n: 2, label: 'Role row with applicant count', locator: '.ox-careers-row' },
          ],
        },
        {
          id: 'business-work-jobs-s3-mobile',
          viewport: 'mobile',
          screen: '/business-hub?tab=hiring',
          state: 'Hiring tab with synthetic roles, light mode',
          alt: 'Hiring tab on a phone screen',
          caption: 'The Hiring tab, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'business-work-jobs-s4',
      title: 'Move applicants through the pipeline',
      body: 'Choose a role to open its pipeline: stages run received, screening, interview, assessment, offer, and hired. Move applicants forward with the stage buttons, book interviews, send offers, and reject those who do not fit.',
      expectedResult: 'Applicants sit in the correct stage and offers go out.',
      screenshots: [
        {
          id: 'business-work-jobs-s4-desktop',
          viewport: 'desktop',
          screen: '/business-hub?tab=hiring',
          state: 'Hiring pipeline for a synthetic role, light mode',
          alt: 'Pipeline columns with applicant cards and stage action buttons',
          caption: 'Working the hiring pipeline, desktop view.',
          annotations: [
            { n: 1, label: 'Pipeline stages', locator: '.ox-careers-columns' },
            { n: 2, label: 'Stage action buttons', locator: '.ox-careers-btn' },
          ],
        },
        {
          id: 'business-work-jobs-s4-mobile',
          viewport: 'mobile',
          screen: '/business-hub?tab=hiring',
          state: 'Hiring pipeline for a synthetic role, light mode',
          alt: 'Pipeline on a phone screen',
          caption: 'Working the hiring pipeline, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'Gig jobs show bids and statuses in My Jobs; team roles show applicants moving through pipeline stages.',
  recovery: [
    {
      problem: 'The job posted but gets no bids.',
      solution: 'Add photos and a more specific description, then edit the post. Clear pricing ranges attract more bids.',
    },
    {
      problem: 'You cannot see the Hiring tab.',
      solution: 'The Hiring tab needs owner or manager capability for the business. Ask the business owner to grant you access.',
    },
  ],
  supportContact: 'If jobs fail to publish, contact OxSteed Support from the /support page.',
  relatedGuides: ['business-work-team-access', 'business-work-services'],
  siteLinks: [
    { label: 'Post a job', href: '/post-job' },
    { label: 'My jobs', href: '/my-jobs' },
    { label: 'Hiring tab', href: '/business-hub?tab=hiring' },
  ],
  sources: [
    { type: 'route', ref: '/post-job' },
    { type: 'route', ref: '/business-hub?tab=hiring' },
    { type: 'screen', ref: 'client/src/pages/PostJobPage.jsx' },
    { type: 'screen', ref: 'client/src/components/careers/HiringPipelineBoard.jsx' },
    { type: 'handler', ref: 'POST /api/jobs' },
  ],
};
