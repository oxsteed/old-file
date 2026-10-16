// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "hiring-compare-bids",
  "area": "hiring",
  "slug": "compare-bids",
  "title": "Compare bids on a job",
  "audiences": [
    "customer",
    "helper"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Compare the bids on your job and accept the right one; or, as a helper, track your own bids.",
  "intendedRoles": [
    "Customer",
    "Helper"
  ],
  "prerequisites": [
    {
      "text": "Be signed in to your OxSteed account.",
      "guideId": "account-signin",
      "href": "/login"
    },
    {
      "text": "Have a job with bids posted.",
      "guideId": "hiring-post-job",
      "href": "/post-job"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open the bids for the job",
        "type": "terminal"
      },
      {
        "id": "list",
        "label": "Review the bid list",
        "type": "step"
      },
      {
        "id": "detail",
        "label": "Open a bid to see details",
        "type": "step"
      },
      {
        "id": "decide",
        "label": "Found the right bid?",
        "type": "decision"
      },
      {
        "id": "accept",
        "label": "Accept the bid",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Bid accepted; job is assigned",
        "type": "terminal"
      },
      {
        "id": "wait",
        "label": "Wait for more bids or decline",
        "type": "blocked"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "list"
      },
      {
        "from": "list",
        "to": "detail"
      },
      {
        "from": "detail",
        "to": "decide"
      },
      {
        "from": "decide",
        "to": "accept",
        "label": "Yes"
      },
      {
        "from": "decide",
        "to": "wait",
        "label": "No"
      },
      {
        "from": "accept",
        "to": "done"
      },
      {
        "from": "wait",
        "to": "list",
        "label": "More bids arrive"
      }
    ]
  },
  "processMapText": "1. On the job detail page, open the \"Bids\" section (or choose \"Review bids\"). 2. Scan the bids: amount, ETA, location, and the helper's message. 3. Choose \"View Bid\" on a bid to open its \"Bid Details\" page. 4. If the bid is right, choose \"Accept Bid\". Helpers can track and manage their own bids on the \"My Bids\" page, including \"Withdraw\". 5. The accepted bid assigns the job to that helper.",
  "steps": [
    {
      "id": "hiring-compare-bids-s1",
      "title": "Open the bids on your job",
      "body": "Open your job (/jobs/:id) and scroll to the \"Bids\" heading. Each bid shows the amount, the ETA, the location, and the helper's message (\"Message\"). Choose \"Review bids\" to focus on the bid list.",
      "expectedResult": "All bids on the job are listed with their amounts and statuses.",
      "screenshots": [
        {
          "id": "hiring-compare-bids-s1-desktop",
          "viewport": "desktop",
          "screen": "/jobs/:id",
          "state": "Job detail, Bids section visible, signed in, light mode",
          "alt": "Bids section on a job detail page",
          "caption": "The Bids section on your job, desktop view.",
          "annotations": []
        },
        {
          "id": "hiring-compare-bids-s1-mobile",
          "viewport": "mobile",
          "screen": "/jobs/:id",
          "state": "Job detail, Bids section visible, signed in, light mode",
          "alt": "Bids section on a phone screen",
          "caption": "The Bids section, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "hiring-compare-bids-s2",
      "title": "Open a bid to read the full details",
      "body": "Choose \"View Bid\" on a bid to open its \"Bid Details\" page (/bids/:bidId). It shows the Amount, ETA, Location, Submitted time, the helper's message, and the \"Next step\" panel. Helpers see the same page for their own bids and can \"Withdraw\" a pending bid (\"Are you sure you want to withdraw this bid?\").",
      "expectedResult": "The full bid detail loads with the helper profile link.",
      "screenshots": [
        {
          "id": "hiring-compare-bids-s2-desktop",
          "viewport": "desktop",
          "screen": "/bids/:bidId",
          "state": "Bid Details page, signed in, light mode",
          "alt": "Bid Details page with amount, ETA, and message",
          "caption": "The Bid Details page, desktop view.",
          "annotations": []
        },
        {
          "id": "hiring-compare-bids-s2-mobile",
          "viewport": "mobile",
          "screen": "/bids/:bidId",
          "state": "Bid Details page, signed in, light mode",
          "alt": "Bid Details page on a phone screen",
          "caption": "The Bid Details page, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "hiring-compare-bids-s3",
      "title": "Accept the winning bid",
      "body": "On the bid or the job detail page, choose \"Accept Bid\". The bid moves to \"Accepted\" and the job is assigned to that helper. The \"Next step\" panel explains: \"This bid has been accepted. Continue through the booking and job workflow.\" Other bids can be declined or left; accepted, rejected, and withdrawn bids remain in history for tracking.",
      "expectedResult": "The bid shows as accepted and the job is assigned to the helper.",
      "screenshots": [
        {
          "id": "hiring-compare-bids-s3-desktop",
          "viewport": "desktop",
          "screen": "/jobs/:id",
          "state": "Bid accepted, signed in, light mode",
          "alt": "Job detail with the accepted bid marked",
          "caption": "The accepted bid on the job.",
          "annotations": []
        },
        {
          "id": "hiring-compare-bids-s3-mobile",
          "viewport": "mobile",
          "screen": "/jobs/:id",
          "state": "Bid accepted, signed in, light mode",
          "alt": "Accepted bid on a phone screen",
          "caption": "The accepted bid, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The accepted bid shows \"Accepted\" and the job moves to its assigned state. Helpers see the same status on the My Bids page (\"My Bids\", \"Track the status of all your bids\").",
  "recovery": [
    {
      "problem": "A bid expired before you accepted it.",
      "solution": "Expired bids show \"This bid has expired.\" Ask the helper to submit a fresh bid, or choose another bid."
    },
    {
      "problem": "A bid needs reconfirmation.",
      "solution": "If you edited the job after the bid arrived, the helper must choose \"Reconfirm my bid\" first; wait for the \"Awaiting reconfirmation\" state to clear."
    }
  ],
  "supportContact": "If a bid is stuck or acceptance fails, contact support from the Help menu or visit /support.",
  "relatedGuides": [
    "hiring-post-job",
    "hiring-manage-jobs",
    "hiring-message",
    "hiring-work-agreements"
  ],
  "siteLinks": [
    {
      "label": "My jobs",
      "href": "/my-jobs"
    },
    {
      "label": "My bids",
      "href": "/my-bids"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/bids/:bidId"
    },
    {
      "type": "route",
      "ref": "/my-bids"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/BidDetailPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/MyBidsPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/JobDetailPage.jsx"
    },
    {
      "type": "handler",
      "ref": "GET /api/bids/job/:jobId, PUT /api/bids/:id (accept/decline), POST /api/bids/:id/withdraw"
    },
    {
      "type": "permission",
      "ref": "Authenticated."
    }
  ]
};
