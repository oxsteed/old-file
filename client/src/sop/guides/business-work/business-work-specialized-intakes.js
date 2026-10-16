/**
 * business-work-specialized-intakes.js - Guide: submit specialized intake requests (conditional).
 *
 * Verified against: server/middleware/launchGate.js (specializedProfileTemplates flag,
 * /api/maintenance-requests/public returns 404 while off), client/src/utils/launchScope.js
 * (LAUNCH_BUSINESS_HUB_TABS with intake triage tabs), client/src/pages/BusinessProfilePage.jsx
 * (intake entry buttons hidden while flag off), client/src/pages/MaintenanceRequestPage.jsx.
 * Condition: the specializedProfileTemplates launch flag is off by default, so the
 * intake entry points are hidden and the public intake API is blocked until launch.
 */

export default {
  id: 'business-work-specialized-intakes',
  area: 'business-work',
  slug: 'specialized-intake-requests',
  title: 'Submit specialized intake requests (maintenance, trades, beauty, creative, professional, continuity)',
  audiences: ['business', 'customer'],
  revision: 1,
  availability: 'conditional',
  conditions: [
    'Specialized intake requests require the specializedProfileTemplates launch flag, which is off by default. While it is off, the intake entry buttons are hidden on business profile pages and the public intake API returns 404. The hub intake triage tabs (beauty-ops, creative-ops, continuity-ops, professional-ops, trades-ops, maintenance) are already registered so they appear automatically at launch.',
  ],
  goal: 'Collect structured intake requests from customers once specialized intake templates are launched.',
  intendedRoles: ['Business owner', 'Business manager', 'Customer'],
  prerequisites: [
    { text: 'A business with a specialized template (property manager, trades, beauty, creative, professional, or continuity).', href: '/business-hub' },
    { text: 'The specializedProfileTemplates launch flag enabled by the platform.', href: '/business-hub' },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open the business profile page', type: 'terminal' },
      { id: 'flag', label: 'Is specializedProfileTemplates enabled?', type: 'decision' },
      { id: 'blocked', label: 'Intake buttons hidden; API returns 404', type: 'blocked' },
      { id: 'entry', label: 'Choose the intake button for the template', type: 'step' },
      { id: 'form', label: 'Describe the issue and add details', type: 'step' },
      { id: 'submit', label: 'Submit the intake request', type: 'step' },
      { id: 'triage', label: 'Triage it in the hub ops tab', type: 'step' },
      { id: 'done', label: 'Intake tracked', type: 'terminal' },
    ],
    edges: [
      { from: 'start', to: 'flag' },
      { from: 'flag', to: 'blocked', label: 'No' },
      { from: 'flag', to: 'entry', label: 'Yes' },
      { from: 'entry', to: 'form' },
      { from: 'form', to: 'submit' },
      { from: 'submit', to: 'triage' },
      { from: 'triage', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the business profile page. 2. Check whether the specializedProfileTemplates flag is enabled. ' +
    'If it is not, the intake buttons are hidden and the public intake API returns 404; nothing can be submitted. ' +
    'If it is, choose the intake button matching the business template. 3. Describe the issue and add photos, unit details, access notes, and urgency. ' +
    '4. Submit the intake request. 5. Triage it in the matching hub operations tab. 6. The intake is tracked.',
  steps: [
    {
      id: 'business-work-specialized-intakes-s1',
      title: 'Check whether intakes are available',
      body: 'Open the business profile page. When the specializedProfileTemplates flag is off (the default), the intake entry buttons (maintenance request, trades request, beauty intake, creative intake, professional intake, continuity intake) do not render, and submitting to the public intake API returns a 404. There is nothing to fix: intakes are simply not launched yet.',
      expectedResult: 'You can tell whether intake buttons are present on the profile page.',
      screenshots: [
        {
          id: 'business-work-specialized-intakes-s1-desktop',
          viewport: 'desktop',
          screen: '/business/:businessId',
          state: 'Business profile, flag off, no intake buttons, light mode',
          alt: 'Business profile page with no intake buttons visible',
          caption: 'The business profile with intakes unreleased, desktop view.',
          annotations: [
            { n: 1, label: 'Standard booking area (no intake buttons)', locator: '.profile-actions' },
          ],
        },
        {
          id: 'business-work-specialized-intakes-s1-mobile',
          viewport: 'mobile',
          screen: '/business/:businessId',
          state: 'Business profile, flag off, no intake buttons, light mode',
          alt: 'Business profile on a phone screen with no intake buttons',
          caption: 'The business profile with intakes unreleased, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'business-work-specialized-intakes-s2',
      title: 'Open the intake form (when launched)',
      body: 'When the flag is on, the profile page shows the intake button for the business template (for example, the maintenance request button for a property manager). Choose it to open the intake form, such as "Report an issue to {business name}".',
      expectedResult: 'The intake form opens with the business context preloaded.',
      screenshots: [
        {
          id: 'business-work-specialized-intakes-s2-desktop',
          viewport: 'desktop',
          screen: '/business/:businessId/maintenance-request',
          state: 'Maintenance request form, synthetic data, light mode',
          alt: 'Maintenance request form with issue categories and details fields',
          caption: 'A specialized intake form, desktop view.',
          annotations: [
            { n: 1, label: 'Form title', locator: 'h1' },
            { n: 2, label: 'Issue category', locator: 'select, [role="listbox"]' },
          ],
        },
        {
          id: 'business-work-specialized-intakes-s2-mobile',
          viewport: 'mobile',
          screen: '/business/:businessId/maintenance-request',
          state: 'Maintenance request form, synthetic data, light mode',
          alt: 'Intake form on a phone screen',
          caption: 'A specialized intake form, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'business-work-specialized-intakes-s3',
      title: 'Describe the request and submit',
      body: 'Pick the issue category, write a clear title and description, and add what helps most: photos, unit details, access notes, urgency, and times that work for entry. Submit the form. You will see a submitted confirmation.',
      expectedResult: 'The intake submits and a confirmation appears.',
      screenshots: [
        {
          id: 'business-work-specialized-intakes-s3-desktop',
          viewport: 'desktop',
          screen: '/business/:businessId/maintenance-request',
          state: 'Intake form filled with synthetic data, light mode',
          alt: 'Filled-in intake form with photos, urgency, and the submit button',
          caption: 'Submitting an intake, desktop view.',
          annotations: [
            { n: 1, label: 'Photos and details', locator: 'input[type="file"]' },
            { n: 2, label: 'Submit button', locator: 'button' },
          ],
        },
        {
          id: 'business-work-specialized-intakes-s3-mobile',
          viewport: 'mobile',
          screen: '/business/:businessId/maintenance-request',
          state: 'Intake form filled with synthetic data, light mode',
          alt: 'Filled-in intake form on a phone screen',
          caption: 'Submitting an intake, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'business-work-specialized-intakes-s4',
      title: 'Triage the intake in the hub',
      body: 'Submitted intakes notify the owner with a deep link to the matching operations tab in the business hub (for example, the maintenance tab). Open the tab, review the request, and work it like any other incoming job.',
      expectedResult: 'The intake appears in the hub ops tab ready to work.',
      screenshots: [
        {
          id: 'business-work-specialized-intakes-s4-desktop',
          viewport: 'desktop',
          screen: '/business-hub?tab=maintenance',
          state: 'Hub intake ops tab with synthetic intake, light mode',
          alt: 'Hub intake operations tab with a submitted intake listed',
          caption: 'Triaging an intake, desktop view.',
          annotations: [
            { n: 1, label: 'Intake entry', locator: '.intake-card' },
          ],
        },
        {
          id: 'business-work-specialized-intakes-s4-mobile',
          viewport: 'mobile',
          screen: '/business-hub?tab=maintenance',
          state: 'Hub intake ops tab with synthetic intake, light mode',
          alt: 'Intake triage on a phone screen',
          caption: 'Triaging an intake, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'When launched, intake buttons appear on the profile and submissions land in the hub ops tab. While unlaunched, the 404 on the public intake API confirms the gate is working.',
  recovery: [
    {
      problem: 'The intake form returns a 404 on submit.',
      solution: 'The specializedProfileTemplates flag is off, so the server blocks the public intake API. This is expected until the platform enables the flag; use the standard job posting flow instead.',
    },
    {
      problem: 'You expected intake buttons but see none.',
      solution: 'Intake entry points render only while the flag is on and only for businesses with a specialized template. Confirm both with your OxSteed contact.',
    },
  ],
  supportContact: 'If intakes were announced as launched but still fail, contact OxSteed Support from the /support page.',
  relatedGuides: ['business-work-services', 'business-work-attention-inbox'],
  siteLinks: [
    { label: 'Business hub', href: '/business-hub' },
  ],
  sources: [
    { type: 'route', ref: '/business/:businessId/maintenance-request' },
    { type: 'screen', ref: 'client/src/pages/MaintenanceRequestPage.jsx' },
    { type: 'flag', ref: 'specializedProfileTemplates: false (server/middleware/launchGate.js, client/src/utils/launchScope.js)' },
  ],
};
