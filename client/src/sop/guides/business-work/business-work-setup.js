// English end-user instructions, verified against current launch routes.
export default {
  "id": "business-work-setup",
  "area": "business-work",
  "slug": "set-up-a-business",
  "title": "Set up your business",
  "audiences": [
    "business"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Create or select a business, complete its setup checks, and publish when eligible.",
  "intendedRoles": [
    "Business owner"
  ],
  "prerequisites": [
    {
      "text": "Sign in with permission to create or manage this business.",
      "href": "/login"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "s0",
        "label": "Open Business hub",
        "type": "terminal"
      },
      {
        "id": "s1",
        "label": "Create or select business",
        "type": "step"
      },
      {
        "id": "s2",
        "label": "Complete setup checks",
        "type": "step"
      },
      {
        "id": "s3",
        "label": "Save and publish when eligible",
        "type": "step"
      },
      {
        "id": "s4",
        "label": "Check readiness",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "s0",
        "to": "s1"
      },
      {
        "from": "s1",
        "to": "s2"
      },
      {
        "from": "s2",
        "to": "s3"
      },
      {
        "from": "s3",
        "to": "s4"
      }
    ]
  },
  "processMapText": "1. Open Business hub → 2. Create or select business → 3. Complete setup checks → 4. Save and publish when eligible → 5. Check readiness",
  "steps": [
    {
      "id": "business-work-setup-s1",
      "title": "Open your business workspace",
      "body": "Open Business hub. Select the business you own or manage. To create a service business, use Add a business and complete the creation form. A consulting intake is separate from creating a business workspace.",
      "expectedResult": "The selected business name and your permitted workspace tabs are visible.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/business-hub",
          "state": "Business workspace, signed in owner, light mode",
          "alt": "Select or create the business in Business hub.",
          "caption": "Select or create the business in Business hub. Synthetic example; no live account data.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/business-hub",
          "state": "Business workspace, signed in owner, light mode",
          "alt": "Select or create the business in Business hub.",
          "caption": "Select or create the business in Business hub. Synthetic example; no live account data.",
          "annotations": []
        }
      ]
    },
    {
      "id": "business-work-setup-s2",
      "title": "Finish setup and check readiness",
      "body": "From your business dashboard, open its Launch step incomplete item when shown. Complete the profile and setup checks. Save changes; publish only when all required checks pass. Restaurant requirements can differ. Return to the workspace and check the readiness status.",
      "expectedResult": "Saved profile details and current setup status are shown. An incomplete check explains what still needs attention.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/business/:businessId/onboarding",
          "state": "Business setup checks, signed in owner, light mode",
          "alt": "Business setup checks and profile fields.",
          "caption": "Business setup checks and profile fields. Synthetic example; no live account data.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/business/:businessId/onboarding",
          "state": "Business setup checks, signed in owner, light mode",
          "alt": "Business setup checks and profile fields.",
          "caption": "Business setup checks and profile fields. Synthetic example; no live account data.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The workspace shows your saved business details and actual readiness. Saving a profile does not guarantee approval or publication.",
  "recovery": [
    {
      "problem": "You cannot edit or publish.",
      "solution": "Check that the correct business is selected and that your membership permits the action. Use Support for a missing or failed setup check."
    }
  ],
  "supportContact": "If your approved business never appears in the hub, contact OxSteed Support from the /support page.",
  "relatedGuides": [
    "business-work-select",
    "business-work-team-access"
  ],
  "siteLinks": [
    {
      "label": "Business hub",
      "href": "/business-hub"
    },
    {
      "label": "Your businesses",
      "href": "/dashboard"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/business-hub"
    },
    {
      "type": "route",
      "ref": "/business/:businessId/onboarding"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/BusinessHubPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/components/businessHub/BusinessOnboarding.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/utils/launchScope.js"
    }
  ]
};
