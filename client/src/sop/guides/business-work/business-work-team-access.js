/**
 * business-work-team-access.js - Guide: manage team members and roles.
 *
 * Verified against: client/src/pages/BusinessHubPage.jsx (Team tab, TeamTab,
 * Invite Team Member modal, role select, Approve/Deny, Remove, Cancel),
 * server/routes/businessTeam.js handlers.
 */

export default {
  id: 'business-work-team-access',
  area: 'business-work',
  slug: 'manage-team-members-and-roles',
  title: 'Manage team members and roles',
  audiences: ['business'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Invite the right people to your business, give each person the right role, and remove access when it is no longer needed.',
  intendedRoles: ['Business owner', 'Business manager'],
  prerequisites: [
    { text: 'Sign in and open your business in the business hub.', guideId: 'business-work-select', href: '/business-hub' },
    { text: 'Owner or manager capability for the business (role changes are checked per business).', href: '/business-hub?tab=team' },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open the Team tab', type: 'terminal' },
      { id: 'invite', label: 'Invite a team member', type: 'step' },
      { id: 'role', label: 'Pick the role (Representative or Manager)', type: 'step' },
      { id: 'accept', label: 'They accept the invitation', type: 'step' },
      { id: 'manage', label: 'Change roles or remove access', type: 'step' },
      { id: 'done', label: 'Team up to date', type: 'terminal' },
    ],
    edges: [
      { from: 'start', to: 'invite' },
      { from: 'invite', to: 'role' },
      { from: 'role', to: 'accept' },
      { from: 'accept', to: 'manage' },
      { from: 'manage', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the Team tab in the business hub. 2. Choose the Invite button and enter the email address. ' +
    '3. Pick the role: Representative (handles leads, follow-ups, and sales conversion) or Manager (day-to-day operations without ownership rights). ' +
    '4. The invitee gets a notification and accepts. ' +
    '5. Change roles from the Role column, approve pending members, or remove access when needed. 6. Your team list is current.',
  steps: [
    {
      id: 'business-work-team-access-s1',
      title: 'Open the Team tab',
      body: 'Open /business-hub?tab=team for your business. The Team Members section lists current members and pending invitations with columns for Name / Email, Role, Status, and Since.',
      expectedResult: 'The team list loads with each member and their role and status.',
      screenshots: [
        {
          id: 'business-work-team-access-s1-desktop',
          viewport: 'desktop',
          screen: '/business-hub?tab=team',
          state: 'Team tab with synthetic members, light mode',
          alt: 'Team tab showing the Team Members table with the Invite button',
          caption: 'The Team tab, desktop view.',
          annotations: [
            { n: 1, label: 'Invite button', locator: 'button' },
            { n: 2, label: 'Team Members table', locator: '.bh-table-wrap' },
          ],
        },
        {
          id: 'business-work-team-access-s1-mobile',
          viewport: 'mobile',
          screen: '/business-hub?tab=team',
          state: 'Team tab with synthetic members, light mode',
          alt: 'Team tab on a phone screen',
          caption: 'The Team tab, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'business-work-team-access-s2',
      title: 'Invite a team member',
      body: 'Choose the Invite button. In the Invite Team Member dialog, enter the Email address and pick the Role: Representative (handles leads, follow-ups, and sales conversion) or Manager (day-to-day operations without ownership rights). Choose Send Invite.',
      expectedResult: '"Invitation sent" appears and the person shows as "Invite sent" in the list.',
      screenshots: [
        {
          id: 'business-work-team-access-s2-desktop',
          viewport: 'desktop',
          screen: '/business-hub?tab=team',
          state: 'Invite Team Member dialog open, light mode',
          alt: 'Invite Team Member dialog with email field, role select, and Send Invite button',
          caption: 'The Invite Team Member dialog, desktop view.',
          annotations: [
            { n: 1, label: 'Email field', locator: 'input[name="invite_email"]' },
            { n: 2, label: 'Role select', locator: 'select[name="invite_role"]' },
            { n: 3, label: 'Send Invite button', locator: 'button' },
          ],
        },
        {
          id: 'business-work-team-access-s2-mobile',
          viewport: 'mobile',
          screen: '/business-hub?tab=team',
          state: 'Invite Team Member dialog open, light mode',
          alt: 'Invite dialog on a phone screen',
          caption: 'The Invite Team Member dialog, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'business-work-team-access-s3',
      title: 'Approve, change roles, and remove access',
      body: 'For members awaiting approval, use Approve or Deny. Change a member role any time from the Role column (Employee, Representative, Manager, Support Agent). To revoke, use Cancel on a pending invite or Remove on an active member.',
      expectedResult: 'Roles update immediately; removed members lose access.',
      screenshots: [
        {
          id: 'business-work-team-access-s3-desktop',
          viewport: 'desktop',
          screen: '/business-hub?tab=team',
          state: 'Team tab with an awaiting-approval member, light mode',
          alt: 'Team member row with the role select and Approve, Deny, and Remove controls',
          caption: 'Managing a team member, desktop view.',
          annotations: [
            { n: 1, label: 'Role select', locator: 'select' },
            { n: 2, label: 'Approve / Deny', locator: 'button' },
            { n: 3, label: 'Remove', locator: 'button' },
          ],
        },
        {
          id: 'business-work-team-access-s3-mobile',
          viewport: 'mobile',
          screen: '/business-hub?tab=team',
          state: 'Team tab with member rows, light mode',
          alt: 'Team member controls on a phone screen',
          caption: 'Managing a team member, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'The Team Members list shows every member with the correct role and Active status.',
  recovery: [
    {
      problem: 'The invitee never got the invitation.',
      solution: 'Confirm the email address is spelled correctly, then use Cancel on the pending invite and send a fresh one.',
    },
    {
      problem: 'You cannot change a member role.',
      solution: 'Role changes need owner or manager capability for the business. Team member modes are granted by the owner, not self-selected.',
    },
  ],
  supportContact: 'If team invitations fail repeatedly, contact OxSteed Support from the /support page.',
  relatedGuides: ['business-work-select', 'business-work-scheduling'],
  siteLinks: [
    { label: 'Team tab', href: '/business-hub?tab=team' },
  ],
  sources: [
    { type: 'route', ref: '/business-hub?tab=team' },
    { type: 'screen', ref: 'client/src/pages/BusinessHubPage.jsx (Team tab, TeamTab)' },
    { type: 'handler', ref: 'businessTeam.js staff CRUD (server/routes/businessTeam.js)' },
    { type: 'permission', ref: "bizIdAccess('any'|'manager') capability checks" },
  ],
};
