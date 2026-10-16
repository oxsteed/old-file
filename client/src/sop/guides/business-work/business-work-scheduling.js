// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "business-work-scheduling",
  "area": "business-work",
  "slug": "schedule-appointments-and-staff",
  "title": "Schedule appointments and manage staff schedules",
  "audiences": [
    "business"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Keep business hours accurate and handle appointment requests without double-booking.",
  "intendedRoles": [
    "Business owner",
    "Business manager"
  ],
  "prerequisites": [
    {
      "text": "Sign in and open your business in the business hub.",
      "guideId": "business-work-select",
      "href": "/business-hub"
    },
    {
      "text": "Add at least one bookable service.",
      "guideId": "business-work-services",
      "href": "/business-hub?tab=services"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open the Schedule tab",
        "type": "terminal"
      },
      {
        "id": "hours",
        "label": "Set your business hours",
        "type": "step"
      },
      {
        "id": "requests",
        "label": "Review appointment requests",
        "type": "step"
      },
      {
        "id": "act",
        "label": "Confirm, reschedule, or cancel?",
        "type": "decision"
      },
      {
        "id": "confirm",
        "label": "Confirm the appointment",
        "type": "step"
      },
      {
        "id": "reschedule",
        "label": "Reschedule with a new time",
        "type": "step"
      },
      {
        "id": "cancel",
        "label": "Cancel the appointment",
        "type": "step"
      },
      {
        "id": "complete",
        "label": "Complete finished appointments",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Schedule current",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "hours"
      },
      {
        "from": "hours",
        "to": "requests"
      },
      {
        "from": "requests",
        "to": "act"
      },
      {
        "from": "act",
        "to": "confirm",
        "label": "Confirm"
      },
      {
        "from": "act",
        "to": "reschedule",
        "label": "Reschedule"
      },
      {
        "from": "act",
        "to": "cancel",
        "label": "Cancel"
      },
      {
        "from": "confirm",
        "to": "complete"
      },
      {
        "from": "reschedule",
        "to": "complete"
      },
      {
        "from": "cancel",
        "to": "done"
      },
      {
        "from": "complete",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Open the Schedule tab in the business hub. 2. Set your business hours so customers can only book open times. 3. Review appointment requests in the Appointments section. 4. Decide: confirm the appointment, reschedule it with a new time, or cancel it. 5. After the work is done, complete the appointment. 6. Your schedule stays current and accurate.",
  "steps": [
    {
      "id": "business-work-scheduling-s1",
      "title": "Open the Schedule tab",
      "body": "Open /business-hub?tab=calendar for your business. The Schedule tab combines business hours, appointments, the business calendar, and follow-up demand in one workspace.",
      "expectedResult": "The schedule workspace loads with Business Hours, Appointments, and Business Calendar sections.",
      "screenshots": [
        {
          "id": "business-work-scheduling-s1-desktop",
          "viewport": "desktop",
          "screen": "/business-hub?tab=calendar",
          "state": "Schedule tab with synthetic data, light mode",
          "alt": "Schedule tab showing Business Hours, Appointments, and Business Calendar sections",
          "caption": "The Schedule tab, desktop view.",
          "annotations": []
        },
        {
          "id": "business-work-scheduling-s1-mobile",
          "viewport": "mobile",
          "screen": "/business-hub?tab=calendar",
          "state": "Schedule tab with synthetic data, light mode",
          "alt": "Schedule tab on a phone screen",
          "caption": "The Schedule tab, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "business-work-scheduling-s2",
      "title": "Set your business hours",
      "body": "In the Business Hours section, set open and close times for each day of the week (or mark days closed). Accurate hours prevent bookings when you are closed.",
      "expectedResult": "Your hours save and apply to customer booking.",
      "screenshots": [
        {
          "id": "business-work-scheduling-s2-desktop",
          "viewport": "desktop",
          "screen": "/business-hub?tab=calendar",
          "state": "Business hours editor with synthetic hours, light mode",
          "alt": "Business Hours editor with per-day open and close times",
          "caption": "Setting business hours, desktop view.",
          "annotations": []
        },
        {
          "id": "business-work-scheduling-s2-mobile",
          "viewport": "mobile",
          "screen": "/business-hub?tab=calendar",
          "state": "Business hours editor with synthetic hours, light mode",
          "alt": "Business hours on a phone screen",
          "caption": "Setting business hours, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "business-work-scheduling-s3",
      "title": "Review appointment requests",
      "body": "In the Appointments section, filter by All, Pending, Confirmed, Completed, or Cancelled. Choose an appointment to see the customer, service, time, and any cancellation fee.",
      "expectedResult": "The appointment detail shows everything you need to decide.",
      "screenshots": [
        {
          "id": "business-work-scheduling-s3-desktop",
          "viewport": "desktop",
          "screen": "/business-hub?tab=calendar",
          "state": "Appointments section with synthetic appointments, light mode",
          "alt": "Appointments list with status filters and a selected appointment detail",
          "caption": "Reviewing appointments, desktop view.",
          "annotations": []
        },
        {
          "id": "business-work-scheduling-s3-mobile",
          "viewport": "mobile",
          "screen": "/business-hub?tab=calendar",
          "state": "Appointments section with synthetic appointments, light mode",
          "alt": "Appointments on a phone screen",
          "caption": "Reviewing appointments, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "business-work-scheduling-s4",
      "title": "Confirm, reschedule, cancel, or complete",
      "body": "On the appointment, choose Confirm to lock it in, Reschedule to propose a new time (choose Confirm Reschedule when you agree on a time), Cancel to cancel it (the cancellation policy and any late fee apply), or Complete when the work is done.",
      "expectedResult": "The appointment status updates and the customer is notified.",
      "screenshots": [
        {
          "id": "business-work-scheduling-s4-desktop",
          "viewport": "desktop",
          "screen": "/business-hub?tab=calendar",
          "state": "Appointment detail with action buttons, synthetic data, light mode",
          "alt": "Appointment detail with Confirm, Reschedule, Cancel, and Complete buttons",
          "caption": "Acting on an appointment, desktop view.",
          "annotations": []
        },
        {
          "id": "business-work-scheduling-s4-mobile",
          "viewport": "mobile",
          "screen": "/business-hub?tab=calendar",
          "state": "Appointment detail with action buttons, synthetic data, light mode",
          "alt": "Appointment actions on a phone screen",
          "caption": "Acting on an appointment, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "Appointments show the correct status (confirmed, rescheduled, cancelled, completed) and your calendar has no double bookings.",
  "recovery": [
    {
      "problem": "Customers book outside your hours.",
      "solution": "Re-check the Business Hours section: closed days must be marked closed and times must be saved."
    },
    {
      "problem": "A cancelled appointment charged a late fee by mistake.",
      "solution": "Open the appointment detail to see the cancellation fee recorded. Correct it with your records and tell the customer; fees follow your cancellation policy."
    }
  ],
  "supportContact": "If appointments fail to load, contact OxSteed Support from the /support page.",
  "relatedGuides": [
    "business-work-services",
    "business-work-team-access"
  ],
  "siteLinks": [
    {
      "label": "Schedule tab",
      "href": "/business-hub?tab=calendar"
    },
    {
      "label": "Calendar",
      "href": "/calendar"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/business-hub?tab=calendar"
    },
    {
      "type": "route",
      "ref": "/calendar"
    },
    {
      "type": "screen",
      "ref": "client/src/components/businessHub/AppointmentCalendarView.jsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/calendar/appointments/:id/confirm|cancel"
    }
  ]
};
