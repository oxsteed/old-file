// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "logistics-pledge",
  "area": "logistics",
  "slug": "pledge-to-a-campaign",
  "title": "Pledge to a campaign (buyer)",
  "audiences": [
    "logistics"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Commit units to an open logistics campaign so your demand counts toward the minimum order quantity.",
  "intendedRoles": [
    "Logistics participant (buyer)"
  ],
  "prerequisites": [
    {
      "text": "A signed-in OxSteed account.",
      "href": "/login"
    },
    {
      "text": "A campaign you have reviewed. Browse campaigns first.",
      "guideId": "logistics-browse",
      "href": "/logistics/campaigns"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "open-campaign",
        "label": "Open the campaign detail page",
        "type": "terminal"
      },
      {
        "id": "open-join",
        "label": "Open the Join This Campaign panel",
        "type": "step"
      },
      {
        "id": "gated",
        "label": "Lane gating blocks you?",
        "type": "decision"
      },
      {
        "id": "fill",
        "label": "Set quantity, delivery preference, and destination",
        "type": "step"
      },
      {
        "id": "confirm",
        "label": "Choose Confirm Commitment",
        "type": "step"
      },
      {
        "id": "blocked",
        "label": "Lane gating blocked",
        "type": "blocked"
      },
      {
        "id": "joined",
        "label": "Pledge recorded; allocation created",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "open-campaign",
        "to": "open-join"
      },
      {
        "from": "open-join",
        "to": "gated"
      },
      {
        "from": "gated",
        "to": "fill",
        "label": "No"
      },
      {
        "from": "gated",
        "to": "blocked",
        "label": "Yes"
      },
      {
        "from": "fill",
        "to": "confirm"
      },
      {
        "from": "confirm",
        "to": "joined"
      }
    ]
  },
  "processMapText": "1. Open the campaign detail page. 2. Open the Join This Campaign panel. 3. Check whether lane gating applies: verified business context, reseller approval, or manual compliance approval may be required. If you are blocked, the campaign states the reason. 4. Otherwise set your quantity, delivery preference, and destination country. 5. Choose Confirm Commitment. 6. Your pledge is recorded and an allocation tracks your share.",
  "steps": [
    {
      "id": "logistics-pledge-s1",
      "title": "Open the campaign and the join panel",
      "body": "Sign in, then open the campaign from /logistics/campaigns. Scroll to the \"Join This Campaign\" panel. If you have already pledged, the panel shows \"You've already joined this campaign.\" instead of the form.",
      "expectedResult": "The join panel shows \"Quantity to commit\", \"Delivery Preference\", and \"Destination country\" fields.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/logistics/campaigns/:id",
          "state": "Campaign detail, signed in, Join This Campaign panel visible, light mode",
          "alt": "Join This Campaign panel on a campaign detail page",
          "caption": "The Join This Campaign panel, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/logistics/campaigns/:id",
          "state": "Campaign detail, signed in, join panel visible, light mode",
          "alt": "Join This Campaign panel on a phone screen",
          "caption": "The join panel, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "logistics-pledge-s2",
      "title": "Check lane gating before pledging",
      "body": "Read the \"Lane gating\" panel on the campaign page. Some lanes require verified business context, reseller or distributor approval, or manual compliance approval. If your role or destination is blocked, the panel shows the reason, for example \"Verified business context is required for this campaign lane.\" Resolve the requirement before continuing.",
      "expectedResult": "You know whether your account can pledge on this lane, and the reason if not.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/logistics/campaigns/:id",
          "state": "Campaign detail, Lane gating panel visible, light mode",
          "alt": "Lane gating panel with approval requirements",
          "caption": "The Lane gating panel, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/logistics/campaigns/:id",
          "state": "Campaign detail, Lane gating panel visible, light mode",
          "alt": "Lane gating panel on a phone screen",
          "caption": "Lane gating, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "logistics-pledge-s3",
      "title": "Set quantity, delivery preference, and destination",
      "body": "Enter the \"Quantity to commit\" and review the \"Subtotal\" and \"Deposit\". Choose a \"Delivery Preference\": \"Warehouse Pickup\", \"Ship to Me\", or \"Freight Forward\". Set \"Destination country\" and read the \"Cancellation Policy\". Note the warning: \"Committed quantities cannot be reduced after the campaign locks.\"",
      "expectedResult": "The subtotal and deposit update to match your quantity and preference.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/logistics/campaigns/:id",
          "state": "Join panel with quantity and delivery preference filled in, light mode",
          "alt": "Completed join form with subtotal and deposit shown",
          "caption": "A completed pledge form, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/logistics/campaigns/:id",
          "state": "Join panel filled in, light mode",
          "alt": "Completed pledge form on a phone screen",
          "caption": "A completed pledge form, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "logistics-pledge-s4",
      "title": "Choose Confirm Commitment",
      "body": "Choose \"Confirm Commitment\". Your pledge counts toward the campaign MOQ. Open the \"Buyer Dashboard\" at /logistics/buyer to see your participation, or open the allocation detail page at /logistics/allocations/:id to track your share. From the allocation page you can release the allocation if your plans change.",
      "expectedResult": "The campaign shows you as joined, and your allocation appears in the Buyer Dashboard.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/logistics/buyer",
          "state": "Buyer Dashboard after pledging, light mode",
          "alt": "Buyer Dashboard showing the new participation",
          "caption": "The Buyer Dashboard with your pledge, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/logistics/buyer",
          "state": "Buyer Dashboard after pledging, light mode",
          "alt": "Buyer Dashboard on a phone screen",
          "caption": "The Buyer Dashboard, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The campaign page shows \"You've already joined this campaign.\" and your allocation appears under the Buyer Dashboard participation list.",
  "recovery": [
    {
      "problem": "The join panel says your role or destination is blocked for this lane.",
      "solution": "Read the \"Lane gating\" reason shown on the page. Complete business verification, request reseller approval, or contact support for manual compliance approval."
    },
    {
      "problem": "You pledged but the allocation does not appear in the Buyer Dashboard.",
      "solution": "Refresh the page and check /logistics/buyer again. If it still does not appear, contact support at /support with the campaign name."
    }
  ],
  "supportContact": "Pledge or allocation issues: contact support from the in-app support page at /support.",
  "relatedGuides": [
    "logistics-browse",
    "logistics-track-shipments"
  ],
  "siteLinks": [
    {
      "label": "Campaigns",
      "href": "/logistics/campaigns"
    },
    {
      "label": "Buyer Dashboard",
      "href": "/logistics/buyer"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/logistics/campaigns/:id"
    },
    {
      "type": "route",
      "ref": "/logistics/buyer"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/logistics/CampaignDetailPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/logistics/BuyerDashboardPage.jsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/logistics/campaigns/:id/join"
    }
  ]
};
