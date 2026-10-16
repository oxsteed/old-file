// English end-user instructions, verified against current launch routes.
export default {
  "id": "account-identity-verification",
  "area": "account",
  "slug": "verify-identity",
  "title": "Verify identity (Didit)",
  "audiences": [
    "customer",
    "helper"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Start hosted identity verification when required, then check the status returned to OxSteed. Other onboarding requirements remain separate.",
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
      "text": "Have a government ID (passport, driver's license, or national ID) and a camera ready.",
      "href": null
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "s0",
        "label": "Read preparation guidance",
        "type": "terminal"
      },
      {
        "id": "s1",
        "label": "Start hosted verification",
        "type": "step"
      },
      {
        "id": "s2",
        "label": "Follow provider instructions",
        "type": "step"
      },
      {
        "id": "s3",
        "label": "Return and check actual status",
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
      }
    ]
  },
  "processMapText": "1. Read preparation guidance → 2. Start hosted verification → 3. Follow provider instructions → 4. Return and check actual status",
  "steps": [
    {
      "id": "account-identity-verification-s1",
      "title": "Read the OxSteed verification guidance",
      "body": "Open Verify identity and read the document and camera requirements. Identity checks may be required for listing or particular activities. An authorized identity override or skip is separate from other onboarding requirements.",
      "expectedResult": "You understand the next verification step; no verification is implied by this example.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/verify-identity",
          "state": "Verification page loaded, signed in, light mode",
          "alt": "OxSteed preparation and hosted-verification handoff. Provider document and selfie screens are not shown.",
          "caption": "OxSteed preparation and hosted-verification handoff. Provider document and selfie screens are not shown. Synthetic example; no live account data.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/verify-identity",
          "state": "Verification page loaded, signed in, light mode",
          "alt": "OxSteed preparation and hosted-verification handoff. Provider document and selfie screens are not shown.",
          "caption": "OxSteed preparation and hosted-verification handoff. Provider document and selfie screens are not shown. Synthetic example; no live account data.",
          "annotations": []
        }
      ]
    },
    {
      "id": "account-identity-verification-s2",
      "title": "Start the hosted verification",
      "body": "Choose Start Verification to request a hosted Didit session. If the service is unavailable, follow the error guidance or contact Support. The example shows the OxSteed handoff, not the provider document picker.",
      "expectedResult": "You understand the next verification step; no verification is implied by this example.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/verify-identity",
          "state": "Verification page loaded, signed in, light mode",
          "alt": "OxSteed preparation and hosted-verification handoff. Provider document and selfie screens are not shown.",
          "caption": "OxSteed preparation and hosted-verification handoff. Provider document and selfie screens are not shown. Synthetic example; no live account data.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/verify-identity",
          "state": "Verification page loaded, signed in, light mode",
          "alt": "OxSteed preparation and hosted-verification handoff. Provider document and selfie screens are not shown.",
          "caption": "OxSteed preparation and hosted-verification handoff. Provider document and selfie screens are not shown. Synthetic example; no live account data.",
          "annotations": []
        }
      ]
    },
    {
      "id": "account-identity-verification-s3",
      "title": "Follow the provider instructions",
      "body": "In the hosted session, follow the document and selfie instructions shown by Didit. Accepted documents and camera prompts can vary. OxSteed cannot complete those steps by checking this guide. The illustration is the OxSteed preparation screen, not a provider capture screen.",
      "expectedResult": "You understand the next verification step; no verification is implied by this example.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/verify-identity",
          "state": "Verification page loaded, signed in, light mode",
          "alt": "OxSteed preparation and hosted-verification handoff. Provider document and selfie screens are not shown.",
          "caption": "OxSteed preparation and hosted-verification handoff. Provider document and selfie screens are not shown. Synthetic example; no live account data.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/verify-identity",
          "state": "Verification page loaded, signed in, light mode",
          "alt": "OxSteed preparation and hosted-verification handoff. Provider document and selfie screens are not shown.",
          "caption": "OxSteed preparation and hosted-verification handoff. Provider document and selfie screens are not shown. Synthetic example; no live account data.",
          "annotations": []
        }
      ]
    },
    {
      "id": "account-identity-verification-s4",
      "title": "Return and check your actual status",
      "body": "Return to OxSteed after the hosted session and check the current verification or onboarding status. A pending result needs time or support follow-up; do not treat the return alone as verified.",
      "expectedResult": "OxSteed shows the latest verification status; remaining onboarding checks are still separate.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/verify-identity",
          "state": "Verification page loaded, signed in, light mode",
          "alt": "OxSteed preparation and hosted-verification handoff. Provider document and selfie screens are not shown.",
          "caption": "OxSteed preparation and hosted-verification handoff. Provider document and selfie screens are not shown. Synthetic example; no live account data.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/verify-identity",
          "state": "Verification page loaded, signed in, light mode",
          "alt": "OxSteed preparation and hosted-verification handoff. Provider document and selfie screens are not shown.",
          "caption": "OxSteed preparation and hosted-verification handoff. Provider document and selfie screens are not shown. Synthetic example; no live account data.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "Confirm the actual identity status in OxSteed. Identity approval does not complete email, terms, profile, background-check, or other work requirements.",
  "recovery": [
    {
      "problem": "Verification fails repeatedly.",
      "solution": "Use a clear, uncreased photo of the ID in good lighting, remove glare, and make sure the selfie matches the document photo. Try again with better lighting."
    },
    {
      "problem": "You see \"Account Already Exists\" (This identity is already linked to an existing OxSteed account).",
      "solution": "Each person can have only one account. Sign in to that account instead of creating a new one; run multiple businesses from the same dashboard."
    },
    {
      "problem": "The verification cannot start (\"Could not start verification\").",
      "solution": "Reload the page and try again. If it still fails, the verification service may be unavailable; choose \"Verify later\" and return another time."
    }
  ],
  "supportContact": "If your ID is valid but verification keeps failing, contact support from the Help menu or visit /support.",
  "relatedGuides": [
    "account-onboarding",
    "account-signin"
  ],
  "siteLinks": [
    {
      "label": "Verify your identity",
      "href": "/verify-identity"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/verify-identity"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/VerifyIdentityPage.tsx"
    },
    {
      "type": "screen",
      "ref": "client/src/components/registration/DiditPanel.tsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/didit/session, POST /api/didit/start, GET /api/didit/status, POST /api/didit/skip"
    }
  ]
};
