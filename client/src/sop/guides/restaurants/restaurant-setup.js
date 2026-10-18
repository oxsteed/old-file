// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "restaurant-setup",
  "area": "restaurants",
  "slug": "restaurant-setup",
  "title": "Set up a restaurant (merchant onboarding)",
  "audiences": [
    "restaurant"
  ],
  "revision": 4,
  "availability": "supported",
  "conditions": [],
  "goal": "Create a restaurant on OxSteed, finish the setup checklist, fund the credit reserve if needed, and go live for customer ordering.",
  "intendedRoles": [
    "Restaurant owner",
    "Restaurant manager"
  ],
  "prerequisites": [
    {
      "text": "Sign in to your OxSteed account.",
      "href": "/login"
    },
    {
      "text": "Have your restaurant name, address, currency, and contact details ready."
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "open",
        "label": "Open the restaurant dashboard",
        "type": "terminal"
      },
      {
        "id": "create",
        "label": "Add your restaurant",
        "type": "step"
      },
      {
        "id": "checklist",
        "label": "Work the setup checklist",
        "type": "step"
      },
      {
        "id": "complete",
        "label": "All setup steps done?",
        "type": "decision"
      },
      {
        "id": "fund",
        "label": "Fund the credit reserve (if approval requires it)",
        "type": "step"
      },
      {
        "id": "golive",
        "label": "Go live from Settings",
        "type": "step"
      },
      {
        "id": "live",
        "label": "Restaurant accepting orders",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "open",
        "to": "create"
      },
      {
        "from": "create",
        "to": "checklist"
      },
      {
        "from": "checklist",
        "to": "complete"
      },
      {
        "from": "complete",
        "to": "fund",
        "label": "Yes"
      },
      {
        "from": "complete",
        "to": "checklist",
        "label": "No, use Fix"
      },
      {
        "from": "fund",
        "to": "golive"
      },
      {
        "from": "golive",
        "to": "live"
      }
    ]
  },
  "processMapText": "Open the restaurant dashboard at /restaurants/merchant and add your restaurant with the \"Create restaurant\" form. Work through the \"Setup checklist\" until every step is complete, using \"Fix\" on any incomplete step. If the platform credit approval requires it, fund your credit reserve from the funding panel. Then open the Settings tab and choose \"Go live\" so customers can order.",
  "steps": [
    {
      "id": "restaurant-setup-s1",
      "title": "Open the restaurant dashboard",
      "body": "Open /restaurants/merchant. The page is titled \"Restaurant dashboard\" with the subtitle \"Run online and in-store ordering for your restaurant.\" If you already manage restaurants, choose one from \"Select restaurant\"; otherwise continue to the creation form.",
      "expectedResult": "The restaurant dashboard loads, either with your restaurant list or the \"Add your restaurant\" form.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/merchant",
          "state": "Restaurant dashboard with restaurant list, light mode",
          "alt": "Restaurant dashboard listing the restaurants you manage",
          "caption": "The restaurant dashboard, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/merchant",
          "state": "Restaurant dashboard with restaurant list, light mode",
          "alt": "Restaurant dashboard on a phone screen",
          "caption": "The restaurant dashboard, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-setup-s2",
      "title": "Create the restaurant",
      "body": "In the \"Add your restaurant\" form, enter the \"Restaurant name\", \"Description\", \"Cuisines (comma separated)\", \"Phone\", \"Street\", \"City\", \"State / Region\", \"ZIP / Postal code\", \"Country (2 letters)\", \"Currency\", and \"Latitude\" / \"Longitude\". Choose \"Create restaurant\".",
      "expectedResult": "You see \"Restaurant created. Build your menu, then go live.\" and the new restaurant appears under \"Select restaurant\".",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/merchant",
          "state": "Add your restaurant form, light mode",
          "alt": "The add restaurant form with its fields",
          "caption": "The restaurant creation form, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/merchant",
          "state": "Add your restaurant form, light mode",
          "alt": "The add restaurant form on a phone screen",
          "caption": "The restaurant creation form, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-setup-s3",
      "title": "Work the setup checklist",
      "body": "On the Home tab, the \"Setup checklist\" shows \"{{done}} of {{total}} steps complete\". Open \"Continue setup guide\" and use \"Fix\" next to any incomplete step until the checklist reports \"All setup steps are done, you can go live from Settings.\"",
      "expectedResult": "Every setup step shows complete and the readiness message appears.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/merchant",
          "state": "Setup checklist with incomplete steps, light mode",
          "alt": "Setup checklist with per-step Fix buttons",
          "caption": "The setup checklist, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/merchant",
          "state": "Setup checklist with incomplete steps, light mode",
          "alt": "Setup checklist on a phone screen",
          "caption": "The setup checklist, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-setup-s4",
      "title": "Fund the credit reserve if approval requires it",
      "body": "Open the Payouts tab. Expand Credit reserve & exposure to review the reserve balance and access Buy credit reserve. If the platform credit approval is not yet funded, the \"Fund your credit reserve\" panel appears: \"Your approval is almost complete. Fund your OxSteed Credit reserve to start issuing restaurant credit.\" Fund by card through the reserve purchase panel, or enter \"Amount you sent\" plus \"Proof of payment\" (a \"Payment reference (optional)\" also helps) and choose \"Submit for verification\".",
      "expectedResult": "You see \"Funding proof submitted for review.\" and the funding status moves toward funded.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/merchant",
          "state": "Fund your credit reserve panel, light mode",
          "alt": "Credit reserve funding panel with proof fields",
          "caption": "Funding the credit reserve, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Review the reserve before buying credit",
              "locator": ".fd-finance-disclosure > summary"
            }
          ]
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/merchant",
          "state": "Fund your credit reserve panel, light mode",
          "alt": "Credit reserve funding panel on a phone screen",
          "caption": "Funding the credit reserve, mobile view.",
          "annotations": [
            {
              "n": 1,
              "label": "Review the reserve before buying credit",
              "locator": ".fd-finance-disclosure > summary"
            }
          ]
        }
      ]
    },
    {
      "id": "restaurant-setup-s5",
      "title": "Go live from Settings",
      "body": "Open the \"Settings\" tab, then the \"Ordering\" section (\"Take the restaurant live and control where guests can order.\"). Choose \"Go live\" (or \"Resume orders\" if ordering was paused). Confirm the \"At a glance\" chips read \"Online ordering on\" and \"In-store on\".",
      "expectedResult": "The Home tab shows \"You are accepting orders\" and customers can see the restaurant at /food.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/merchant",
          "state": "Settings tab ordering section, light mode",
          "alt": "Settings tab with the Ordering section and Go live button",
          "caption": "Going live from Settings, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/merchant",
          "state": "Settings tab ordering section, light mode",
          "alt": "Settings tab on a phone screen",
          "caption": "Going live from Settings, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The Home tab shows \"You are accepting orders\" and the restaurant appears in the customer directory at /food.",
  "recovery": [
    {
      "problem": "The restaurant is still not visible to customers after going live.",
      "solution": "Check the Home tab alerts: draft menu items must be published (see the menus guide), and the \"At a glance\" chips must show \"Online ordering on\"."
    },
    {
      "problem": "The \"Create restaurant\" form fails.",
      "solution": "You see \"Could not create the restaurant.\" Verify the \"Country (2 letters)\" and \"Currency\" fields are filled correctly, then retry."
    },
    {
      "problem": "A setup checklist step keeps showing as incomplete.",
      "solution": "Choose \"Fix\" on that step and complete the linked task (usually adding menu items or setting hours)."
    }
  ],
  "supportContact": "For onboarding help, use the in-app support page at /support.",
  "relatedGuides": [
    "restaurant-screen-control",
    "restaurant-menus",
    "restaurant-store-settings",
    "financial-restaurant-credit"
  ],
  "siteLinks": [
    {
      "label": "Restaurant dashboard",
      "href": "/restaurants/merchant"
    },
    {
      "label": "Food directory",
      "href": "/food"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/restaurants/merchant"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/FoodMerchantPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/FoodSetupWizard.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/RestaurantCreditFundingPanel.jsx"
    }
  ]
};
