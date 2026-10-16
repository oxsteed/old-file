/**
 * other-car-care - Manage vehicle records (car care garage).
 * Sources: client/src/pages/CarCarePage.jsx
 * Route: /car-care
 */

const guide = {
  id: 'other-car-care',
  area: 'other',
  slug: 'manage-car-care',
  title: 'Manage vehicle records (car care garage)',
  audiences: ['customer'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Save vehicles to your garage with NHTSA-verified data and track their maintenance.',
  intendedRoles: ['Customer'],
  prerequisites: [
    { text: 'A signed-in OxSteed account.', href: '/login' },
  ],
  processMap: {
    nodes: [
      { id: 'open', label: 'Open Car Care', type: 'terminal' },
      { id: 'find', label: 'Search by VIN, make, or model', type: 'step' },
      { id: 'add', label: 'Choose + Add to My Garage', type: 'step' },
      { id: 'garage', label: 'Review My Garage', type: 'step' },
      { id: 'service', label: 'Add services to the Maintenance Log', type: 'step' },
      { id: 'done', label: 'Vehicle saved and maintained', type: 'terminal' },
    ],
    edges: [
      { from: 'open', to: 'find' },
      { from: 'find', to: 'add' },
      { from: 'add', to: 'garage' },
      { from: 'garage', to: 'service' },
      { from: 'service', to: 'done' },
    ],
  },
  processMapText:
    '1. Open /car-care, titled "Car Care" with the description "Search and save your vehicles. Data from the U.S. NHTSA vPIC API". ' +
    '2. Find your vehicle: scan or enter the 17-character VIN, or pick Make ("Make (e.g. Toyota)"), Model, and Year. ' +
    '3. Choose "+ Add to My Garage" ("Vehicle added!" on success; "NHTSA verified" marks verified data). ' +
    '4. Review "My Garage": edit with "Edit" or remove with "Remove". 5. Use "Maintenance Log" and "+ Add Service" to track services with recurrence.',
  steps: [
    {
      id: 'other-car-care-s1',
      title: 'Open Car Care and search for your vehicle',
      body: 'Open /car-care while signed in. The page is titled "Car Care" with the description "Search and save your vehicles. Data from the U.S. NHTSA vPIC API - free government data, always up to date." Use "Scan / Enter VIN" with the 17-character VIN field ("Enter 17-character VIN"), or pick "Make" ("Make (e.g. Toyota)"), "Model", and "Year" from the dropdowns.',
      expectedResult: 'Your vehicle details appear, decoded from NHTSA data.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/car-care',
          state: 'Car Care search with vehicle found, signed in, light mode',
          alt: 'Car Care vehicle search with results',
          caption: 'Finding your vehicle, desktop view.',
          annotations: [
            { n: 1, label: 'Car Care title', locator: 'h1' },
            { n: 2, label: 'VIN field', locator: 'input' },
            { n: 3, label: 'Make and Model selectors', locator: 'select' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/car-care',
          state: 'Car Care search, signed in, light mode',
          alt: 'Vehicle search on a phone screen',
          caption: 'Finding your vehicle, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-car-care-s2',
      title: 'Add the vehicle to your garage',
      body: 'Choose "Decode" for a VIN lookup, or fill in Make, Model, Year, and the optional "Nickname". Choose "+ Add to My Garage" (or "+ Add to Garage" from a VIN result). On success you see "Vehicle added!". NHTSA-verified vehicles show the "NHTSA verified" badge.',
      expectedResult: 'The vehicle appears under "My Garage".',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/car-care',
          state: 'Vehicle ready to add, light mode',
          alt: 'Vehicle with the Add to My Garage button',
          caption: 'Adding a vehicle, desktop view.',
          annotations: [
            { n: 1, label: 'Vehicle details', locator: 'section' },
            { n: 2, label: '+ Add to My Garage button', locator: 'button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/car-care',
          state: 'Vehicle ready to add, light mode',
          alt: 'Adding on a phone screen',
          caption: 'Adding a vehicle, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-car-care-s3',
      title: 'Manage My Garage',
      body: 'Under "My Garage", each vehicle shows its details and notes ("Notes" are private: "Shop name, current mileage, etc."). Choose "Edit" to change details ("Edit Vehicle", then "Save Changes"), or "Remove" to delete it ("Remove {{name}} from your garage?" with "Keep It" and "Remove" options).',
      expectedResult: 'Your garage reflects the current vehicle list and notes.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/car-care',
          state: 'My Garage with saved vehicles, light mode',
          alt: 'My Garage with vehicle cards',
          caption: 'My Garage, desktop view.',
          annotations: [
            { n: 1, label: 'Vehicle card', locator: 'section' },
            { n: 2, label: 'Edit button', locator: 'button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/car-care',
          state: 'My Garage, light mode',
          alt: 'Garage on a phone screen',
          caption: 'My Garage, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-car-care-s4',
      title: 'Track maintenance',
      body: 'Use the "Maintenance Log" to record services. Choose "+ Add Service" to open the "Add Car Service" dialog: pick the vehicle ("Vehicle (optional)", or "All vehicles / unspecified"), enter the "Service Name", and set recurrence (weekly, biweekly, monthly, quarterly, every 6 mo, annually, or every N days). Overdue and upcoming services show under "Overdue", "This Week", and "Total Pending".',
      expectedResult: 'The service is logged and shows in the maintenance schedule.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/car-care',
          state: 'Maintenance Log with services, light mode',
          alt: 'Maintenance Log with service entries',
          caption: 'The Maintenance Log, desktop view.',
          annotations: [
            { n: 1, label: 'Maintenance Log heading', locator: 'h2' },
            { n: 2, label: '+ Add Service button', locator: 'button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/car-care',
          state: 'Maintenance Log, light mode',
          alt: 'Maintenance log on a phone screen',
          caption: 'The Maintenance Log, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'Your vehicle is listed in "My Garage" and its services appear in the "Maintenance Log".',
  recovery: [
    {
      problem: 'You see "Failed to add vehicle."',
      solution: 'Check the VIN is 17 characters or that make and model are selected, then try again.',
    },
    {
      problem: 'Your vehicle is not in the NHTSA data.',
      solution: 'Enter the make, model, and year manually instead of using VIN decode.',
    },
  ],
  supportContact: 'Car Care issues: contact support from the in-app support page at /support.',
  relatedGuides: ['other-planned-needs'],
  siteLinks: [
    { label: 'Car Care', href: '/car-care' },
  ],
  sources: [
    { type: 'route', ref: '/car-care' },
    { type: 'screen', ref: 'client/src/pages/CarCarePage.jsx' },
    { type: 'handler', ref: 'GET /api/vehicles/my' },
    { type: 'handler', ref: 'POST /api/vehicles/my' },
  ],
};

export default guide;
