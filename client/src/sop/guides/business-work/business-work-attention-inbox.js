// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "business-work-attention-inbox",
  "area": "business-work",
  "slug": "work-the-attention-inbox",
  "title": "Work the attention inbox",
  "audiences": [
    "business"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Clear every item that needs your attention across all your businesses in one place.",
  "intendedRoles": [
    "Business owner",
    "Business manager"
  ],
  "prerequisites": [
    {
      "text": "Sign in as a business owner (or manager with access). The dashboard renders the business owner view in business_owner mode.",
      "href": "/login"
    },
    {
      "text": "Own or manage at least one business.",
      "guideId": "business-work-select",
      "href": "/business-hub"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open your owner dashboard",
        "type": "terminal"
      },
      {
        "id": "check",
        "label": "Check the Needs attention card",
        "type": "step"
      },
      {
        "id": "empty",
        "label": "Zero items?",
        "type": "decision"
      },
      {
        "id": "open",
        "label": "Open the Attention inbox",
        "type": "step"
      },
      {
        "id": "work",
        "label": "Work each task (open the full page or act inline)",
        "type": "step"
      },
      {
        "id": "return",
        "label": "Back to attention for the next item",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Inbox clear",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "check"
      },
      {
        "from": "check",
        "to": "empty"
      },
      {
        "from": "empty",
        "to": "done",
        "label": "Yes"
      },
      {
        "from": "empty",
        "to": "open",
        "label": "No"
      },
      {
        "from": "open",
        "to": "work"
      },
      {
        "from": "work",
        "to": "return"
      },
      {
        "from": "return",
        "to": "work"
      },
      {
        "from": "return",
        "to": "done",
        "label": "All resolved"
      }
    ]
  },
  "processMapText": "1. Open your business owner dashboard. 2. Check the Needs attention card for the open item count. 3. If it is zero, you are done. Otherwise open the Attention inbox. 4. Work each task: open its full page or act inline. 5. Go back to attention for the next item. 6. When every item is resolved, the inbox is clear.",
  "steps": [
    {
      "id": "business-work-attention-inbox-s1",
      "title": "Open your owner dashboard",
      "body": "Open /dashboard in business_owner mode. The dashboard aggregates every business you own or manage into per-business cards plus a Needs attention card with the open item count.",
      "expectedResult": "The dashboard loads with the Needs attention card showing a count.",
      "screenshots": [
        {
          "id": "business-work-attention-inbox-s1-desktop",
          "viewport": "desktop",
          "screen": "/dashboard",
          "state": "Business owner dashboard, synthetic businesses, 3 open items, light mode",
          "alt": "Business owner dashboard with the Needs attention card highlighted",
          "caption": "The owner dashboard, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Needs attention card",
              "locator": "button[aria-haspopup=\"dialog\"]"
            }
          ]
        },
        {
          "id": "business-work-attention-inbox-s1-mobile",
          "viewport": "mobile",
          "screen": "/dashboard",
          "state": "Business owner dashboard, synthetic businesses, 3 open items, light mode",
          "alt": "Owner dashboard on a phone screen",
          "caption": "The owner dashboard, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "business-work-attention-inbox-s2",
      "title": "Open the Attention inbox",
      "body": "Choose the Needs attention card. The Attention inbox dialog opens (\"Every open item across your businesses, in one place.\"), listing every open item. The page behind stays mounted, so your scroll position and business selection are preserved.",
      "expectedResult": "The Attention inbox dialog opens with the item list.",
      "screenshots": [
        {
          "id": "business-work-attention-inbox-s2-desktop",
          "viewport": "desktop",
          "screen": "/dashboard",
          "state": "Attention inbox dialog open with synthetic items, light mode",
          "alt": "Attention inbox dialog with the open item list",
          "caption": "The Attention inbox, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Attention inbox title",
              "locator": ".attention-modal__title"
            },
            {
              "n": 2,
              "label": "Open items list",
              "locator": ".attention-list"
            }
          ]
        },
        {
          "id": "business-work-attention-inbox-s2-mobile",
          "viewport": "mobile",
          "screen": "/dashboard",
          "state": "Attention inbox dialog open with synthetic items, light mode",
          "alt": "Attention inbox on a phone screen",
          "caption": "The Attention inbox, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "business-work-attention-inbox-s3",
      "title": "Work each item",
      "body": "Choose an item to open its task view. Work it inline, or choose Open full page to handle it in its own page. When you finish, choose Back to attention to return to the list and pick the next item. Resolved tasks leave the list.",
      "expectedResult": "Each worked item resolves and drops off the list.",
      "screenshots": [
        {
          "id": "business-work-attention-inbox-s3-desktop",
          "viewport": "desktop",
          "screen": "/dashboard",
          "state": "Attention task view open, synthetic data, light mode",
          "alt": "Attention task view with Open full page and Back to attention controls",
          "caption": "Working an attention item, desktop view.",
          "annotations": []
        },
        {
          "id": "business-work-attention-inbox-s3-mobile",
          "viewport": "mobile",
          "screen": "/dashboard",
          "state": "Attention task view open, synthetic data, light mode",
          "alt": "Attention task view on a phone screen",
          "caption": "Working an attention item, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The Needs attention count drops to zero and the inbox shows no open items.",
  "recovery": [
    {
      "problem": "The count does not drop after you worked an item.",
      "solution": "Close and reopen the inbox; the count refreshes from the server. If an item persists, open its full page to see what is still incomplete."
    },
    {
      "problem": "You see \"Access revoked\" on a task.",
      "solution": "Your access to that business changed. Ask the business owner to re-grant your role."
    }
  ],
  "supportContact": "If the attention inbox fails to load, contact OxSteed Support from the /support page.",
  "relatedGuides": [
    "business-work-select",
    "business-work-invoices"
  ],
  "siteLinks": [
    {
      "label": "Owner dashboard",
      "href": "/dashboard"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/dashboard (business_owner mode)"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/BusinessOwnerDashboard.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/components/attention/AttentionModal.jsx"
    },
    {
      "type": "handler",
      "ref": "GET /api/businesses/attention"
    }
  ]
};
