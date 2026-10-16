// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "logistics-organize-campaign",
  "area": "logistics",
  "slug": "organize-a-campaign",
  "title": "Organize a campaign",
  "audiences": [
    "logistics"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Create a pooled logistics campaign draft, submit it for Operations approval, and rally buyers toward the MOQ.",
  "intendedRoles": [
    "Logistics participant (organizer)"
  ],
  "prerequisites": [
    {
      "text": "A signed-in OxSteed account.",
      "href": "/login"
    },
    {
      "text": "A product, a trade lane, and a target minimum quantity (MOQ).",
      "href": "/logistics/campaigns"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "open-organizer",
        "label": "Open the Organizer Dashboard",
        "type": "terminal"
      },
      {
        "id": "new",
        "label": "Choose Start a new campaign",
        "type": "step"
      },
      {
        "id": "draft",
        "label": "Fill in the campaign draft",
        "type": "step"
      },
      {
        "id": "save",
        "label": "Choose Save as draft",
        "type": "step"
      },
      {
        "id": "submit",
        "label": "Submit for Operations approval",
        "type": "step"
      },
      {
        "id": "review",
        "label": "Operations decision?",
        "type": "decision"
      },
      {
        "id": "revise",
        "label": "Revise and resubmit",
        "type": "blocked"
      },
      {
        "id": "approved",
        "label": "Campaign approved and open",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "open-organizer",
        "to": "new"
      },
      {
        "from": "new",
        "to": "draft"
      },
      {
        "from": "draft",
        "to": "save"
      },
      {
        "from": "save",
        "to": "submit"
      },
      {
        "from": "submit",
        "to": "review"
      },
      {
        "from": "review",
        "to": "approved",
        "label": "Approved"
      },
      {
        "from": "review",
        "to": "revise",
        "label": "Revisions requested"
      },
      {
        "from": "review",
        "to": "draft",
        "label": "Rejected"
      },
      {
        "from": "revise",
        "to": "submit"
      }
    ]
  },
  "processMapText": "1. Open the Organizer Dashboard. 2. Choose Start a new campaign. 3. Fill in the campaign draft: title, description, lane, MOQ, dates, and a pricing sketch. 4. Choose Save as draft. 5. Submit the draft for Operations approval. 6. Operations approves, requests revisions, or rejects. If revisions are requested, update the draft and submit again; once approved, the campaign opens to buyers.",
  "steps": [
    {
      "id": "logistics-organize-campaign-s1",
      "title": "Open the Organizer Dashboard",
      "body": "Choose Organizer in the logistics navigation, or open /logistics/organizer directly. The \"Organizer Dashboard\" page shows your stats (\"Campaigns still in motion\", \"Committed units\", \"Handoffs to coordinate\") and an \"Organizer campaigns\" list. The dashboard also surfaces \"Organizer pressure points\" such as \"MOQ momentum gaps\".",
      "expectedResult": "The Organizer Dashboard loads with your campaign list and stats.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/logistics/organizer",
          "state": "Organizer Dashboard, signed in, light mode",
          "alt": "Organizer Dashboard with campaign stats and list",
          "caption": "The Organizer Dashboard, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/logistics/organizer",
          "state": "Organizer Dashboard, signed in, light mode",
          "alt": "Organizer Dashboard on a phone screen",
          "caption": "The Organizer Dashboard, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "logistics-organize-campaign-s2",
      "title": "Start a new campaign draft",
      "body": "Choose \"Start a new campaign\" to open /logistics/campaigns/new, titled \"Start a new campaign\" with the subtitle \"Draft your pooled campaign. Review it and submit it for Operations approval when it is ready.\" Fill in \"Campaign title\" (for example \"2,000 units of solar lanterns\"), \"Description\", \"Trade lane\", \"Minimum quantity (MOQ)\", \"Max participants (optional)\", and the dates: \"Pledge close date\", \"Lock date\", \"Expected ship date\", \"Expected arrival date\". Watch the \"Lane checks\" panel: some lanes show \"Business verification is required to run a campaign on this lane\" or \"Manual compliance approval is required before this campaign can be published\".",
      "expectedResult": "All required fields are filled and no validation errors appear.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/logistics/campaigns/new",
          "state": "New campaign form partially filled, light mode",
          "alt": "New campaign draft form with title, lane, and MOQ fields",
          "caption": "The new campaign draft form, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/logistics/campaigns/new",
          "state": "New campaign form, light mode",
          "alt": "New campaign form on a phone screen",
          "caption": "The new campaign form, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "logistics-organize-campaign-s3",
      "title": "Add the pricing sketch and save the draft",
      "body": "In the \"Pricing sketch\" section enter \"Unit product cost (USD)\", \"Unit freight estimate (USD)\", \"Deposit percentage\", and \"Cancellation policy\". The hint reads \"A rough sketch is enough for the draft. OxSteed computes the landed cost; Operations confirms pricing at review.\" Choose \"Save as draft\" and wait for the \"Draft saved.\" confirmation.",
      "expectedResult": "You see the \"Draft saved.\" confirmation.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/logistics/campaigns/new",
          "state": "Pricing sketch filled, Save as draft about to be chosen, light mode",
          "alt": "Pricing sketch section with Save as draft button",
          "caption": "The pricing sketch and save action, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/logistics/campaigns/new",
          "state": "Pricing sketch filled, light mode",
          "alt": "Pricing sketch on a phone screen",
          "caption": "The pricing sketch, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "logistics-organize-campaign-s4",
      "title": "Submit for Operations approval and track the decision",
      "body": "From the draft or the Organizer Dashboard, submit the campaign for Operations approval. The \"Approval\" panel shows the state: \"Draft\", \"Pending review\", \"Revisions requested\", \"Approved\", or \"Rejected\". If revisions are requested, edit the campaign at /logistics/campaigns/:id/edit and submit again. Once approved, the campaign opens to buyers and appears on the public campaign list.",
      "expectedResult": "The campaign shows \"Pending review\", then \"Approved\" once Operations decides.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/logistics/organizer",
          "state": "Campaign approval panel showing Pending review, light mode",
          "alt": "Approval panel with the Pending review state",
          "caption": "The campaign approval state, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/logistics/organizer",
          "state": "Campaign approval panel, light mode",
          "alt": "Approval state on a phone screen",
          "caption": "The approval state, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The campaign appears on the public campaign list with status Open, and buyers can pledge units toward the MOQ.",
  "recovery": [
    {
      "problem": "The form refuses to save: \"A title is required.\" or \"Choose a trade lane.\"",
      "solution": "Complete the highlighted required fields. The MOQ must be at least 1."
    },
    {
      "problem": "Operations requested revisions.",
      "solution": "Read the revision notes on the approval panel, edit the campaign, and submit again. The approval history is kept on the campaign."
    },
    {
      "problem": "Your lane shows a manual compliance approval requirement.",
      "solution": "Submit the draft anyway; Operations handles the manual approval at review. You cannot publish until it clears."
    }
  ],
  "supportContact": "Campaign review questions: contact support from the in-app support page at /support.",
  "relatedGuides": [
    "logistics-browse",
    "logistics-pledge"
  ],
  "siteLinks": [
    {
      "label": "Organizer Dashboard",
      "href": "/logistics/organizer"
    },
    {
      "label": "Start a new campaign",
      "href": "/logistics/campaigns/new"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/logistics/organizer"
    },
    {
      "type": "route",
      "ref": "/logistics/campaigns/new"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/logistics/OrganizerDashboardPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/logistics/NewCampaignPage.jsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/logistics/campaigns"
    },
    {
      "type": "handler",
      "ref": "POST /api/logistics/campaigns/:id/submit"
    }
  ]
};
