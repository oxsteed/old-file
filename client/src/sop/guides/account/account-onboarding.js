/**
 * account-onboarding.js - SOP guide: Complete helper or business onboarding.
 * Screen sources: client/src/components/HelperOnboardingChecklist.jsx (helper),
 * client/src/components/businessHub/BusinessOnboarding.jsx, client/src/pages/BusinessLaunchStatusPage.jsx (business)
 */

const guide = {
  id: 'account-onboarding',
  area: 'account',
  slug: 'complete-onboarding',
  title: 'Complete helper or business onboarding',
  audiences: ['helper', 'business'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Finish onboarding so you appear in search results and can bid, list services, or publish your business.',
  intendedRoles: ['Helper', 'Business owner'],
  prerequisites: [
    { text: 'Be signed in with the Helper or Business Owner mode active.', guideId: 'account-signin', href: '/login' },
    { text: 'Helpers: complete identity verification first.', guideId: 'account-identity-verification', href: '/verify-identity' },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open your dashboard', type: 'terminal' },
      { id: 'checklist', label: 'Work through the onboarding checklist', type: 'step' },
      { id: 'terms', label: 'Review and accept terms', type: 'step' },
      { id: 'profile', label: 'Complete profile and contact details', type: 'step' },
      { id: 'identity', label: 'Verify identity and background', type: 'step' },
      { id: 'review', label: 'All steps done?', type: 'decision' },
      { id: 'finish', label: 'Finish onboarding (or publish the business)', type: 'step' },
      { id: 'done', label: 'Onboarding complete; listing is live', type: 'terminal' },
      { id: 'fix', label: 'Complete the highlighted step', type: 'blocked' },
    ],
    edges: [
      { from: 'start', to: 'checklist' },
      { from: 'checklist', to: 'terms' },
      { from: 'terms', to: 'profile' },
      { from: 'profile', to: 'identity' },
      { from: 'identity', to: 'review' },
      { from: 'review', to: 'finish', label: 'Yes' },
      { from: 'review', to: 'fix', label: 'No' },
      { from: 'fix', to: 'review' },
      { from: 'finish', to: 'done' },
    ],
  },
  processMapText:
    '1. Open your dashboard to see the onboarding checklist. 2. Review and accept the terms. ' +
    '3. Fill in your profile and contact details (phone, city, state, ZIP code, bio) and save. ' +
    '4. Verify your identity and consent to the background check. ' +
    '5. When every step shows "Done", choose "Finish onboarding" (helpers) or "Publish" (businesses). ' +
    '6. Your listing goes live and you can bid on jobs or accept bookings. Businesses also track launch progress on the launch-status page.',
  steps: [
    {
      id: 'account-onboarding-s1',
      title: 'Find the onboarding checklist on your dashboard',
      body: 'Open your dashboard (/dashboard in Helper mode, /business-hub in Business Owner mode). Helpers see the card "Finish setting up your helper account" with the intro "Complete these steps to appear in search and accept jobs." Each step shows "To do" until it is complete.',
      expectedResult: 'The checklist lists the remaining onboarding steps with their current state.',
      screenshots: [
        {
          id: 'account-onboarding-s1-desktop',
          viewport: 'desktop',
          screen: '/dashboard',
          state: 'Helper dashboard with onboarding checklist visible, signed in, light mode',
          alt: 'Finish setting up your helper account checklist on the dashboard',
          caption: 'The helper onboarding checklist, desktop view.',
          annotations: [
            { n: 1, label: 'Finish setting up your helper account', locator: 'h2' },
            { n: 2, label: 'Checklist steps with To do states', locator: 'ul' },
          ],
        },
        {
          id: 'account-onboarding-s1-mobile',
          viewport: 'mobile',
          screen: '/dashboard',
          state: 'Helper dashboard with onboarding checklist visible, signed in, light mode',
          alt: 'Onboarding checklist on a phone screen',
          caption: 'The checklist, mobile view.',
          annotations: [
            { n: 1, label: 'Onboarding checklist', locator: 'ul' },
          ],
        },
      ],
    },
    {
      id: 'account-onboarding-s2',
      title: 'Review and accept the terms',
      body: 'If the "Terms accepted" row is not done, open "Review and accept terms", read the terms, and accept them. This is also where helpers who missed the signup checkbox accept terms later.',
      expectedResult: 'The terms row changes to "Done".',
      screenshots: [
        {
          id: 'account-onboarding-s2-desktop',
          viewport: 'desktop',
          screen: '/dashboard',
          state: 'Terms acceptance step open, signed in, light mode',
          alt: 'Review and accept terms step in the checklist',
          caption: 'The terms acceptance step.',
          annotations: [
            { n: 1, label: 'Review and accept terms', locator: 'button' },
          ],
        },
        {
          id: 'account-onboarding-s2-mobile',
          viewport: 'mobile',
          screen: '/dashboard',
          state: 'Terms acceptance step open, signed in, light mode',
          alt: 'Terms step on a phone screen',
          caption: 'The terms step, mobile view.',
          annotations: [
            { n: 1, label: 'Review and accept terms', locator: 'button' },
          ],
        },
      ],
    },
    {
      id: 'account-onboarding-s3',
      title: 'Complete your profile and contact details',
      body: 'Open "Profile and contact details", fill in phone, city, state, ZIP code, and a short bio, then choose "Save profile". The identity step links to "Verify identity" ("Verify your identity to be listed."); complete it if it is still pending.',
      expectedResult: 'The profile and identity rows show "Done".',
      screenshots: [
        {
          id: 'account-onboarding-s3-desktop',
          viewport: 'desktop',
          screen: '/dashboard',
          state: 'Profile details step open, signed in, light mode',
          alt: 'Profile and contact details form with Save profile button',
          caption: 'The profile details step with the Save profile button.',
          annotations: [
            { n: 1, label: 'Contact fields', locator: 'input' },
            { n: 2, label: 'Save profile button', locator: 'button' },
          ],
        },
        {
          id: 'account-onboarding-s3-mobile',
          viewport: 'mobile',
          screen: '/dashboard',
          state: 'Profile details step open, signed in, light mode',
          alt: 'Profile fields on a phone screen',
          caption: 'The profile step, mobile view.',
          annotations: [
            { n: 1, label: 'Save profile button', locator: 'button' },
          ],
        },
      ],
    },
    {
      id: 'account-onboarding-s4',
      title: 'Finish onboarding and go live',
      body: 'When every row shows "Done", choose "Finish onboarding" at the bottom of the checklist. Business owners instead complete the business onboarding checks and choose "Publish" to take the business live; they can follow launch progress on /business-launch-status. Helpers who want payouts should also file a W-9 under Settings, Tax documents.',
      expectedResult: 'The checklist disappears and you can bid on jobs, accept bookings, or take bookings as a business.',
      screenshots: [
        {
          id: 'account-onboarding-s4-desktop',
          viewport: 'desktop',
          screen: '/dashboard',
          state: 'All onboarding steps done, signed in, light mode',
          alt: 'Completed checklist with the Finish onboarding button',
          caption: 'All steps done; choose Finish onboarding.',
          annotations: [
            { n: 1, label: 'All steps Done', locator: 'ul' },
            { n: 2, label: 'Finish onboarding button', locator: 'button' },
          ],
        },
        {
          id: 'account-onboarding-s4-mobile',
          viewport: 'mobile',
          screen: '/dashboard',
          state: 'All onboarding steps done, signed in, light mode',
          alt: 'Completed checklist on a phone screen',
          caption: 'The finish step, mobile view.',
          annotations: [
            { n: 1, label: 'Finish onboarding button', locator: 'button' },
          ],
        },
      ],
    },
  ],
  confirmOutcome: 'The checklist no longer appears, and you show up in the helper directory or your business is listed. Listing, bidding, and starting work are enforced on the server, so a completed onboarding is required.',
  recovery: [
    {
      problem: 'A step stays on "To do" after you completed it.',
      solution: 'Reload the page; progress is re-derived from your records. If identity shows "Your identity check is being reviewed.", wait for the review to finish.',
    },
    {
      problem: 'You cannot bid or accept bookings yet.',
      solution: 'Check that onboarding shows complete and that you are in Helper mode. Helpers must complete onboarding; customers can browse and post without it.',
    },
    {
      problem: 'The business cannot publish.',
      solution: 'Review the remaining checklist items on /business/:businessId/onboarding. Every incomplete check blocks publishing.',
    },
  ],
  supportContact: 'If a step will not complete despite your records being correct, contact support from the Help menu or visit /support.',
  relatedGuides: ['account-join', 'account-signin', 'account-identity-verification', 'account-settings'],
  siteLinks: [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Verify identity', href: '/verify-identity' },
    { label: 'Business launch status', href: '/business-launch-status' },
  ],
  sources: [
    { type: 'screen', ref: 'client/src/components/HelperOnboardingChecklist.jsx' },
    { type: 'screen', ref: 'client/src/components/businessHub/BusinessOnboarding.jsx' },
    { type: 'screen', ref: 'client/src/pages/BusinessLaunchStatusPage.jsx' },
    { type: 'handler', ref: 'POST /api/helper-registration/start, /verify-otp, /complete, /api/helper-registration/finalize' },
    { type: 'permission', ref: 'Authenticated. Listing, bidding and starting work enforce onboarding server-side.' },
  ],
};

export default guide;
