// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "helper-work-assigned-jobs",
  "area": "helper-work",
  "slug": "work-assigned-jobs",
  "title": "Work assigned jobs and incoming bookings",
  "audiences": [
    "helper"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Respond to incoming booking requests quickly and keep your assigned jobs moving.",
  "intendedRoles": [
    "Helper"
  ],
  "prerequisites": [
    {
      "text": "Sign in and switch to helper mode.",
      "href": "/login"
    },
    {
      "text": "Set your availability so customers can book you.",
      "guideId": "helper-work-availability",
      "href": "/dashboard?tab=availability"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open your helper calendar",
        "type": "terminal"
      },
      {
        "id": "view",
        "label": "Open the booking requests view",
        "type": "step"
      },
      {
        "id": "review",
        "label": "Review a pending request",
        "type": "step"
      },
      {
        "id": "respond",
        "label": "Confirm, decline, or propose a new time?",
        "type": "decision"
      },
      {
        "id": "confirm",
        "label": "Confirm and add to calendar",
        "type": "step"
      },
      {
        "id": "decline",
        "label": "Decline the request",
        "type": "step"
      },
      {
        "id": "propose",
        "label": "Propose a different time",
        "type": "step"
      },
      {
        "id": "work",
        "label": "Work the job via My Jobs",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Booking resolved",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "view"
      },
      {
        "from": "view",
        "to": "review"
      },
      {
        "from": "review",
        "to": "respond"
      },
      {
        "from": "respond",
        "to": "confirm",
        "label": "Confirm"
      },
      {
        "from": "respond",
        "to": "decline",
        "label": "Decline"
      },
      {
        "from": "respond",
        "to": "propose",
        "label": "Propose time"
      },
      {
        "from": "confirm",
        "to": "work"
      },
      {
        "from": "propose",
        "to": "work"
      },
      {
        "from": "decline",
        "to": "done"
      },
      {
        "from": "work",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Open your helper calendar. 2. Open the booking requests view. 3. Review each pending booking request. 4. Decide: confirm the request, decline it, or propose a different time. 5. Confirmed bookings are added to your calendar; declined requests are resolved. 6. Work the confirmed jobs through My Jobs.",
  "steps": [
    {
      "id": "helper-work-assigned-jobs-s1",
      "title": "Open your helper calendar",
      "body": "Open /calendar while in helper mode. The calendar shows your helper schedule, including any booking-request view for incoming requests.",
      "expectedResult": "Your calendar loads with the booking requests view available.",
      "screenshots": [
        {
          "id": "helper-work-assigned-jobs-s1-desktop",
          "viewport": "desktop",
          "screen": "/calendar",
          "state": "Helper calendar, booking requests view, synthetic data, light mode",
          "alt": "Helper calendar showing the booking requests view selector",
          "caption": "The helper calendar, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-assigned-jobs-s1-mobile",
          "viewport": "mobile",
          "screen": "/calendar",
          "state": "Helper calendar, synthetic data, light mode",
          "alt": "Helper calendar on a phone screen",
          "caption": "The helper calendar, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-assigned-jobs-s2",
      "title": "Review a pending booking request",
      "body": "In the Pending Booking Requests panel, each request card shows the customer, the requested date and time, the service, and any notes. Review the details before acting.",
      "expectedResult": "You can read the full request details on the card.",
      "screenshots": [
        {
          "id": "helper-work-assigned-jobs-s2-desktop",
          "viewport": "desktop",
          "screen": "/calendar",
          "state": "Pending Booking Requests panel with two synthetic requests, light mode",
          "alt": "Pending Booking Requests panel with request cards showing customer, time, and service",
          "caption": "Pending booking requests, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-assigned-jobs-s2-mobile",
          "viewport": "mobile",
          "screen": "/calendar",
          "state": "Pending Booking Requests panel with one synthetic request, light mode",
          "alt": "Pending booking request card on a phone screen",
          "caption": "Pending booking requests, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-assigned-jobs-s3",
      "title": "Confirm, decline, or propose a new time",
      "body": "On the request card, choose Confirm (\"Confirm and add to calendar\") to accept the booking, Decline to turn it down, or \"Propose different time\" to counter with another slot. Confirming adds the booking to your calendar.",
      "expectedResult": "\"Booking confirmed!\" appears, or the request moves to declined or counter-proposed.",
      "screenshots": [
        {
          "id": "helper-work-assigned-jobs-s3-desktop",
          "viewport": "desktop",
          "screen": "/calendar",
          "state": "Booking request card with action buttons, synthetic data, light mode",
          "alt": "Booking request card with Confirm, Propose different time, and Decline buttons",
          "caption": "Responding to a booking request, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-assigned-jobs-s3-mobile",
          "viewport": "mobile",
          "screen": "/calendar",
          "state": "Booking request card with action buttons, synthetic data, light mode",
          "alt": "Request actions on a phone screen",
          "caption": "Responding to a booking request, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-assigned-jobs-s4",
      "title": "Work the job via My Jobs",
      "body": "Open My Jobs (/my-jobs) to see your assigned and won jobs with their statuses. Message the customer from the job when you need to coordinate, and keep the status accurate as work progresses.",
      "expectedResult": "Your jobs list shows the confirmed work with correct statuses.",
      "screenshots": [
        {
          "id": "helper-work-assigned-jobs-s4-desktop",
          "viewport": "desktop",
          "screen": "/my-jobs",
          "state": "My Jobs page with synthetic jobs, light mode",
          "alt": "My Jobs page showing assigned jobs with status badges",
          "caption": "The My Jobs page, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-assigned-jobs-s4-mobile",
          "viewport": "mobile",
          "screen": "/my-jobs",
          "state": "My Jobs page with synthetic jobs, light mode",
          "alt": "My Jobs page on a phone screen",
          "caption": "The My Jobs page, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "Confirmed bookings appear on your calendar; declined requests are gone from the pending list.",
  "recovery": [
    {
      "problem": "No booking requests appear.",
      "solution": "Check that you are in helper mode and your directory listing is Online. Booking requests only arrive when customers can book you."
    },
    {
      "problem": "You confirmed a booking but cannot make it.",
      "solution": "Message the customer immediately from the job and use the cancellation flow in My Bookings or My Jobs so the customer is not left waiting."
    }
  ],
  "supportContact": "If booking requests do not load, contact OxSteed Support from the /support page.",
  "relatedGuides": [
    "helper-work-availability",
    "helper-work-bid"
  ],
  "siteLinks": [
    {
      "label": "Calendar",
      "href": "/calendar"
    },
    {
      "label": "My Jobs",
      "href": "/my-jobs"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/calendar"
    },
    {
      "type": "screen",
      "ref": "client/src/components/calendar/BookingRequestsPanel.jsx"
    },
    {
      "type": "handler",
      "ref": "GET /api/bookings/incoming"
    },
    {
      "type": "handler",
      "ref": "POST /api/bookings/:bookingId/accept|decline"
    }
  ]
};
