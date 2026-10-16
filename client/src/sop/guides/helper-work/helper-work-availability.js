/**
 * helper-work-availability.js - Guide: set your availability.
 *
 * Verified against: client/src/pages/HelperDashboard.jsx (Availability tab,
 * Go Online/Go Offline, Go Live toggles, HelperAvailabilityEditor),
 * client/src/pages/ConsultantAvailabilityPage.jsx (weekly slots, blocked dates).
 */

export default {
  id: 'helper-work-availability',
  area: 'helper-work',
  slug: 'set-availability',
  title: 'Set your availability',
  audiences: ['helper'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Control when customers can find you, book you, and reach you for live chat.',
  intendedRoles: ['Helper'],
  prerequisites: [
    { text: 'Sign in and switch to helper mode.', href: '/login' },
    { text: 'Complete your helper profile first.', guideId: 'helper-work-profile', href: '/dashboard?tab=editprofile' },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open the Availability tab', type: 'terminal' },
      { id: 'listing', label: 'Choose Go Online or Go Offline', type: 'step' },
      { id: 'live', label: 'Choose Go Live or Go Offline for chat', type: 'step' },
      { id: 'schedule', label: 'Edit your weekly schedule', type: 'step' },
      { id: 'consult', label: 'Consultants: fine-tune at consultant-availability', type: 'step' },
      { id: 'done', label: 'Customers see your status', type: 'terminal' },
    ],
    edges: [
      { from: 'start', to: 'listing' },
      { from: 'listing', to: 'live' },
      { from: 'live', to: 'schedule' },
      { from: 'schedule', to: 'consult' },
      { from: 'consult', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the Availability tab on your dashboard. 2. Choose Go Online to appear in the helper directory, or Go Offline to hide your listing. ' +
    '3. Choose Go Live to accept live chat requests, or Go Offline for chat when you are busy. ' +
    '4. Edit your weekly schedule so customers know when you work. ' +
    '5. Consultants can fine-tune weekly slots and blocked dates at /consultant-availability. ' +
    '6. Customers now see your listing status, live status, and hours.',
  steps: [
    {
      id: 'helper-work-availability-s1',
      title: 'Open the Availability tab',
      body: 'Open your helper dashboard (/dashboard or /helper-dashboard) and choose the Availability tab. The card explains how customers can find and reach you and shows two status rows: directory listing and live chat.',
      expectedResult: 'Your current directory and live statuses are shown with toggle buttons.',
      screenshots: [
        {
          id: 'helper-work-availability-s1-desktop',
          viewport: 'desktop',
          screen: '/dashboard?tab=availability',
          state: 'Availability tab, helper offline in directory, light mode',
          alt: 'Availability card showing directory listing status and live chat status rows',
          caption: 'The Availability tab, desktop view.',
          annotations: [
            { n: 1, label: 'Directory listing row', locator: '.helper-availability-row' },
            { n: 2, label: 'Live chat status row', locator: '.helper-availability-row' },
          ],
        },
        {
          id: 'helper-work-availability-s1-mobile',
          viewport: 'mobile',
          screen: '/dashboard?tab=availability',
          state: 'Availability tab, helper offline in directory, light mode',
          alt: 'Availability card on a phone screen',
          caption: 'The Availability tab, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'helper-work-availability-s2',
      title: 'Set your directory listing status',
      body: 'In the directory listing row, choose Go Online to appear in the helper directory, or Go Offline to hide your listing while keeping your account. The status text changes to Online or Offline immediately.',
      expectedResult: 'The row shows Online (visible in directory) or Offline (hidden).',
      screenshots: [
        {
          id: 'helper-work-availability-s2-desktop',
          viewport: 'desktop',
          screen: '/dashboard?tab=availability',
          state: 'Availability tab, helper online in directory, light mode',
          alt: 'Directory listing row showing Online status with a Go Offline button',
          caption: 'Going online in the directory, desktop view.',
          annotations: [
            { n: 1, label: 'Go Offline button', locator: '.helper-availability-row__button' },
          ],
        },
        {
          id: 'helper-work-availability-s2-mobile',
          viewport: 'mobile',
          screen: '/dashboard?tab=availability',
          state: 'Availability tab, helper online in directory, light mode',
          alt: 'Directory listing row on a phone screen',
          caption: 'Going online in the directory, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'helper-work-availability-s3',
      title: 'Set your live chat status',
      body: 'In the live chat row, choose Go Live when you are available for live chat with customers, or Go Offline when you are busy. This controls chat requests only, not your directory listing.',
      expectedResult: 'The row shows Live Now or Not Live.',
      screenshots: [
        {
          id: 'helper-work-availability-s3-desktop',
          viewport: 'desktop',
          screen: '/dashboard?tab=availability',
          state: 'Availability tab, helper live for chat, light mode',
          alt: 'Live chat row showing Live Now status with a Go Offline button',
          caption: 'Going live for chat, desktop view.',
          annotations: [
            { n: 1, label: 'Go Live / Go Offline button', locator: '.helper-availability-row__button' },
          ],
        },
        {
          id: 'helper-work-availability-s3-mobile',
          viewport: 'mobile',
          screen: '/dashboard?tab=availability',
          state: 'Availability tab, helper live for chat, light mode',
          alt: 'Live chat row on a phone screen',
          caption: 'Going live for chat, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'helper-work-availability-s4',
      title: 'Edit your weekly schedule',
      body: 'Below the status rows, use the weekly schedule editor to set the days and hours you work. Save your changes so customers see accurate hours on your public profile.',
      expectedResult: 'Your weekly hours are saved and shown on your public profile.',
      screenshots: [
        {
          id: 'helper-work-availability-s4-desktop',
          viewport: 'desktop',
          screen: '/dashboard?tab=availability',
          state: 'Weekly schedule editor with synthetic hours, light mode',
          alt: 'Weekly schedule editor with days and hours set',
          caption: 'The weekly schedule editor, desktop view.',
          annotations: [
            { n: 1, label: 'Weekly hours editor', locator: '.helper-availability-card__schedule' },
          ],
        },
        {
          id: 'helper-work-availability-s4-mobile',
          viewport: 'mobile',
          screen: '/dashboard?tab=availability',
          state: 'Weekly schedule editor with synthetic hours, light mode',
          alt: 'Weekly schedule editor on a phone screen',
          caption: 'The weekly schedule editor, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'helper-work-availability-s5',
      title: 'Fine-tune consultant availability and time off',
      body: 'Consultants can open /consultant-availability for the Your Weekly Availability page. Set weekly slots, then use the Time off section to add blocked dates with reasons. Choose Save Availability when finished; a confirmation message appears.',
      expectedResult: '"Availability saved" appears and blocked dates are listed.',
      screenshots: [
        {
          id: 'helper-work-availability-s5-desktop',
          viewport: 'desktop',
          screen: '/consultant-availability',
          state: 'Consultant availability page with weekly slots and time off, light mode',
          alt: 'Consultant availability page with weekly slots, Save Availability, and Time off sections',
          caption: 'The consultant availability page, desktop view.',
          annotations: [
            { n: 1, label: 'Save Availability button', locator: 'button' },
            { n: 2, label: 'Time off section', locator: '.time-off' },
          ],
        },
        {
          id: 'helper-work-availability-s5-mobile',
          viewport: 'mobile',
          screen: '/consultant-availability',
          state: 'Consultant availability page with weekly slots, light mode',
          alt: 'Consultant availability page on a phone screen',
          caption: 'The consultant availability page, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'Your public profile shows the correct Online/Offline status and weekly hours; consultant bookings follow your blocked dates.',
  recovery: [
    {
      problem: 'You are online but get no inquiries.',
      solution: 'Check that your profile is complete and your weekly hours are set. Customers filter by availability, so empty hours can hide you from results.',
    },
    {
      problem: 'Blocked dates do not appear.',
      solution: 'Choose Save Availability after adding time off. Reload the page to confirm the dates persisted.',
    },
  ],
  supportContact: 'If availability will not save, contact OxSteed Support from the /support page.',
  relatedGuides: ['helper-work-profile', 'helper-work-assigned-jobs'],
  siteLinks: [
    { label: 'Availability tab', href: '/dashboard?tab=availability' },
    { label: 'Consultant availability', href: '/consultant-availability' },
  ],
  sources: [
    { type: 'route', ref: '/dashboard?tab=availability' },
    { type: 'route', ref: '/consultant-availability' },
    { type: 'screen', ref: 'client/src/pages/HelperDashboard.jsx (availability tab)' },
    { type: 'handler', ref: 'PUT /api/helpers/me/availability' },
  ],
};
