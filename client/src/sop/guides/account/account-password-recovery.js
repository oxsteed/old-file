/**
 * account-password-recovery.js - SOP guide: Recover a forgotten password.
 * Screen sources: client/src/pages/ForgotPassword.jsx, client/src/pages/ResetPassword.jsx
 */

const guide = {
  id: 'account-password-recovery',
  area: 'account',
  slug: 'recover-password',
  title: 'Recover a forgotten password',
  audiences: ['customer', 'helper', 'business', 'restaurant', 'logistics'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Reset your password with an email link when you cannot sign in.',
  intendedRoles: ['Customer', 'Helper', 'Business owner', 'Restaurant', 'Logistics'],
  prerequisites: [
    { text: 'Access to the email inbox of your OxSteed account.', href: null },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open the forgot-password page', type: 'terminal' },
      { id: 'enter', label: 'Enter your account email', type: 'step' },
      { id: 'mail', label: 'Open the reset email', type: 'step' },
      { id: 'check', label: 'Link still valid?', type: 'decision' },
      { id: 'newpw', label: 'Set a new password', type: 'step' },
      { id: 'done', label: 'Password reset; sign in again', type: 'terminal' },
      { id: 'resend', label: 'Request a new link', type: 'blocked' },
    ],
    edges: [
      { from: 'start', to: 'enter' },
      { from: 'enter', to: 'mail' },
      { from: 'mail', to: 'check' },
      { from: 'check', to: 'newpw', label: 'Valid' },
      { from: 'check', to: 'resend', label: 'Expired or invalid' },
      { from: 'resend', to: 'mail' },
      { from: 'newpw', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the forgot-password page from the sign-in screen. 2. Enter the email address of your account and choose "Send Reset Link". ' +
    '3. Open the reset email and choose the link. 4. If the link is expired or invalid, request a new one. ' +
    '5. Enter a new password twice on the "Set New Password" page. 6. Sign in with the new password.',
  steps: [
    {
      id: 'account-password-recovery-s1',
      title: 'Open the password reset page',
      body: 'From the sign-in page, choose "Forgot password?", or open /forgot-password directly. The page heading is "Reset your password" with the subtitle "Enter your email and we\'ll send you a link to reset your password."',
      expectedResult: 'The reset page shows a single Email address field and a "Send Reset Link" button.',
      screenshots: [
        {
          id: 'account-password-recovery-s1-desktop',
          viewport: 'desktop',
          screen: '/forgot-password',
          state: 'Blank forgot-password form, guest, light mode',
          alt: 'Reset your password page with an email field and Send Reset Link button',
          caption: 'The password reset page, desktop view.',
          annotations: [
            { n: 1, label: 'Email address field', locator: 'input[name="email"]' },
            { n: 2, label: 'Send Reset Link button', locator: 'button[type="submit"]' },
          ],
        },
        {
          id: 'account-password-recovery-s1-mobile',
          viewport: 'mobile',
          screen: '/forgot-password',
          state: 'Blank forgot-password form, guest, light mode',
          alt: 'Reset your password page on a phone screen',
          caption: 'The password reset page, mobile view.',
          annotations: [
            { n: 1, label: 'Send Reset Link button', locator: 'button[type="submit"]' },
          ],
        },
      ],
    },
    {
      id: 'account-password-recovery-s2',
      title: 'Request the reset link',
      body: 'Type your account email address (placeholder "you@example.com") and choose "Send Reset Link". A confirmation tells you the link was sent. If you never get it, check your spam folder, then come back and choose "Try again".',
      expectedResult: 'A confirmation appears that the reset link was sent to your email.',
      screenshots: [
        {
          id: 'account-password-recovery-s2-desktop',
          viewport: 'desktop',
          screen: '/forgot-password',
          state: 'Reset link sent confirmation, guest, light mode',
          alt: 'Confirmation that the reset link was sent',
          caption: 'The sent confirmation after requesting the link.',
          annotations: [
            { n: 1, label: 'Sent confirmation', locator: '.confirmation' },
            { n: 2, label: 'Back to sign in link', locator: 'a[href="/login"]' },
          ],
        },
        {
          id: 'account-password-recovery-s2-mobile',
          viewport: 'mobile',
          screen: '/forgot-password',
          state: 'Reset link sent confirmation, guest, light mode',
          alt: 'Reset link sent confirmation on a phone screen',
          caption: 'The sent confirmation, mobile view.',
          annotations: [
            { n: 1, label: 'Sent confirmation', locator: '.confirmation' },
          ],
        },
      ],
    },
    {
      id: 'account-password-recovery-s3',
      title: 'Set a new password from the email link',
      body: 'Open the email and choose the reset link, which opens /reset-password/:token. The page heading is "Set New Password". Type your new password in the New password field and repeat it in the Confirm password field, then choose "Reset Password". The new password must meet the minimum length shown.',
      expectedResult: 'A success message appears and a "Go to Sign In now" option is shown.',
      screenshots: [
        {
          id: 'account-password-recovery-s3-desktop',
          viewport: 'desktop',
          screen: '/reset-password/:token',
          state: 'Set New Password form, guest, light mode',
          alt: 'Set New Password page with new and confirm password fields',
          caption: 'The new password form, desktop view.',
          annotations: [
            { n: 1, label: 'New password field', locator: 'input[name="newPassword"]' },
            { n: 2, label: 'Confirm password field', locator: 'input[name="confirmPassword"]' },
            { n: 3, label: 'Reset Password button', locator: 'button[type="submit"]' },
          ],
        },
        {
          id: 'account-password-recovery-s3-mobile',
          viewport: 'mobile',
          screen: '/reset-password/:token',
          state: 'Set New Password form, guest, light mode',
          alt: 'New password fields on a phone screen',
          caption: 'The new password form, mobile view.',
          annotations: [
            { n: 1, label: 'Reset Password button', locator: 'button[type="submit"]' },
          ],
        },
      ],
    },
  ],
  confirmOutcome: 'The success screen appears; sign in at /login with your new password. If the link shows as invalid, request a fresh link.',
  recovery: [
    {
      problem: 'The reset link shows as invalid or expired.',
      solution: 'Reset links expire for security. Request a new one from /forgot-password and use it right away.',
    },
    {
      problem: 'No reset email arrives.',
      solution: 'Check the spam folder and confirm you typed the exact email registered on the account. Wait a few minutes before requesting again.',
    },
    {
      problem: 'The new password is rejected.',
      solution: 'Both fields must match and meet the minimum length. Avoid reusing your most recent passwords.',
    },
  ],
  supportContact: 'If you no longer have access to the registered email, contact support from the Help menu or visit /support.',
  relatedGuides: ['account-signin', 'account-join', 'account-settings'],
  siteLinks: [
    { label: 'Forgot password', href: '/forgot-password' },
    { label: 'Sign in', href: '/login' },
  ],
  sources: [
    { type: 'route', ref: '/forgot-password' },
    { type: 'route', ref: '/reset-password/:token' },
    { type: 'screen', ref: 'client/src/pages/ForgotPassword.jsx' },
    { type: 'screen', ref: 'client/src/pages/ResetPassword.jsx' },
    { type: 'handler', ref: 'POST /api/auth/forgot-password, POST /api/auth/reset-password' },
  ],
};

export default guide;
