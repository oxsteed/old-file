/**
 * business-work-services.js - Guide: manage business services.
 *
 * Verified against: client/src/pages/BusinessHubPage.jsx (Services tab,
 * Add Service / Edit Service modal), /api/businesses/:businessId/services handlers.
 */

export default {
  id: 'business-work-services',
  area: 'business-work',
  slug: 'manage-business-services',
  title: 'Manage business services',
  audiences: ['business'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Publish the services your business offers so customers can book them.',
  intendedRoles: ['Business owner', 'Business manager'],
  prerequisites: [
    { text: 'Sign in and open your business in the business hub.', guideId: 'business-work-select', href: '/business-hub' },
    { text: 'Owner or manager capability to edit the business profile.', href: '/business-hub?tab=services' },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open the Services tab', type: 'terminal' },
      { id: 'add', label: 'Choose Add Service', type: 'step' },
      { id: 'fill', label: 'Enter name, description, price, and options', type: 'step' },
      { id: 'check', label: 'Service name and price entered?', type: 'decision' },
      { id: 'fix', label: 'Fill the required fields', type: 'blocked' },
      { id: 'save', label: 'Choose Save Service', type: 'step' },
      { id: 'manage', label: 'Edit, deactivate, or delete later', type: 'step' },
      { id: 'done', label: 'Service bookable', type: 'terminal' },
    ],
    edges: [
      { from: 'start', to: 'add' },
      { from: 'add', to: 'fill' },
      { from: 'fill', to: 'check' },
      { from: 'check', to: 'save', label: 'Yes' },
      { from: 'check', to: 'fix', label: 'No' },
      { from: 'fix', to: 'check' },
      { from: 'save', to: 'manage' },
      { from: 'manage', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the Services tab in the business hub. 2. Choose Add Service. 3. Enter the service name, description, price, price type, duration, and category. ' +
    '4. Check that the service name and price are entered; if not, fill them in and check again. ' +
    '5. Choose Save Service. 6. Edit, deactivate, or delete the service any time. 7. The service is live and bookable.',
  steps: [
    {
      id: 'business-work-services-s1',
      title: 'Open the Services tab',
      body: 'Open /business-hub?tab=services for your business. The Services tab lists your current services, or an empty state inviting you to add your first one.',
      expectedResult: 'Your service list loads.',
      screenshots: [
        {
          id: 'business-work-services-s1-desktop',
          viewport: 'desktop',
          screen: '/business-hub?tab=services',
          state: 'Services tab with two synthetic services, light mode',
          alt: 'Services tab with service cards and the Add Service button',
          caption: 'The Services tab, desktop view.',
          annotations: [
            { n: 1, label: 'Add Service button', locator: 'button' },
            { n: 2, label: 'Service card', locator: '.service-card' },
          ],
        },
        {
          id: 'business-work-services-s1-mobile',
          viewport: 'mobile',
          screen: '/business-hub?tab=services',
          state: 'Services tab with synthetic services, light mode',
          alt: 'Services tab on a phone screen',
          caption: 'The Services tab, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'business-work-services-s2',
      title: 'Add a service',
      body: 'Choose the + Add Service button. The Add Service dialog opens with fields for the service details.',
      expectedResult: 'The Add Service dialog opens with empty fields.',
      screenshots: [
        {
          id: 'business-work-services-s2-desktop',
          viewport: 'desktop',
          screen: '/business-hub?tab=services',
          state: 'Add Service dialog open, light mode',
          alt: 'Add Service dialog with name, description, price, and price type fields',
          caption: 'The Add Service dialog, desktop view.',
          annotations: [
            { n: 1, label: 'Service Name field', locator: 'input[name="name"]' },
            { n: 2, label: 'Description field', locator: 'textarea[name="description"]' },
            { n: 3, label: 'Price field', locator: 'input[name="price"]' },
            { n: 4, label: 'Price Type select', locator: 'select[name="price_unit"]' },
          ],
        },
        {
          id: 'business-work-services-s2-mobile',
          viewport: 'mobile',
          screen: '/business-hub?tab=services',
          state: 'Add Service dialog open, light mode',
          alt: 'Add Service dialog on a phone screen',
          caption: 'The Add Service dialog, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'business-work-services-s3',
      title: 'Describe and price the service',
      body: 'Enter the Service Name and Description. Set the Price and the Price Type (Flat rate, Per hour, Starting at, or By quote). Add the Duration and Category, tick Mark as popular for featured services, and keep Active on while the service is bookable. Choose Save Service.',
      expectedResult: 'The service appears in the list and is active.',
      screenshots: [
        {
          id: 'business-work-services-s3-desktop',
          viewport: 'desktop',
          screen: '/business-hub?tab=services',
          state: 'Add Service dialog filled with synthetic data, light mode',
          alt: 'Add Service dialog filled in with a sample service and the Save Service button',
          caption: 'A filled-in service, desktop view.',
          annotations: [
            { n: 1, label: 'Mark as popular and Active toggles', locator: 'input[type="checkbox"]' },
            { n: 2, label: 'Save Service button', locator: 'button' },
          ],
        },
        {
          id: 'business-work-services-s3-mobile',
          viewport: 'mobile',
          screen: '/business-hub?tab=services',
          state: 'Add Service dialog filled with synthetic data, light mode',
          alt: 'Filled-in service on a phone screen',
          caption: 'A filled-in service, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'business-work-services-s4',
      title: 'Edit or retire a service',
      body: 'Use Edit on a service card to change its details, or Delete to remove it. To hide a service without deleting it, edit it and switch Active off. Inactive services show an inactive marker and are not bookable.',
      expectedResult: 'Changes apply immediately to what customers see.',
      screenshots: [
        {
          id: 'business-work-services-s4-desktop',
          viewport: 'desktop',
          screen: '/business-hub?tab=services',
          state: 'Services tab with one inactive service, light mode',
          alt: 'Service cards with Edit and Delete buttons and an inactive marker',
          caption: 'Managing services, desktop view.',
          annotations: [
            { n: 1, label: 'Edit button', locator: 'button' },
            { n: 2, label: 'Delete button', locator: 'button' },
          ],
        },
        {
          id: 'business-work-services-s4-mobile',
          viewport: 'mobile',
          screen: '/business-hub?tab=services',
          state: 'Services tab with synthetic services, light mode',
          alt: 'Service cards on a phone screen',
          caption: 'Managing services, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'The service appears in your Services tab and on your public business page, ready to book.',
  recovery: [
    {
      problem: 'The service does not save.',
      solution: 'Service Name and Price are required. Fill them in and choose Save Service again.',
    },
    {
      problem: 'Customers cannot book the service.',
      solution: 'Edit the service and confirm Active is on. Check your business hours and availability so the service has bookable times.',
    },
  ],
  supportContact: 'If services fail to save, contact OxSteed Support from the /support page.',
  relatedGuides: ['business-work-scheduling', 'business-work-select'],
  siteLinks: [
    { label: 'Services tab', href: '/business-hub?tab=services' },
  ],
  sources: [
    { type: 'route', ref: '/business-hub?tab=services' },
    { type: 'screen', ref: 'client/src/pages/BusinessHubPage.jsx (Services tab)' },
    { type: 'handler', ref: 'POST /api/businesses/:businessId/services' },
  ],
};
