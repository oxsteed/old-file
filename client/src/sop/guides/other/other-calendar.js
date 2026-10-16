/**
 * other-calendar - Manage the calendar.
 * Sources: client/src/pages/CalendarPage.jsx,
 * client/src/pages/CalendarAppointmentDetailPage.jsx
 * Routes: /calendar, /calendar/appointments/:appointmentId
 */

const guide = {
  id: 'other-calendar',
  area: 'calendar',
  slug: 'manage-calendar',
  title: 'Manage the calendar',
  audiences: ['customer', 'helper', 'business'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Review appointments, confirm or cancel them, request reschedules, and export to your calendar app.',
  intendedRoles: ['Customer', 'Helper', 'Business owner'],
  prerequisites: [
    { text: 'A signed-in OxSteed account.', href: '/login' },
    { text: 'Appointments created from bookings or job work.', href: '/calendar' },
  ],
  processMap: {
    nodes: [
      { id: 'open', label: 'Open the Calendar', type: 'terminal' },
      { id: 'view', label: 'Pick Day, Week, Month, or Agenda view', type: 'step' },
      { id: 'open-appt', label: 'Open an appointment', type: 'step' },
      { id: 'action', label: 'Confirm, cancel, or request a reschedule', type: 'step' },
      { id: 'export', label: 'Export with Download .ics or Add to Google Calendar', type: 'step' },
      { id: 'done', label: 'Calendar up to date', type: 'terminal' },
    ],
    edges: [
      { from: 'open', to: 'view' },
      { from: 'view', to: 'open-appt' },
      { from: 'open-appt', to: 'action' },
      { from: 'action', to: 'export' },
      { from: 'export', to: 'done' },
    ],
  },
  processMapText:
    '1. Open the Calendar at /calendar. 2. Switch between Day, Week, Month, and Agenda views. ' +
    '3. Open an appointment to see its details. 4. Confirm it, cancel it with a reason, or request a reschedule. ' +
    '5. Export it with "Download .ics" or "Add to Google Calendar". 6. Your calendar stays in sync with your bookings.',
  steps: [
    {
      id: 'other-calendar-s1',
      title: 'Open the Calendar',
      body: 'Open /calendar while signed in. The page is titled "Calendar". The view switcher offers "Day", "Week", "Month", and "Agenda". The legend explains job, booking, and event-type markers. "My Bookings" and "Booking Requests" sections sit alongside the grid.',
      expectedResult: 'Your appointments appear on the calendar in the selected view.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/calendar',
          state: 'Calendar week view with appointments, signed in, light mode',
          alt: 'Calendar week view with appointment blocks',
          caption: 'The Calendar, desktop view.',
          annotations: [
            { n: 1, label: 'Calendar title', locator: 'h1' },
            { n: 2, label: 'View switcher', locator: 'div[role="tablist"]' },
            { n: 3, label: 'Appointment blocks', locator: 'main' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/calendar',
          state: 'Calendar agenda view, signed in, light mode',
          alt: 'Calendar agenda on a phone screen',
          caption: 'The Calendar, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-calendar-s2',
      title: 'Open an appointment',
      body: 'Choose an appointment to open /calendar/appointments/:appointmentId. The detail page shows "Appointment Details" with date, time, duration, status (Requested, Confirmed, In Progress, Completed, Cancelled, Rescheduled), plus customer and helper info and notes.',
      expectedResult: 'The appointment detail page loads with its current status.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/calendar/appointments/:appointmentId',
          state: 'Appointment detail, status Confirmed, light mode',
          alt: 'Appointment detail with status and participant info',
          caption: 'An appointment, desktop view.',
          annotations: [
            { n: 1, label: 'Appointment Details', locator: 'section' },
            { n: 2, label: 'Status', locator: 'section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/calendar/appointments/:appointmentId',
          state: 'Appointment detail, light mode',
          alt: 'Appointment detail on a phone screen',
          caption: 'An appointment, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-calendar-s3',
      title: 'Confirm, cancel, or request a reschedule',
      body: 'Use "Confirm appointment" to confirm a requested appointment. Use "Cancel appointment" to cancel; you can add a "Cancel reason" in the "Cancel reason" field. Use the reschedule action to request a new time. Status changes are saved immediately and both parties are notified.',
      expectedResult: 'The appointment status updates (for example to Confirmed or Cancelled).',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/calendar/appointments/:appointmentId',
          state: 'Appointment actions visible, light mode',
          alt: 'Confirm and Cancel appointment buttons',
          caption: 'Appointment actions, desktop view.',
          annotations: [
            { n: 1, label: 'Confirm appointment button', locator: 'button' },
            { n: 2, label: 'Cancel appointment button', locator: 'button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/calendar/appointments/:appointmentId',
          state: 'Appointment actions, light mode',
          alt: 'Appointment actions on a phone screen',
          caption: 'Appointment actions, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'other-calendar-s4',
      title: 'Export the appointment',
      body: 'Use "Download .ics" to save the appointment as an iCalendar file you can import anywhere, or "Add to Google Calendar" to add it directly. Both use the appointment date, time, and duration shown on the detail page.',
      expectedResult: 'The appointment is saved to your external calendar.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/calendar/appointments/:appointmentId',
          state: 'Export options visible, light mode',
          alt: 'Download .ics and Add to Google Calendar options',
          caption: 'Exporting an appointment, desktop view.',
          annotations: [
            { n: 1, label: 'Download .ics', locator: 'button' },
            { n: 2, label: 'Add to Google Calendar', locator: 'button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/calendar/appointments/:appointmentId',
          state: 'Export options, light mode',
          alt: 'Export options on a phone screen',
          caption: 'Exporting, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'The appointment shows the expected status and appears in your external calendar after export.',
  recovery: [
    {
      problem: 'An appointment fails to load ("Appointment unavailable").',
      solution: 'It may have been cancelled by the other party. Check "My Bookings" for the current state.',
    },
    {
      problem: 'You cancelled by mistake.',
      solution: 'A cancelled appointment cannot be un-cancelled here. Message the other party to create a new booking.',
    },
  ],
  supportContact: 'Calendar issues: contact support from the in-app support page at /support.',
  relatedGuides: ['other-messages'],
  siteLinks: [
    { label: 'Calendar', href: '/calendar' },
  ],
  sources: [
    { type: 'route', ref: '/calendar' },
    { type: 'route', ref: '/calendar/appointments/:appointmentId' },
    { type: 'screen', ref: 'client/src/pages/CalendarPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/CalendarAppointmentDetailPage.jsx' },
    { type: 'handler', ref: 'POST /api/calendar/appointments/:id/confirm' },
    { type: 'handler', ref: 'POST /api/calendar/appointments/:id/cancel' },
  ],
};

export default guide;
