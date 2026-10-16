// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "other-consulting",
  "area": "consulting",
  "slug": "request-consulting",
  "title": "Request business consulting",
  "audiences": [
    "customer",
    "helper"
  ],
  "revision": 3,
  "availability": "supported",
  "conditions": [],
  "goal": "Submit a consulting intake and keep its confirmation for follow-up.",
  "intendedRoles": [
    "Customer",
    "Helper (consultant)"
  ],
  "prerequisites": [
    {
      "text": "Have your contact details and business needs ready."
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "s0",
        "label": "Open consulting intake",
        "type": "terminal"
      },
      {
        "id": "s1",
        "label": "Enter needs and contact details",
        "type": "step"
      },
      {
        "id": "s2",
        "label": "Review and submit",
        "type": "step"
      },
      {
        "id": "s3",
        "label": "Keep the confirmation",
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
  "processMapText": "1. Open consulting intake → 2. Enter needs and contact details → 3. Review and submit → 4. Keep the confirmation",
  "steps": [
    {
      "id": "other-consulting-s1",
      "title": "Open the consulting intake",
      "body": "Open /consulting-intake. The page is titled \"Business Ascension Consulting Intake\". The step indicator shows Contact, \"Skill & Offer\", \"Setup Needs\", Package, Services, and Confirm. Guests can complete intake without an account.",
      "expectedResult": "The intake form loads on the Contact step.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/consulting-intake",
          "state": "Consulting intake, Contact step, guest, light mode",
          "alt": "Consulting intake with the step indicator",
          "caption": "The consulting intake, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/consulting-intake",
          "state": "Consulting intake, guest, light mode",
          "alt": "Intake on a phone screen",
          "caption": "The consulting intake, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "other-consulting-s2",
      "title": "Complete the intake steps",
      "body": "Fill in Contact (name, email, phone, business name, country), then \"Skill & Offer\", \"Setup Needs\", Package, and Services. Use \"Back\" to go to the previous step and \"Next\" to continue. Each step validates before you can move on.",
      "expectedResult": "All steps show as complete and you reach the Confirm step.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/consulting-intake",
          "state": "Intake mid-flow, Package step, light mode",
          "alt": "Package step of the consulting intake",
          "caption": "Completing intake steps, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/consulting-intake",
          "state": "Intake mid-flow, light mode",
          "alt": "Intake step on a phone screen",
          "caption": "Completing steps, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "other-consulting-s3",
      "title": "Review and submit",
      "body": "On the Confirm step, titled \"Review Your Submission\", check every section: contact details, selected skill and package, setup needs, and services. Choose \"Submit & Get Started\". You receive a confirmation of your request.",
      "expectedResult": "The intake is submitted and a confirmation appears.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/consulting-intake",
          "state": "Review Your Submission step, light mode",
          "alt": "Intake review with Submit and Get Started button",
          "caption": "Reviewing the submission, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/consulting-intake",
          "state": "Review step, light mode",
          "alt": "Review on a phone screen",
          "caption": "Reviewing, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "A successful intake submission shows its confirmation. Contact Support with that reference for follow-up; the legacy consulting portal currently redirects to Business hub.",
  "recovery": [
    {
      "problem": "The old consulting portal redirects.",
      "solution": "Use your intake confirmation and contact Support. A redirect does not mean a session was booked."
    }
  ],
  "supportContact": "Consulting questions: contact support from the in-app support page at /support.",
  "relatedGuides": [
    "other-messages",
    "other-calendar"
  ],
  "siteLinks": [
    {
      "label": "Consulting intake",
      "href": "/consulting-intake"
    },
    {
      "label": "Support",
      "href": "/support"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/consulting-intake"
    },
    {
      "type": "route",
      "ref": "/consulting/portal"
    },
    {
      "type": "route",
      "ref": "/consulting/contractor-dashboard"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/ConsultingIntakePage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/ConsultingFullPortal.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/ConsultantContractorDashboard.jsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/consulting/submit"
    },
    {
      "type": "screen",
      "ref": "client/src/utils/launchScope.js"
    }
  ]
};
