/**
 * restaurant-store-settings - Configure store settings.
 * Sources: client/src/pages/food/FoodMerchantPage.jsx,
 * client/src/pages/food/RestaurantOpsPanels.jsx,
 * client/src/pages/food/RestaurantAuditPanels.jsx
 * Routes: /restaurants/merchant, /restaurants/pos/:restaurantId,
 * /restaurants/queue/:restaurantId, /restaurants/kiosk/:restaurantId
 */

const guide = {
  id: 'restaurant-store-settings',
  area: 'restaurants',
  slug: 'restaurant-store-settings',
  title: 'Configure store settings',
  audiences: ['restaurant'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Configure the storefront settings that control ordering, hours, money handling, branding, and in-store screens.',
  intendedRoles: ['Restaurant owner', 'Restaurant manager'],
  prerequisites: [
    { text: 'Sign in and open the restaurant dashboard.', href: '/restaurants/merchant' },
    { text: 'Finish restaurant setup.', guideId: 'restaurant-setup' },
  ],
  processMap: {
    nodes: [
      { id: 'open', label: 'Open the Settings tab', type: 'terminal' },
      { id: 'glance', label: 'Review At a glance', type: 'step' },
      { id: 'ordering', label: 'Set Ordering, Kitchen workflow, Brand, Guest checkout', type: 'step' },
      { id: 'hours', label: 'Set Operating hours', type: 'step' },
      { id: 'money', label: 'Set Money (tax, direct payment)', type: 'step' },
      { id: 'screens', label: 'Open in-store screens', type: 'step' },
      { id: 'ops', label: 'Check the Operations tab', type: 'step' },
      { id: 'done', label: 'Store configured', type: 'terminal' },
    ],
    edges: [
      { from: 'open', to: 'glance' },
      { from: 'glance', to: 'ordering' },
      { from: 'ordering', to: 'hours' },
      { from: 'hours', to: 'money' },
      { from: 'money', to: 'screens' },
      { from: 'screens', to: 'ops' },
      { from: 'ops', to: 'done' },
    ],
  },
  processMapText:
    'Open the Settings tab on the restaurant dashboard and review the "At a glance" chips. Configure the Ordering section (live status, online and in-store orders, prep time), the Kitchen workflow (quality check, queue removal delay), Brand accent color, and Guest checkout rules. Set Operating hours and save them. Configure the Money section (tax rate, direct payment, QR pay codes), then open the in-store screens (Kitchen display, Queue board, Kiosk) and review the Operations tab checklists and SOPs.',
  steps: [
    {
      id: 'restaurant-store-settings-s1',
      title: 'Open the Settings tab and review At a glance',
      body: 'On the restaurant dashboard at /restaurants/merchant, choose the "Settings" tab. The "At a glance" section shows status chips: "Online ordering on" or "Online ordering off", "In-store on" or "In-store off", "Hours x of 7 days" (or "Hours not set"), "Tax x%" (or "Tax not set"), and "Direct payment on" or "Direct payment off".',
      expectedResult: 'You can see the current live status, hours, tax, and payment configuration at a glance.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/restaurants/merchant',
          state: 'Settings tab At a glance chips, light mode',
          alt: 'Settings tab with status chips',
          caption: 'The Settings tab, desktop view.',
          annotations: [
            { n: 1, label: 'Settings tab', locator: '[role=tablist] button' },
            { n: 2, label: 'At a glance chips', locator: 'section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/restaurants/merchant',
          state: 'Settings tab At a glance chips, light mode',
          alt: 'Settings tab on a phone screen',
          caption: 'The Settings tab, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-store-settings-s2',
      title: 'Configure ordering, kitchen workflow, brand, and guest checkout',
      body: 'In "Ordering" ("Take the restaurant live and control where guests can order."), toggle "Online orders" and "In-store orders", set "Prep time (minutes)", and use "Go live" or "Pause". In "Kitchen workflow", toggle "Quality check" and set the "Queue removal delay (seconds)". In "Brand", use "Pick a color" to set the "Brand accent (#RRGGBB)" shown on the customer page and receipts. In "Guest checkout", choose whether "Pickup name required" and "Contact for status updates" are on.',
      expectedResult: 'Ordering, kitchen workflow, brand color, and guest checkout rules match how the store runs.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/restaurants/merchant',
          state: 'Ordering and kitchen workflow sections, light mode',
          alt: 'Ordering and kitchen workflow settings',
          caption: 'Ordering settings, desktop view.',
          annotations: [
            { n: 1, label: 'Online orders toggle', locator: 'section label' },
            { n: 2, label: 'Quality check toggle', locator: 'section label' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/restaurants/merchant',
          state: 'Ordering and kitchen workflow sections, light mode',
          alt: 'Ordering settings on a phone screen',
          caption: 'Ordering settings, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-store-settings-s3',
      title: 'Set operating hours',
      body: 'In "Operating hours" ("Set hours for each day. Toggle a day off when the restaurant is closed."), set "Opens" and "Closes" per day. Use "Copy Monday to all days" for a uniform schedule, then choose "Save hours".',
      expectedResult: 'The "At a glance" chip reads "Hours x of 7 days" and customers see the right open status.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/restaurants/merchant',
          state: 'Operating hours editor, light mode',
          alt: 'Operating hours with per-day open and close times',
          caption: 'Operating hours, desktop view.',
          annotations: [
            { n: 1, label: 'Opens and Closes fields', locator: 'section input' },
            { n: 2, label: 'Save hours button', locator: 'section button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/restaurants/merchant',
          state: 'Operating hours editor, light mode',
          alt: 'Operating hours on a phone screen',
          caption: 'Operating hours, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-store-settings-s4',
      title: 'Configure money handling',
      body: 'In "Money" ("Sales tax and direct payment options for checkout."), set the "Tax rate (%)" ("Sales tax added to customer orders. Leave blank or 0 when tax does not apply."). In "Direct payment" ("Share one payment account or QR. Customers attach a receipt or confirmation number when they order."), toggle "Direct payment", choose whether to "Require receipt or confirmation", fill the "Payment label" and "Handle / account", and use "Manage QR pay codes" to link your QR payment codes.',
      expectedResult: 'Tax applies to customer orders and the chosen direct-payment flow is ready at checkout.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/restaurants/merchant',
          state: 'Money section with tax and direct payment, light mode',
          alt: 'Money settings with tax rate and direct payment',
          caption: 'Money settings, desktop view.',
          annotations: [
            { n: 1, label: 'Tax rate field', locator: 'section input' },
            { n: 2, label: 'Direct payment toggle', locator: 'section label' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/restaurants/merchant',
          state: 'Money section with tax and direct payment, light mode',
          alt: 'Money settings on a phone screen',
          caption: 'Money settings, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-store-settings-s5',
      title: 'Open the in-store screens',
      body: 'In "In-store screens" ("Open these on a kitchen screen or projector, a TV facing your guests, and a tablet for self-ordering."), open "Kitchen display" (/restaurants/kitchen/:restaurantId), "Queue board" (/restaurants/queue/:restaurantId), and "Kiosk" (/restaurants/kiosk/:restaurantId) on the right devices.',
      expectedResult: 'Each screen shows the live view for your restaurant on its dedicated device.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/restaurants/merchant',
          state: 'In-store screens links, light mode',
          alt: 'In-store screens section with Kitchen display, Queue board, and Kiosk links',
          caption: 'In-store screens, desktop view.',
          annotations: [
            { n: 1, label: 'Kitchen display link', locator: 'section a' },
            { n: 2, label: 'Queue board link', locator: 'section a' },
            { n: 3, label: 'Kiosk link', locator: 'section a' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/restaurants/merchant',
          state: 'In-store screens links, light mode',
          alt: 'In-store screens on a phone screen',
          caption: 'In-store screens, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-store-settings-s6',
      title: 'Review the Operations tab',
      body: 'Open the "Operations" tab. Under "Checklists", use "New checklist" ("Checklist name", "Type", "Add suggested starter tasks") and "Start" on opening or closing routines; "Mark complete" finishes a run. Under "SOP library", use "New SOP" ("Title", "Category", "Procedure") to document how your team does things.',
      expectedResult: 'Opening and closing routines and store procedures are documented for the team.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/restaurants/merchant',
          state: 'Operations tab with checklists and SOPs, light mode',
          alt: 'Operations tab with checklists and SOP library',
          caption: 'The Operations tab, desktop view.',
          annotations: [
            { n: 1, label: 'Checklists section', locator: 'section' },
            { n: 2, label: 'SOP library section', locator: 'section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/restaurants/merchant',
          state: 'Operations tab with checklists and SOPs, light mode',
          alt: 'Operations tab on a phone screen',
          caption: 'The Operations tab, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'The Settings tab shows the intended live status, hours, tax, and payment options, and each in-store screen is open on its device.',
  recovery: [
    {
      problem: 'Customers cannot order even though the restaurant exists.',
      solution: 'In the "Ordering" section, confirm "Go live" was chosen and the "Online orders" toggle is on. The Home tab warns when "Your restaurant is not live yet".',
    },
    {
      problem: 'A settings change fails to save.',
      solution: 'You see "Could not update the restaurant." Retry; for hours, use "Copy Monday to all days" before "Save hours" if a day was left half-filled.',
    },
  ],
  supportContact: 'For settings help, use the in-app support page at /support.',
  relatedGuides: ['restaurant-setup', 'restaurant-menus', 'restaurant-preparation', 'restaurant-staff-tools'],
  siteLinks: [
    { label: 'Restaurant dashboard', href: '/restaurants/merchant' },
    { label: 'Food directory', href: '/food' },
  ],
  sources: [
    { type: 'route', ref: '/restaurants/merchant' },
    { type: 'route', ref: '/restaurants/pos/:restaurantId' },
    { type: 'route', ref: '/restaurants/queue/:restaurantId' },
    { type: 'route', ref: '/restaurants/kiosk/:restaurantId' },
    { type: 'screen', ref: 'client/src/pages/food/FoodMerchantPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/food/RestaurantOpsPanels.jsx' },
    { type: 'screen', ref: 'client/src/pages/food/RestaurantAuditPanels.jsx' },
  ],
};

export default guide;
