// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "business-work-select",
  "area": "business-work",
  "slug": "select-and-switch-businesses",
  "title": "Select and switch between businesses",
  "audiences": [
    "business"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Move between every business you own or manage without losing your place.",
  "intendedRoles": [
    "Business owner",
    "Business manager",
    "Business representative"
  ],
  "prerequisites": [
    {
      "text": "Sign in. You need at least one business you own or have been invited to.",
      "href": "/login"
    },
    {
      "text": "Set up your business first if you have none yet.",
      "guideId": "business-work-setup",
      "href": "/consulting-intake"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open the business hub",
        "type": "terminal"
      },
      {
        "id": "switcher",
        "label": "Use the Business switcher",
        "type": "step"
      },
      {
        "id": "pick",
        "label": "Pick the business",
        "type": "step"
      },
      {
        "id": "invite",
        "label": "Have a team invitation?",
        "type": "decision"
      },
      {
        "id": "accept",
        "label": "Accept or decline the invitation",
        "type": "step"
      },
      {
        "id": "work",
        "label": "Work in the business workspace",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Switched",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "switcher"
      },
      {
        "from": "switcher",
        "to": "pick"
      },
      {
        "from": "pick",
        "to": "invite"
      },
      {
        "from": "invite",
        "to": "accept",
        "label": "Yes"
      },
      {
        "from": "invite",
        "to": "work",
        "label": "No"
      },
      {
        "from": "accept",
        "to": "work"
      },
      {
        "from": "work",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Open the business hub. 2. Use the Business switcher at the top. 3. Pick the business you want to work in. 4. If you have a team invitation to another business, accept or decline it in the Team tab. 5. Work in the selected business workspace. 6. Switch again any time from the same switcher.",
  "steps": [
    {
      "id": "business-work-select-s1",
      "title": "Open the business hub",
      "body": "Open /business-hub. The hub shows the current business workspace with its tabs (Overview, Clients, Services, Schedule, Invoices, Team, Hiring, and more depending on your business type).",
      "expectedResult": "The business hub loads with a business selected.",
      "screenshots": [
        {
          "id": "business-work-select-s1-desktop",
          "viewport": "desktop",
          "screen": "/business-hub",
          "state": "Business hub with synthetic business, light mode",
          "alt": "Business hub with the Business switcher and workspace tabs",
          "caption": "The business hub, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Business switcher",
              "locator": ".bh-switcher select"
            },
            {
              "n": 2,
              "label": "Workspace tabs",
              "locator": ".bh-tabs"
            }
          ]
        },
        {
          "id": "business-work-select-s1-mobile",
          "viewport": "mobile",
          "screen": "/business-hub",
          "state": "Business hub with synthetic business, light mode",
          "alt": "Business hub on a phone screen",
          "caption": "The business hub, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "business-work-select-s2",
      "title": "Use the Business switcher",
      "body": "At the top of the hub, the Business switcher is a dropdown listing every business you own or manage. Each entry shows the business name and, for non-owners, a role tag such as Manager or Representative.",
      "expectedResult": "The dropdown lists all your businesses with the correct roles.",
      "screenshots": [
        {
          "id": "business-work-select-s2-desktop",
          "viewport": "desktop",
          "screen": "/business-hub",
          "state": "Business switcher dropdown open, synthetic businesses, light mode",
          "alt": "Business switcher dropdown open showing three businesses with role tags",
          "caption": "The Business switcher, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Business switcher dropdown",
              "locator": ".bh-switcher select"
            }
          ]
        },
        {
          "id": "business-work-select-s2-mobile",
          "viewport": "mobile",
          "screen": "/business-hub",
          "state": "Business switcher open, synthetic businesses, light mode",
          "alt": "Business switcher on a phone screen",
          "caption": "The Business switcher, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "business-work-select-s3",
      "title": "Switch and accept invitations",
      "body": "Pick a business in the switcher; the hub reloads that workspace and its tabs. If someone invited you to their team, the Team tab shows Pending Invitations with Accept and Decline. Accepting adds their business to your switcher.",
      "expectedResult": "The workspace shows the selected business; accepted invitations appear in the switcher.",
      "screenshots": [
        {
          "id": "business-work-select-s3-desktop",
          "viewport": "desktop",
          "screen": "/business-hub?tab=team",
          "state": "Team tab with a synthetic pending invitation, light mode",
          "alt": "Team tab Pending Invitations section with Accept and Decline buttons",
          "caption": "Accepting a team invitation, desktop view.",
          "annotations": []
        },
        {
          "id": "business-work-select-s3-mobile",
          "viewport": "mobile",
          "screen": "/business-hub?tab=team",
          "state": "Team tab with a synthetic pending invitation, light mode",
          "alt": "Pending invitation on a phone screen",
          "caption": "Accepting a team invitation, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The hub header shows the selected business and your role, and every tab reflects that business.",
  "recovery": [
    {
      "problem": "A business is missing from the switcher.",
      "solution": "Check whether you were invited: open the Team tab and look under Pending Invitations. Invitations you declined are gone; ask the owner to re-invite you."
    },
    {
      "problem": "The hub says you have no businesses.",
      "solution": "Use the + Add Business button to start a new business, or ask an owner to invite you to their team."
    }
  ],
  "supportContact": "If switching shows the wrong business data, contact OxSteed Support from the /support page.",
  "relatedGuides": [
    "business-work-setup",
    "business-work-team-access"
  ],
  "siteLinks": [
    {
      "label": "Business hub",
      "href": "/business-hub"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/business-hub"
    },
    {
      "type": "route",
      "ref": "/business/:businessId/workspace"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/BusinessHubPage.jsx (business switcher)"
    },
    {
      "type": "handler",
      "ref": "GET /api/businesses/managed"
    }
  ]
};
