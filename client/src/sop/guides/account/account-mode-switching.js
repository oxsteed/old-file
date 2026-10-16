/**
 * account-mode-switching.js - SOP guide: Switch between modes.
 * Screen source: client/src/components/ModeSwitcher.jsx (in-app navigation; no dedicated route)
 */

const guide = {
  id: 'account-mode-switching',
  area: 'account',
  slug: 'switch-modes',
  title: 'Switch between customer, helper, business and other modes',
  audiences: ['customer', 'helper', 'business', 'restaurant', 'logistics'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Switch between the modes you belong to (Customer, Helper, Business Owner and granted team modes) without signing out.',
  intendedRoles: ['Customer', 'Helper', 'Business owner', 'Restaurant', 'Logistics'],
  prerequisites: [
    { text: 'Be signed in to your OxSteed account.', guideId: 'account-signin', href: '/login' },
    { text: 'Granted modes (business team roles) require a workspace invitation; they do not appear until you accept it.', href: '/business-hub' },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open the mode switcher', type: 'terminal' },
      { id: 'panel', label: 'Switch-to panel lists your modes', type: 'step' },
      { id: 'check', label: 'Target mode listed?', type: 'decision' },
      { id: 'pick', label: 'Pick the target mode', type: 'step' },
      { id: 'done', label: 'Dashboard reloads in the new mode', type: 'terminal' },
      { id: 'grant', label: 'Request or accept a workspace invitation', type: 'blocked' },
    ],
    edges: [
      { from: 'start', to: 'panel' },
      { from: 'panel', to: 'check' },
      { from: 'check', to: 'pick', label: 'Yes' },
      { from: 'check', to: 'grant', label: 'No' },
      { from: 'pick', to: 'done' },
      { from: 'grant', to: 'panel', label: 'After grant accepted' },
    ],
  },
  processMapText:
    '1. In the top navigation, choose the mode button that shows "Mode" and your current mode. ' +
    '2. The "Switch to" panel lists every mode available to you; your current mode carries a "Current" badge. ' +
    '3. Choose the mode you want. The button briefly shows "Switching..." and a "Switched to" toast confirms it. ' +
    '4. Your dashboard reloads for the new mode. If a mode is missing, it is granted by a workspace owner; accept the invitation first.',
  steps: [
    {
      id: 'account-mode-switching-s1',
      title: 'Open the mode switcher in the navigation',
      body: 'Find the mode switcher button in the top navigation: it shows the label "Mode" with your current mode name next to a colored dot. Choose it to open the switcher panel.',
      expectedResult: 'The "Switch to" panel opens beneath the button.',
      screenshots: [
        {
          id: 'account-mode-switching-s1-desktop',
          viewport: 'desktop',
          screen: '/dashboard',
          state: 'Signed in, mode switcher closed, desktop navigation, light mode',
          alt: 'Top navigation with the mode switcher button highlighted',
          caption: 'The mode switcher in the top navigation.',
          annotations: [
            { n: 1, label: 'Mode switcher button', locator: '[data-nav-disclosure] button' },
          ],
        },
        {
          id: 'account-mode-switching-s1-mobile',
          viewport: 'mobile',
          screen: '/dashboard',
          state: 'Signed in, mobile menu open showing the mode switcher, light mode',
          alt: 'Mobile menu with the mode switcher',
          caption: 'The mode switcher inside the mobile menu.',
          annotations: [
            { n: 1, label: 'Mode switcher button', locator: '[data-nav-disclosure] button' },
          ],
        },
      ],
    },
    {
      id: 'account-mode-switching-s2',
      title: 'Pick the mode you want to use',
      body: 'The panel is titled "Switch to" and lists your available modes: self-selectable modes such as Customer, Helper, and Business Owner, plus any granted modes (business team roles) a workspace owner gave you. Your current mode shows a "Current" badge and is disabled. Choose the target mode row; it briefly shows "Switching...".',
      expectedResult: 'A "Switched to" toast confirms the change and the dashboard reloads.',
      screenshots: [
        {
          id: 'account-mode-switching-s2-desktop',
          viewport: 'desktop',
          screen: '/dashboard',
          state: 'Mode switcher panel open, signed in, light mode',
          alt: 'Switch to panel listing available modes with a Current badge',
          caption: 'The Switch to panel with your available modes.',
          annotations: [
            { n: 1, label: 'Switch to panel', locator: '[role="group"]' },
            { n: 2, label: 'Current badge', locator: '[aria-current="true"]' },
            { n: 3, label: 'Target mode row', locator: '[role="group"] button' },
          ],
        },
        {
          id: 'account-mode-switching-s2-mobile',
          viewport: 'mobile',
          screen: '/dashboard',
          state: 'Mode switcher panel open, signed in, light mode',
          alt: 'Mode list on a phone screen',
          caption: 'The mode list, mobile view.',
          annotations: [
            { n: 1, label: 'Target mode row', locator: '[role="group"] button' },
          ],
        },
      ],
    },
    {
      id: 'account-mode-switching-s3',
      title: 'Confirm the new mode is active',
      body: 'The mode button in the navigation now shows the new mode name, and the dashboard renders that mode\'s home screen (for example, Helper shows the helper dashboard). If the wrong dashboard appears, your effective mode may fall back to your original account type; check Settings, Account Type.',
      expectedResult: 'The navigation shows the new mode and the dashboard matches it.',
      screenshots: [
        {
          id: 'account-mode-switching-s3-desktop',
          viewport: 'desktop',
          screen: '/dashboard',
          state: 'Signed in after mode switch, new mode active, light mode',
          alt: 'Dashboard with the mode switcher showing the new mode',
          caption: 'The switcher confirms the new active mode.',
          annotations: [
            { n: 1, label: 'New current mode', locator: '[data-nav-disclosure] button' },
          ],
        },
        {
          id: 'account-mode-switching-s3-mobile',
          viewport: 'mobile',
          screen: '/dashboard',
          state: 'Signed in after mode switch, new mode active, light mode',
          alt: 'Dashboard on a phone after a mode switch',
          caption: 'The new active mode, mobile view.',
          annotations: [
            { n: 1, label: 'New current mode', locator: '[data-nav-disclosure] button' },
          ],
        },
      ],
    },
  ],
  confirmOutcome: 'The mode button shows the new mode and the dashboard content matches it. A "Switched to" toast appeared at the moment of switching.',
  recovery: [
    {
      problem: 'The mode you want is not listed.',
      solution: 'Self-selectable modes are Customer, Helper, and Business Owner. Business team roles (Manager, Representative, Employee) are granted, not self-selected: a workspace owner must invite you and you must accept the invitation.',
    },
    {
      problem: 'You see "Could not switch."',
      solution: 'Reload the page and try again. If it persists, sign out and back in; your granted roles are reloaded on sign in.',
    },
  ],
  supportContact: 'If a granted mode never appears after you accepted an invitation, contact support from the Help menu or visit /support.',
  relatedGuides: ['account-signin', 'account-settings', 'account-onboarding'],
  siteLinks: [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Business hub', href: '/business-hub' },
  ],
  sources: [
    { type: 'screen', ref: 'client/src/components/ModeSwitcher.jsx' },
    { type: 'handler', ref: 'POST /api/auth/switch-role, server/utils/modeRole.js MODE_ROLE_MAP' },
    { type: 'flag', ref: 'LAUNCH_SELF_SELECTABLE_MODES, LAUNCH_GRANTED_MODES, LAUNCH_SWITCHER_MODES (client/src/utils/launchScope.js)' },
  ],
};

export default guide;
