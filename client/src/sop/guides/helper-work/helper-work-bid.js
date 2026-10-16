// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "helper-work-bid",
  "area": "helper-work",
  "slug": "bid-on-a-job",
  "title": "Bid on a job",
  "audiences": [
    "helper"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Submit a competitive bid on an open job and track it until the customer decides.",
  "intendedRoles": [
    "Helper"
  ],
  "prerequisites": [
    {
      "text": "Sign in with completed helper onboarding (bidding is gated server-side).",
      "href": "/login"
    },
    {
      "text": "Find a job you want to win.",
      "guideId": "helper-work-find-work",
      "href": "/jobs"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open the job detail",
        "type": "terminal"
      },
      {
        "id": "form",
        "label": "Fill the bid form",
        "type": "step"
      },
      {
        "id": "submit",
        "label": "Choose Submit Bid",
        "type": "step"
      },
      {
        "id": "track",
        "label": "Track the bid in My Bids",
        "type": "step"
      },
      {
        "id": "decision",
        "label": "Customer accepts, rejects, or ignores?",
        "type": "decision"
      },
      {
        "id": "win",
        "label": "Accepted: start the work",
        "type": "terminal"
      },
      {
        "id": "adjust",
        "label": "Edit or withdraw while pending",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Bid resolved",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
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
        "to": "decision"
      },
      {
        "from": "decision",
        "to": "win",
        "label": "Accepted"
      },
      {
        "from": "decision",
        "to": "adjust",
        "label": "Still pending"
      },
      {
        "from": "adjust",
        "to": "track"
      },
      {
        "from": "decision",
        "to": "done",
        "label": "Rejected"
      }
    ]
  },
  "processMapText": "1. Open the job detail page. 2. Fill in the bid form with your price, estimated hours, and message. 3. Choose Submit Bid. 4. Track the bid in My Bids. 5. If the customer accepts, start the work. If it is still pending, edit or withdraw the bid. If it is rejected, the bid is resolved.",
  "steps": [
    {
      "id": "helper-work-bid-s1",
      "title": "Open the job detail page",
      "body": "From /jobs, choose a job card to open /jobs/:id. Read the full description, photos, and budget before bidding. If the job is a poor fit, keep browsing instead of bidding.",
      "expectedResult": "The job detail loads with the Submit Your Bid form visible (for signed-in, onboarded helpers).",
      "screenshots": [
        {
          "id": "helper-work-bid-s1-desktop",
          "viewport": "desktop",
          "screen": "/jobs/:id",
          "state": "Job detail with synthetic data, bid form visible, light mode",
          "alt": "Job detail page with the Submit Your Bid form below the description",
          "caption": "A job detail page, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-bid-s1-mobile",
          "viewport": "mobile",
          "screen": "/jobs/:id",
          "state": "Job detail with synthetic data, bid form visible, light mode",
          "alt": "Job detail page on a phone screen",
          "caption": "A job detail page, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-bid-s2",
      "title": "Fill in the bid form",
      "body": "In the Submit Your Bid form, enter Your price, your Estimated Hours, and a message under \"Why you are the right person for this job\" (up to 500 characters). Describe your relevant experience, availability, and approach.",
      "expectedResult": "Price, hours, and message are entered with no validation errors.",
      "screenshots": [
        {
          "id": "helper-work-bid-s2-desktop",
          "viewport": "desktop",
          "screen": "/jobs/:id",
          "state": "Bid form filled with synthetic data, light mode",
          "alt": "Submit Your Bid form filled in with price, hours, and message",
          "caption": "The filled bid form, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-bid-s2-mobile",
          "viewport": "mobile",
          "screen": "/jobs/:id",
          "state": "Bid form filled with synthetic data, light mode",
          "alt": "Bid form filled in on a phone screen",
          "caption": "The filled bid form, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-bid-s3",
      "title": "Submit the bid",
      "body": "Choose Submit Bid. The button shows Submitting while the bid posts. Your bid appears in the job bids list and on your My Bids page.",
      "expectedResult": "A success confirmation appears and the bid shows as Pending in My Bids.",
      "screenshots": [
        {
          "id": "helper-work-bid-s3-desktop",
          "viewport": "desktop",
          "screen": "/jobs/:id",
          "state": "Bid submitted, confirmation shown, light mode",
          "alt": "Job page after submitting the bid with a confirmation message",
          "caption": "Bid submitted, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-bid-s3-mobile",
          "viewport": "mobile",
          "screen": "/jobs/:id",
          "state": "Bid submitted, confirmation shown, light mode",
          "alt": "Confirmation after submitting a bid on a phone screen",
          "caption": "Bid submitted, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-bid-s4",
      "title": "Track, edit, or withdraw the bid",
      "body": "Open My Bids (/my-bids) to track all your bids with status filters (all, pending, accepted, rejected, withdrawn). Choose View Bid for the bid detail. While a bid is pending, use Edit to change the price, hours, or message (Save changes), or Withdraw to pull the bid after the confirmation prompt.",
      "expectedResult": "The bid shows its current status; edits save or the bid is marked Withdrawn.",
      "screenshots": [
        {
          "id": "helper-work-bid-s4-desktop",
          "viewport": "desktop",
          "screen": "/my-bids",
          "state": "My Bids page with synthetic bids, light mode",
          "alt": "My Bids page with status filters and bid cards showing Withdraw and Edit controls",
          "caption": "The My Bids page, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-bid-s4-mobile",
          "viewport": "mobile",
          "screen": "/my-bids",
          "state": "My Bids page with synthetic bids, light mode",
          "alt": "My Bids page on a phone screen",
          "caption": "The My Bids page, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The bid appears in My Bids with status Pending, and later updates to Accepted or Rejected.",
  "recovery": [
    {
      "problem": "The bid form does not appear on the job page.",
      "solution": "Sign in and complete helper onboarding. Guests and non-onboarded accounts cannot see the bid form."
    },
    {
      "problem": "Submit Bid fails with a validation error.",
      "solution": "Enter a price greater than 0 and hours between 0 and 10,000, and keep the message under the character limit shown."
    }
  ],
  "supportContact": "If a submitted bid never appears in My Bids, contact OxSteed Support from the /support page.",
  "relatedGuides": [
    "helper-work-find-work",
    "helper-work-quotes",
    "helper-work-assigned-jobs"
  ],
  "siteLinks": [
    {
      "label": "Find work",
      "href": "/jobs"
    },
    {
      "label": "My Bids",
      "href": "/my-bids"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/jobs/:id"
    },
    {
      "type": "route",
      "ref": "/my-bids"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/JobDetailPage.jsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/bids"
    }
  ]
};
