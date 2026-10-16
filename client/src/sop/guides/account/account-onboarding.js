// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "account-onboarding",
  "area": "account",
  "slug": "complete-onboarding",
  "title": "Complete helper or business onboarding",
  "audiences": [
    "helper",
    "business"
  ],
  "revision": 3,
  "availability": "supported",
  "conditions": [],
  "goal": "Complete the helper requirements for work, or follow the separate business setup checks. Settings, authorized statements, Support and verification remain accessible during setup.",
  "intendedRoles": [
    "Helper",
    "Business owner"
  ],
  "prerequisites": [
    {
      "text": "Be signed in with the Helper or Business Owner mode active.",
      "guideId": "account-signin",
      "href": "/login"
    },
    {
      "text": "Helpers: complete identity verification first.",
      "guideId": "account-identity-verification",
      "href": "/verify-identity"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open your dashboard",
        "type": "terminal"
      },
      {
        "id": "checklist",
        "label": "Work through the onboarding checklist",
        "type": "step"
      },
      {
        "id": "terms",
        "label": "Review and accept terms",
        "type": "step"
      },
      {
        "id": "profile",
        "label": "Complete profile and contact details",
        "type": "step"
      },
      {
        "id": "identity",
        "label": "Review identity and any background-check requirement",
        "type": "step"
      },
      {
        "id": "review",
        "label": "All steps done?",
        "type": "decision"
      },
      {
        "id": "finish",
        "label": "Finish onboarding (or publish the business)",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Onboarding complete; listing is live",
        "type": "terminal"
      },
      {
        "id": "fix",
        "label": "Complete the highlighted step",
        "type": "blocked"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "checklist"
      },
      {
        "from": "checklist",
        "to": "terms"
      },
      {
        "from": "terms",
        "to": "profile"
      },
      {
        "from": "profile",
        "to": "identity"
      },
      {
        "from": "identity",
        "to": "review"
      },
      {
        "from": "review",
        "to": "finish",
        "label": "Yes"
      },
      {
        "from": "review",
        "to": "fix",
        "label": "No"
      },
      {
        "from": "fix",
        "to": "review"
      },
      {
        "from": "finish",
        "to": "done"
      }
    ]
  },
  "processMapText": "Open the helper checklist. Review terms, save profile/contact details and complete applicable identity checks. Background checks may be required for certain activities or requested by some clients. Finish onboarding when allowed and check the saved status. Business owners follow their separate business setup checks; ordinary account settings and authorized statements remain accessible.",
  "steps": [
    {
      "id": "account-onboarding-s1",
      "title": "Find the onboarding checklist on your dashboard",
      "body": "Open your dashboard (/dashboard in Helper mode, /business-hub in Business Owner mode). Helpers see the card \"Finish setting up your helper account\" with the intro \"Complete these steps to appear in search and accept jobs.\" Each step shows \"To do\" until it is complete.",
      "expectedResult": "The checklist lists the remaining onboarding steps with their current state.",
      "screenshots": [
        {
          "id": "account-onboarding-s1-desktop",
          "viewport": "desktop",
          "screen": "/dashboard",
          "state": "Helper dashboard with onboarding checklist visible, signed in, light mode",
          "alt": "Finish setting up your helper account checklist on the dashboard",
          "caption": "The helper onboarding checklist, desktop view.",
          "annotations": []
        },
        {
          "id": "account-onboarding-s1-mobile",
          "viewport": "mobile",
          "screen": "/dashboard",
          "state": "Helper dashboard with onboarding checklist visible, signed in, light mode",
          "alt": "Onboarding checklist on a phone screen",
          "caption": "The checklist, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "account-onboarding-s2",
      "title": "Review and accept the terms",
      "body": "If the \"Terms accepted\" row is not done, open \"Review and accept terms\", read the terms, and accept them. This is also where helpers who missed the signup checkbox accept terms later.",
      "expectedResult": "The terms row changes to \"Done\".",
      "screenshots": [
        {
          "id": "account-onboarding-s2-desktop",
          "viewport": "desktop",
          "screen": "/dashboard",
          "state": "Terms acceptance step open, signed in, light mode",
          "alt": "Review and accept terms step in the checklist",
          "caption": "The terms acceptance step.",
          "annotations": []
        },
        {
          "id": "account-onboarding-s2-mobile",
          "viewport": "mobile",
          "screen": "/dashboard",
          "state": "Terms acceptance step open, signed in, light mode",
          "alt": "Terms step on a phone screen",
          "caption": "The terms step, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "account-onboarding-s3",
      "title": "Complete your profile and contact details",
      "body": "Fill in phone, city, state, ZIP code and bio, then choose Save profile. Check the identity row and follow Verify identity if required. An authorized identity approval or configured skip satisfies only the applicable identity check; it does not complete email, terms or profile requirements. Background checks may be required for certain activities or requested by some clients.",
      "expectedResult": "Saved profile details are reflected in the checklist. Identity and any applicable background-check status are shown separately.",
      "screenshots": [
        {
          "id": "account-onboarding-s3-desktop",
          "viewport": "desktop",
          "screen": "/dashboard",
          "state": "Profile details step open, signed in, light mode",
          "alt": "Profile and contact details form with Save profile button",
          "caption": "The profile details step with the Save profile button.",
          "annotations": []
        },
        {
          "id": "account-onboarding-s3-mobile",
          "viewport": "mobile",
          "screen": "/dashboard",
          "state": "Profile details step open, signed in, light mode",
          "alt": "Profile fields on a phone screen",
          "caption": "The profile step, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "account-onboarding-s4",
      "title": "Finish onboarding and go live",
      "body": "When the required checks allow it, choose Finish onboarding. Confirm the saved completion state. Business owners use their business setup page and Publish business when its checks permit; business access follows business permissions. Tax-document requirements for receiving payouts are separate and appear in Settings when applicable.",
      "expectedResult": "The checklist disappears and you can bid on jobs, accept bookings, or take bookings as a business.",
      "screenshots": [
        {
          "id": "account-onboarding-s4-desktop",
          "viewport": "desktop",
          "screen": "/dashboard",
          "state": "All onboarding steps done, signed in, light mode",
          "alt": "Completed checklist with the Finish onboarding button",
          "caption": "All steps done; choose Finish onboarding.",
          "annotations": []
        },
        {
          "id": "account-onboarding-s4-mobile",
          "viewport": "mobile",
          "screen": "/dashboard",
          "state": "All onboarding steps done, signed in, light mode",
          "alt": "Completed checklist on a phone screen",
          "caption": "The finish step, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "Confirm the server-reported completion state. Listing and work actions still depend on availability, applicable requirements and permissions; reading this checklist does not enable them.",
  "recovery": [
    {
      "problem": "A step stays on \"To do\" after you completed it.",
      "solution": "Reload the page; progress is re-derived from your records. If identity shows \"Your identity check is being reviewed.\", wait for the review to finish."
    },
    {
      "problem": "You cannot bid or accept bookings yet.",
      "solution": "Check that onboarding shows complete and that you are in Helper mode. Helpers must complete onboarding; customers can browse and post without it."
    },
    {
      "problem": "The business cannot publish.",
      "solution": "Review the remaining checklist items on /business/:businessId/onboarding. Every incomplete check blocks publishing."
    }
  ],
  "supportContact": "If a step will not complete despite your records being correct, contact support from the Help menu or visit /support.",
  "relatedGuides": [
    "account-join",
    "account-signin",
    "account-identity-verification",
    "account-settings",
    "business-work-setup"
  ],
  "siteLinks": [
    {
      "label": "Dashboard",
      "href": "/dashboard"
    },
    {
      "label": "Verify identity",
      "href": "/verify-identity"
    }
  ],
  "sources": [
    {
      "type": "screen",
      "ref": "client/src/components/HelperOnboardingChecklist.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/components/businessHub/BusinessOnboarding.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/BusinessLaunchStatusPage.jsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/helper-registration/start, /verify-otp, /complete, /api/helper-registration/finalize"
    },
    {
      "type": "permission",
      "ref": "Authenticated. Listing, bidding and starting work enforce onboarding server-side."
    }
  ]
};
