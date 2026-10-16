/**
 * account-identity-verification.js - SOP guide: Verify identity (Didit).
 * Screen source: client/src/pages/VerifyIdentityPage.tsx (routes: /verify-identity, /media/verify-identity)
 */

const guide = {
  id: 'account-identity-verification',
  area: 'account',
  slug: 'verify-identity',
  title: 'Verify identity (Didit)',
  audiences: ['customer', 'helper'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Verify your identity with a government ID and a selfie so bookings, payments, and approvals trust your account.',
  intendedRoles: ['Customer', 'Helper'],
  prerequisites: [
    { text: 'Be signed in to your OxSteed account.', guideId: 'account-signin', href: '/login' },
    { text: 'Have a government ID (passport, driver\'s license, or national ID) and a camera ready.', href: null },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open identity verification', type: 'terminal' },
      { id: 'read', label: 'Read the verification benefits', type: 'step' },
      { id: 'begin', label: 'Choose Start Verification', type: 'step' },
      { id: 'idtype', label: 'Select your ID type', type: 'step' },
      { id: 'doc', label: 'Capture your document', type: 'step' },
      { id: 'selfie', label: 'Take a selfie', type: 'step' },
      { id: 'wait', label: 'Waiting for Didit to confirm', type: 'step' },
      { id: 'check', label: 'Verified?', type: 'decision' },
      { id: 'done', label: 'Verified badge on your account', type: 'terminal' },
      { id: 'retry', label: 'Try again with a clearer photo', type: 'blocked' },
      { id: 'later', label: 'Verify later (skip)', type: 'blocked' },
    ],
    edges: [
      { from: 'start', to: 'read' },
      { from: 'read', to: 'begin' },
      { from: 'begin', to: 'idtype' },
      { from: 'idtype', to: 'doc' },
      { from: 'doc', to: 'selfie' },
      { from: 'selfie', to: 'wait' },
      { from: 'wait', to: 'check' },
      { from: 'check', to: 'done', label: 'Yes' },
      { from: 'check', to: 'retry', label: 'Failed' },
      { from: 'retry', to: 'idtype' },
      { from: 'read', to: 'later', label: 'Skip for now' },
      { from: 'later', to: 'start', label: 'Return later' },
    ],
  },
  processMapText:
    '1. Open /verify-identity and read the benefits: better marketplace trust, safer payments, and smoother approvals. ' +
    '2. Choose "Start Verification". 3. Select your ID type: passport, driver\'s license, or national ID. ' +
    '4. Capture your document with your camera, front and back if needed. 5. Take a selfie for the live face match. ' +
    '6. Wait while Didit confirms your identity. If verification fails, try again with a clearer photo and good lighting. ' +
    'You may also choose "Verify later" to skip and return another time.',
  steps: [
    {
      id: 'account-identity-verification-s1',
      title: 'Open the identity verification page',
      body: 'Open /verify-identity while signed in. The page shows a "Secure verification" badge and the heading "Verify once. Work, hire, and get paid with more confidence." The card lists the steps: "1. Account" (already done) and "2. Identity Verification".',
      expectedResult: 'The verification card loads with the Didit panel and a "Start Verification" button.',
      screenshots: [
        {
          id: 'account-identity-verification-s1-desktop',
          viewport: 'desktop',
          screen: '/verify-identity',
          state: 'Verification page loaded, signed in, light mode',
          alt: 'Verify your identity page with benefits and the start button',
          caption: 'The identity verification page, desktop view.',
          annotations: [
            { n: 1, label: 'Secure verification badge', locator: '.verify-identity-badge' },
            { n: 2, label: 'Benefits list', locator: '.verify-identity-benefits' },
            { n: 3, label: 'Start Verification button', locator: 'button' },
          ],
        },
        {
          id: 'account-identity-verification-s1-mobile',
          viewport: 'mobile',
          screen: '/verify-identity',
          state: 'Verification page loaded, signed in, light mode',
          alt: 'Verification page on a phone screen',
          caption: 'The verification page, mobile view.',
          annotations: [
            { n: 1, label: 'Start Verification button', locator: 'button' },
          ],
        },
      ],
    },
    {
      id: 'account-identity-verification-s2',
      title: 'Select your ID type and start',
      body: 'Choose "Start Verification". The panel shows "Select your ID type" with the hint "Passport, driver\'s license, or national ID". Pick the document you have.',
      expectedResult: 'The document capture step appears: "Capture your document".',
      screenshots: [
        {
          id: 'account-identity-verification-s2-desktop',
          viewport: 'desktop',
          screen: '/verify-identity',
          state: 'ID type selection, signed in, light mode',
          alt: 'ID type selection options in the verification panel',
          caption: 'Select the ID type you will verify with.',
          annotations: [
            { n: 1, label: 'Select your ID type', locator: '.didit-panel' },
            { n: 2, label: 'ID options', locator: '.didit-panel button' },
          ],
        },
        {
          id: 'account-identity-verification-s2-mobile',
          viewport: 'mobile',
          screen: '/verify-identity',
          state: 'ID type selection, signed in, light mode',
          alt: 'ID type options on a phone screen',
          caption: 'The ID type selection, mobile view.',
          annotations: [
            { n: 1, label: 'ID options', locator: '.didit-panel button' },
          ],
        },
      ],
    },
    {
      id: 'account-identity-verification-s3',
      title: 'Capture your document and take a selfie',
      body: 'Follow "Capture your document" with the hint "Use your camera - front and back if needed". Then complete "Take a selfie" with the hint "Live face match against your document photo". Use good lighting and hold the camera steady. When everything is captured, the panel shows "Verifying..." with the note "Waiting for Didit to confirm your identity. This usually takes a few seconds."',
      expectedResult: 'The panel shows "Verifying..." while Didit processes your identity.',
      screenshots: [
        {
          id: 'account-identity-verification-s3-desktop',
          viewport: 'desktop',
          screen: '/verify-identity',
          state: 'Document capture step, signed in, light mode',
          alt: 'Document capture step with camera instructions',
          caption: 'Capture your document, then take the selfie.',
          annotations: [
            { n: 1, label: 'Capture your document', locator: '.didit-panel' },
            { n: 2, label: 'Take a selfie', locator: '.didit-panel' },
          ],
        },
        {
          id: 'account-identity-verification-s3-mobile',
          viewport: 'mobile',
          screen: '/verify-identity',
          state: 'Document capture step, signed in, light mode',
          alt: 'Document capture on a phone screen',
          caption: 'The capture step, mobile view.',
          annotations: [
            { n: 1, label: 'Capture your document', locator: '.didit-panel' },
          ],
        },
      ],
    },
    {
      id: 'account-identity-verification-s4',
      title: 'Finish and confirm your verified status',
      body: 'When Didit approves, the panel confirms verification and shows "Continue to Dashboard". Choose it. If verification fails, the panel shows "Verification Failed" with guidance to try again; choose "Try with a different ID" only if your document type was the problem. Skipping is allowed: "Verify later" continues without verification and shows the "Continuing without verification" toast.',
      expectedResult: 'You return to your dashboard with identity verified on your account.',
      screenshots: [
        {
          id: 'account-identity-verification-s4-desktop',
          viewport: 'desktop',
          screen: '/verify-identity',
          state: 'Verification approved, signed in, light mode',
          alt: 'Verification approved panel with Continue to Dashboard',
          caption: 'The approved state with the Continue button.',
          annotations: [
            { n: 1, label: 'Continue to Dashboard button', locator: 'button' },
          ],
        },
        {
          id: 'account-identity-verification-s4-mobile',
          viewport: 'mobile',
          screen: '/verify-identity',
          state: 'Verification approved, signed in, light mode',
          alt: 'Verification approved on a phone screen',
          caption: 'The approved state, mobile view.',
          annotations: [
            { n: 1, label: 'Continue to Dashboard button', locator: 'button' },
          ],
        },
      ],
    },
  ],
  confirmOutcome: 'Your account shows the verified identity state; helpers also get listed faster and the onboarding checklist marks "Identity verified" as done.',
  recovery: [
    {
      problem: 'Verification fails repeatedly.',
      solution: 'Use a clear, uncreased photo of the ID in good lighting, remove glare, and make sure the selfie matches the document photo. Try again with better lighting.',
    },
    {
      problem: 'You see "Account Already Exists" (This identity is already linked to an existing OxSteed account).',
      solution: 'Each person can have only one account. Sign in to that account instead of creating a new one; run multiple businesses from the same dashboard.',
    },
    {
      problem: 'The verification cannot start ("Could not start verification").',
      solution: 'Reload the page and try again. If it still fails, the verification service may be unavailable; choose "Verify later" and return another time.',
    },
  ],
  supportContact: 'If your ID is valid but verification keeps failing, contact support from the Help menu or visit /support.',
  relatedGuides: ['account-onboarding', 'account-signin'],
  siteLinks: [
    { label: 'Verify your identity', href: '/verify-identity' },
  ],
  sources: [
    { type: 'route', ref: '/verify-identity' },
    { type: 'screen', ref: 'client/src/pages/VerifyIdentityPage.tsx' },
    { type: 'screen', ref: 'client/src/components/registration/DiditPanel.tsx' },
    { type: 'handler', ref: 'POST /api/didit/session, POST /api/didit/start, GET /api/didit/status, POST /api/didit/skip' },
  ],
};

export default guide;
