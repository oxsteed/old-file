/**
 * hiring-book.js - SOP guide: Book a helper, business, or service slot.
 * Screen sources: client/src/pages/BookHelperPage.jsx, client/src/pages/BookServicePage.jsx,
 * client/src/pages/DirectBookSlotPage.jsx, client/src/pages/MyBookingsPage.tsx
 */

const guide = {
  id: 'hiring-book',
  area: 'hiring',
  slug: 'book-helper',
  title: 'Book a helper, business, or service slot',
  audiences: ['customer'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Request a booking with a helper, business, or Direct service slot and track it to confirmation.',
  intendedRoles: ['Customer'],
  prerequisites: [
    { text: 'Be signed in to your OxSteed account; booking creation requires a verified email and accepted terms.', guideId: 'account-signin', href: '/login' },
    { text: 'Have the helper, business, or service you want to book.', guideId: 'hiring-find-help', href: '/helpers' },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open the booking page', type: 'terminal' },
      { id: 'slot', label: 'Pick a date and time', type: 'step' },
      { id: 'terms', label: 'Agree to the booking terms', type: 'step' },
      { id: 'send', label: 'Send the booking request', type: 'step' },
      { id: 'check', label: 'Helper accepts?', type: 'decision' },
      { id: 'done', label: 'Booking confirmed', type: 'terminal' },
      { id: 'declined', label: 'Pick another slot or helper', type: 'blocked' },
    ],
    edges: [
      { from: 'start', to: 'slot' },
      { from: 'slot', to: 'terms' },
      { from: 'terms', to: 'send' },
      { from: 'send', to: 'check' },
      { from: 'check', to: 'done', label: 'Accepted' },
      { from: 'check', to: 'declined', label: 'Declined' },
      { from: 'declined', to: 'slot' },
    ],
  },
  processMapText:
    '1. Open the booking page: /book/:id for a helper, /book/business/:id for a business, or /direct/book-slot for a Direct service slot. ' +
    'The helper page heading is "Book this professional". 2. Pick a date and time from the available slots. ' +
    '3. Review and agree to the booking terms. 4. Send the request ("Book now"). ' +
    '5. Track it on /my-bookings: statuses include Pending, Accepted, Declined, Cancelled, and Expired. ' +
    '6. Once accepted, manage it there (Cancel, Complete) or convert it into a job.',
  steps: [
    {
      id: 'hiring-book-s1',
      title: 'Open the booking page for the provider',
      body: 'From a helper profile choose "Book Now" to open /book/:id ("Book this professional"). For a business use /book/business/:id. For an OxSteed-operated Direct service, open /direct/book-slot. The page shows the provider summary and their availability.',
      expectedResult: 'The booking page loads with available time slots.',
      screenshots: [
        {
          id: 'hiring-book-s1-desktop',
          viewport: 'desktop',
          screen: '/book/:id',
          state: 'Booking page loaded with slots, signed in, light mode',
          alt: 'Book this professional page with available slots',
          caption: 'The helper booking page, desktop view.',
          annotations: [
            { n: 1, label: 'Book this professional heading', locator: 'h1' },
            { n: 2, label: 'Available slots', locator: '.slots' },
          ],
        },
        {
          id: 'hiring-book-s1-mobile',
          viewport: 'mobile',
          screen: '/book/:id',
          state: 'Booking page loaded with slots, signed in, light mode',
          alt: 'Booking page on a phone screen',
          caption: 'The booking page, mobile view.',
          annotations: [
            { n: 1, label: 'Available slots', locator: '.slots' },
          ],
        },
      ],
    },
    {
      id: 'hiring-book-s2',
      title: 'Pick a date and time and agree to the terms',
      body: 'Choose an available date and time slot. Review the price (service pages show "Base price" and a "Book now - {{price}}" button) and tick the booking terms agreement ("Please agree to the booking terms." if you skip it). The page can also suggest "Post a job for everyone" if you prefer bids instead.',
      expectedResult: 'A slot is selected and the terms are agreed.',
      screenshots: [
        {
          id: 'hiring-book-s2-desktop',
          viewport: 'desktop',
          screen: '/book/:id',
          state: 'Slot selected, terms agreed, signed in, light mode',
          alt: 'Selected slot with terms agreement and Book now button',
          caption: 'The selected slot and terms, desktop view.',
          annotations: [
            { n: 1, label: 'Selected slot', locator: '.slot.selected' },
            { n: 2, label: 'Terms agreement', locator: 'input[type="checkbox"]' },
            { n: 3, label: 'Book now button', locator: 'button' },
          ],
        },
        {
          id: 'hiring-book-s2-mobile',
          viewport: 'mobile',
          screen: '/book/:id',
          state: 'Slot selected, terms agreed, signed in, light mode',
          alt: 'Selected slot on a phone screen',
          caption: 'The slot selection, mobile view.',
          annotations: [
            { n: 1, label: 'Book now button', locator: 'button' },
          ],
        },
      ],
    },
    {
      id: 'hiring-book-s3',
      title: 'Send the request and track it',
      body: 'Choose "Book now" to send the request ("Sending request..."). Track it on /my-bookings, which lists bookings by status (Pending, Accepted, Declined, Cancelled, Expired) and offers actions like Cancel, Complete, and Confirm depending on the state. Helpers accept or decline from their side; a declined request shows the Declined status.',
      expectedResult: 'The booking appears on /my-bookings with the Pending status.',
      screenshots: [
        {
          id: 'hiring-book-s3-desktop',
          viewport: 'desktop',
          screen: '/my-bookings',
          state: 'Bookings list with pending booking, signed in, light mode',
          alt: 'My bookings page with status tabs and a pending booking',
          caption: 'Tracking the booking on My bookings.',
          annotations: [
            { n: 1, label: 'Status tabs', locator: '.tabs' },
            { n: 2, label: 'Pending booking', locator: '.booking-card' },
            { n: 3, label: 'Cancel action', locator: 'button' },
          ],
        },
        {
          id: 'hiring-book-s3-mobile',
          viewport: 'mobile',
          screen: '/my-bookings',
          state: 'Bookings list with pending booking, signed in, light mode',
          alt: 'My bookings on a phone screen',
          caption: 'My bookings, mobile view.',
          annotations: [
            { n: 1, label: 'Pending booking', locator: '.booking-card' },
          ],
        },
      ],
    },
  ],
  confirmOutcome: 'The booking moves from Pending to Accepted on /my-bookings and the helper is notified. You can message the helper about the booking from there.',
  recovery: [
    {
      problem: 'No slots are available.',
      solution: 'The provider\'s calendar may be full; try different dates, or message the helper to ask about other times.',
    },
    {
      problem: 'The booking is declined.',
      solution: 'Pick another slot or another helper. The request can also be converted to a public job to collect more options.',
    },
    {
      problem: 'You are asked to verify your email or accept terms.',
      solution: 'Booking creation requires a verified email and accepted terms; complete those first, then retry.',
    },
  ],
  supportContact: 'If a confirmed booking has the wrong time or price, contact support from the Help menu or visit /support.',
  relatedGuides: ['hiring-find-help', 'hiring-cancellations', 'hiring-message', 'hiring-post-job'],
  siteLinks: [
    { label: 'My bookings', href: '/my-bookings' },
    { label: 'Find helpers', href: '/helpers' },
    { label: 'Direct booking', href: '/direct/book-slot' },
  ],
  sources: [
    { type: 'route', ref: '/book/:id' },
    { type: 'route', ref: '/my-bookings' },
    { type: 'screen', ref: 'client/src/pages/BookHelperPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/BookServicePage.jsx' },
    { type: 'screen', ref: 'client/src/pages/MyBookingsPage.tsx' },
    { type: 'handler', ref: 'POST /api/bookings, POST /api/bookings/:bookingId/cancel' },
    { type: 'permission', ref: 'Authenticated; requireEmailVerified and requireTermsAcceptance on booking creation.' },
  ],
};

export default guide;
