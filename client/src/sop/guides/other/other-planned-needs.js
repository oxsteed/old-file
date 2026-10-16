// English end-user instructions, verified against current launch routes.
export default {
  "id": "other-planned-needs",
  "area": "other",
  "slug": "plan-recurring-needs",
  "title": "Arrange recurring household work",
  "audiences": [
    "customer"
  ],
  "revision": 2,
  "availability": "conditional",
  "conditions": [
    "This specialized workspace is not available in the current launch. Its legacy address redirects to your dashboard."
  ],
  "goal": "Arrange recurring household work through the available job-posting flow while the specialized workspace is unavailable.",
  "intendedRoles": [
    "Customer"
  ],
  "prerequisites": [
    {
      "text": "A signed-in OxSteed account.",
      "href": "/login"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "s0",
        "label": "Specialized workspace unavailable",
        "type": "terminal"
      },
      {
        "id": "s1",
        "label": "Describe the work in Post a Job",
        "type": "step"
      },
      {
        "id": "s2",
        "label": "Submit and check My Jobs",
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
      }
    ]
  },
  "processMapText": "1. Specialized workspace unavailable → 2. Describe the work in Post a Job → 3. Submit and check My Jobs",
  "steps": [
    {
      "id": "other-planned-needs-s1",
      "title": "Post the work you need",
      "body": "Open Post a Job. Describe the recurring household work, location, timing, and budget. For recurring work, explain the desired frequency. Review and submit only when the details are correct. The specialized garage or auto-publishing tools are not available in this launch.",
      "expectedResult": "The posted job appears in My Jobs after a successful submission.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/post-job",
          "state": "Current launch alternative, customer, light mode",
          "alt": "Post a Job is the available alternative.",
          "caption": "Post a Job is the available alternative. Synthetic example; no live account data.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/post-job",
          "state": "Current launch alternative, customer, light mode",
          "alt": "Post a Job is the available alternative.",
          "caption": "Post a Job is the available alternative. Synthetic example; no live account data.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "Check the saved job in My Jobs. Reading this guide does not create a job or schedule recurring publication.",
  "recovery": [
    {
      "problem": "The old workspace redirects.",
      "solution": "Use Post a Job or contact Support. Do not assume a vehicle or recurring schedule was saved."
    }
  ],
  "supportContact": "Planned needs issues: contact support from the in-app support page at /support.",
  "relatedGuides": [
    "hiring-post-job"
  ],
  "siteLinks": [
    {
      "label": "Post a Job",
      "href": "/post-job"
    },
    {
      "label": "My Jobs",
      "href": "/my-jobs"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/planned-needs"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/PlannedNeedsPage.jsx"
    },
    {
      "type": "handler",
      "ref": "GET /api/planned-needs"
    },
    {
      "type": "handler",
      "ref": "POST /api/planned-needs"
    },
    {
      "type": "handler",
      "ref": "PUT /api/planned-needs/:id"
    },
    {
      "type": "screen",
      "ref": "client/src/utils/launchScope.js"
    },
    {
      "type": "route",
      "ref": "/post-job"
    }
  ]
};
