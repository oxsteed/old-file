// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "logistics-refund-requests",
  "area": "logistics",
  "slug": "request-logistics-refund",
  "title": "Request logistics refunds",
  "audiences": [
    "logistics"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Submit a logistics refund case for operator review and track it to completion.",
  "intendedRoles": [
    "Logistics participant (buyer)"
  ],
  "prerequisites": [
    {
      "text": "A signed-in OxSteed account.",
      "href": "/login"
    },
    {
      "text": "A purchase order to attach the refund to, ideally with a related claim.",
      "guideId": "logistics-claims",
      "href": "/logistics/buyer"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "open-finance",
        "label": "Open the Logistics Finance page",
        "type": "terminal"
      },
      {
        "id": "panel",
        "label": "Find the Refund Requests panel",
        "type": "step"
      },
      {
        "id": "form",
        "label": "Fill in Request a Refund Review",
        "type": "step"
      },
      {
        "id": "submit",
        "label": "Choose Submit Refund Case",
        "type": "step"
      },
      {
        "id": "track",
        "label": "Track the case status",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Refund processed or rejected with a reason",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "open-finance",
        "to": "panel"
      },
      {
        "from": "panel",
        "to": "form"
      },
      {
        "from": "form",
        "to": "submit"
      },
      {
        "from": "submit",
        "to": "track"
      },
      {
        "from": "track",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Open the Logistics Finance page. 2. Find the \"Refund Requests\" panel. Note: there is no standalone refund page; requesting and tracking happen here. 3. Fill in the \"Request a Refund Review\" form: purchase order, reason, amount, and notes. 4. Choose \"Submit Refund Case\" and wait for the \"Refund case submitted for review.\" confirmation. 5. Track the case through its statuses: Proposed, Approved, Executing, Processed, Failed, Rejected, or Expired. 6. Refund approval is a dual-admin review: one admin proposes and a different admin approves.",
  "steps": [
    {
      "id": "logistics-refund-requests-s1",
      "title": "Open the Logistics Finance page",
      "body": "Choose Finance in the logistics navigation, or open /logistics/finance directly. The page is titled \"Logistics Finance\" with the subtitle \"Overview of committed value, fees, and order economics.\" The KPI strip shows \"Total Committed\", \"Deposits Paid\", \"Orders\", and \"In Transit\".",
      "expectedResult": "The Finance page loads with your order and spend overview.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/logistics/finance",
          "state": "Finance page with KPI strip, signed in, light mode",
          "alt": "Logistics Finance page with the KPI strip",
          "caption": "The Logistics Finance page, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/logistics/finance",
          "state": "Finance page, signed in, light mode",
          "alt": "Finance page on a phone screen",
          "caption": "The Finance page, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "logistics-refund-requests-s2",
      "title": "Open the Refund Requests panel",
      "body": "Scroll to the \"Refund Requests\" panel. It lists your existing cases in a table with columns Reference, Amount, Method (Stripe or OxSteed Credit), Reason, Proposed by, Status, and Created. A \"Filter by status\" dropdown filters the list; \"All statuses\" shows everything. There is no separate refunds route; this panel is the whole surface.",
      "expectedResult": "You see your existing refund cases, or \"No refund cases submitted yet.\"",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/logistics/finance",
          "state": "Refund Requests panel with cases, light mode",
          "alt": "Refund Requests panel with the case table",
          "caption": "The Refund Requests panel, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/logistics/finance",
          "state": "Refund Requests panel, light mode",
          "alt": "Refund cases on a phone screen",
          "caption": "The Refund Requests panel, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "logistics-refund-requests-s3",
      "title": "Fill in Request a Refund Review",
      "body": "Open the \"Request a Refund Review\" form. Choose the \"Purchase Order\" (\"— Select order —\"), enter the \"Refund Reason\", the \"Requested Amount (USD)\", and \"Notes\" explaining the situation. Link the related claim reference in the notes when one exists.",
      "expectedResult": "The form is complete with a selected order, reason, amount, and notes.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/logistics/finance",
          "state": "Refund review form filled in, light mode",
          "alt": "Request a Refund Review form",
          "caption": "The refund review form, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/logistics/finance",
          "state": "Refund review form, light mode",
          "alt": "Refund form on a phone screen",
          "caption": "The refund form, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "logistics-refund-requests-s4",
      "title": "Submit and track the case",
      "body": "Choose \"Submit Refund Case\" and wait for the confirmation \"Refund case submitted for review.\" The case appears in the table with status \"Proposed\". Dual-admin review applies: one admin proposes, a different admin approves with fresh authentication, then the refund is executed. You cannot approve your own proposal: the page blocks self-approval with \"You proposed this refund. A different admin must approve it.\" Track the case as it moves to \"Approved\", \"Executing\", \"Processed\", or \"Rejected\".",
      "expectedResult": "The new case is listed with status \"Proposed\".",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/logistics/finance",
          "state": "Refund case submitted, status Proposed, light mode",
          "alt": "New refund case with Proposed status",
          "caption": "A submitted refund case, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/logistics/finance",
          "state": "Refund case submitted, light mode",
          "alt": "Submitted case on a phone screen",
          "caption": "A submitted case, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The refund case appears in the Refund Requests table with status \"Proposed\", and you saw the \"Refund case submitted for review.\" confirmation.",
  "recovery": [
    {
      "problem": "The submit button does nothing or shows an error.",
      "solution": "Check that a purchase order is selected and the amount is filled in. Refresh and submit once; duplicate submissions are blocked server-side."
    },
    {
      "problem": "The case was rejected.",
      "solution": "Read the rejection reason on the case, add missing evidence or correct the amount, and submit a new case."
    }
  ],
  "supportContact": "Refund questions: contact support from the in-app support page at /support.",
  "relatedGuides": [
    "logistics-claims",
    "logistics-confirm-payments"
  ],
  "siteLinks": [
    {
      "label": "Finance",
      "href": "/logistics/finance"
    },
    {
      "label": "Buyer Dashboard",
      "href": "/logistics/buyer"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/logistics/finance"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/logistics/LogisticsFinancePage.jsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/logistics/refund-cases"
    },
    {
      "type": "handler",
      "ref": "GET /api/logistics/refund-cases"
    }
  ]
};
