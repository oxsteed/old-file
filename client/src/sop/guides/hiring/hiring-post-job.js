// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "hiring-post-job",
  "area": "hiring",
  "slug": "post-job",
  "title": "Post a job",
  "audiences": [
    "customer"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Publish a job post with clear details so local helpers can send you bids.",
  "intendedRoles": [
    "Customer"
  ],
  "prerequisites": [
    {
      "text": "Be signed in with the Customer mode active.",
      "guideId": "account-signin",
      "href": "/login"
    },
    {
      "text": "Know what the work is, where it is, and what budget you have in mind.",
      "href": null
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open the Post a job page",
        "type": "terminal"
      },
      {
        "id": "describe",
        "label": "Describe the job",
        "type": "step"
      },
      {
        "id": "details",
        "label": "Set location, schedule, and budget",
        "type": "step"
      },
      {
        "id": "review",
        "label": "Details complete?",
        "type": "decision"
      },
      {
        "id": "fix",
        "label": "Complete the highlighted fields",
        "type": "blocked"
      },
      {
        "id": "publish",
        "label": "Post the job",
        "type": "step"
      },
      {
        "id": "live",
        "label": "Job is live and helpers can bid",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "describe"
      },
      {
        "from": "describe",
        "to": "details"
      },
      {
        "from": "details",
        "to": "review"
      },
      {
        "from": "review",
        "to": "publish",
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
        "from": "publish",
        "to": "live"
      }
    ]
  },
  "processMapText": "1. Open /post-job. The page heading is \"Post a Job\" with the subtitle \"Describe what you need and get bids from local helpers\". 2. Enter a Job Title (at least 10 characters), add skills with \"Add Skill\", and write your requirements. 3. Add photos or video with \"Add Photos, Video, or Audio\" when the work is visible. 4. Set the location, schedule, and budget. 5. Use \"Save as Draft\" to pause, or continue to \"Review & Post\". 6. On the review step, choose \"Post Job\" (or \"Post Job & Invite Bids\"). The job goes live with a \"Job Posted!\" confirmation.",
  "steps": [
    {
      "id": "hiring-post-job-s1",
      "title": "Open the Post a job page",
      "body": "Choose \"Post a job\" in the navigation, or open /post-job directly. The page heading is \"Post a Job\" with the subtitle \"Describe what you need and get bids from local helpers\". The \"Before you post\" panel gives quick tips: include exact problem details, add preferred dates, and list special tools or materials.",
      "expectedResult": "The multi-step job form loads with the first step visible.",
      "screenshots": [
        {
          "id": "hiring-post-job-s1-desktop",
          "viewport": "desktop",
          "screen": "/post-job",
          "state": "Blank post-job form step 1, signed in, light mode",
          "alt": "Post a Job page with the title field at the top",
          "caption": "The Post a job page, desktop view.",
          "annotations": []
        },
        {
          "id": "hiring-post-job-s1-mobile",
          "viewport": "mobile",
          "screen": "/post-job",
          "state": "Blank post-job form step 1, signed in, light mode",
          "alt": "Post a Job page on a phone screen",
          "caption": "The Post a job page, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "hiring-post-job-s2",
      "title": "Describe the job",
      "body": "Enter a Job Title of at least 10 characters (example placeholder \"e.g. Fix leaking kitchen sink\"). Choose \"Add Skill\" to tag the skills needed. Under \"Your Requirements\", write what the work is, the materials involved, and how you will judge the result. Move forward with \"Next Step\".",
      "expectedResult": "Each required field validates and the form advances to the next step.",
      "screenshots": [
        {
          "id": "hiring-post-job-s2-desktop",
          "viewport": "desktop",
          "screen": "/post-job",
          "state": "Job description step filled in, signed in, light mode",
          "alt": "Job description section with title, skills, and requirements filled in",
          "caption": "The job description section.",
          "annotations": []
        },
        {
          "id": "hiring-post-job-s2-mobile",
          "viewport": "mobile",
          "screen": "/post-job",
          "state": "Job description step filled in, signed in, light mode",
          "alt": "Job description fields on a phone screen",
          "caption": "The description section, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "hiring-post-job-s3",
      "title": "Add photos and set location, schedule, and budget",
      "body": "Use \"Add Photos, Video, or Audio\" to attach evidence of the work (\"Snap Photo\", \"Record a Video\", or \"Record Audio\"). Then enter the job Location, pick your preferred Schedule, and set a Budget with the Budget type. You can \"Save as Draft\" at any point (\"Saving draft...\") and come back later.",
      "expectedResult": "Attachments upload and location, schedule, and budget all show entered values.",
      "screenshots": [
        {
          "id": "hiring-post-job-s3-desktop",
          "viewport": "desktop",
          "screen": "/post-job",
          "state": "Location, schedule, and budget step, signed in, light mode",
          "alt": "Location, schedule, and budget fields",
          "caption": "The location, schedule, and budget section.",
          "annotations": []
        },
        {
          "id": "hiring-post-job-s3-mobile",
          "viewport": "mobile",
          "screen": "/post-job",
          "state": "Location, schedule, and budget step, signed in, light mode",
          "alt": "Budget fields on a phone screen",
          "caption": "The budget section, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "hiring-post-job-s4",
      "title": "Review and post",
      "body": "On the final step (\"Review & Post\", labeled \"Step 4 of 4 - Review & Post\"), read the \"Job posting summary\" and the \"What happens next\" notes. When everything is correct, choose \"Post Job\" or \"Post Job & Invite Bids\". A \"Job Posted!\" confirmation appears with \"Post Another Job\" if you need a second listing.",
      "expectedResult": "A \"Job Posted!\" confirmation appears and the job is listed as open.",
      "screenshots": [
        {
          "id": "hiring-post-job-s4-desktop",
          "viewport": "desktop",
          "screen": "/post-job",
          "state": "Review and Post step, signed in, light mode",
          "alt": "Review summary with the Post Job button enabled",
          "caption": "The Review & Post step with Post Job enabled.",
          "annotations": []
        },
        {
          "id": "hiring-post-job-s4-mobile",
          "viewport": "mobile",
          "screen": "/post-job",
          "state": "Review and Post step, signed in, light mode",
          "alt": "Review step on a phone screen",
          "caption": "The review step, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The \"Job Posted!\" confirmation appears and the job shows in My Jobs with an open status. Helpers who match the location and category are notified and can bid.",
  "recovery": [
    {
      "problem": "The job will not post.",
      "solution": "Complete every highlighted field: the title needs at least 10 characters and the required steps must all be valid. The review step lists what is missing."
    },
    {
      "problem": "You lost your progress.",
      "solution": "Use \"Save as Draft\" while editing; drafts autosave and can be resumed later from your jobs list."
    }
  ],
  "supportContact": "If your job does not appear within 10 minutes of posting, contact support from the Help menu or visit /support.",
  "relatedGuides": [
    "hiring-manage-jobs",
    "hiring-compare-bids",
    "hiring-find-help"
  ],
  "siteLinks": [
    {
      "label": "Post a job",
      "href": "/post-job"
    },
    {
      "label": "My jobs",
      "href": "/my-jobs"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/post-job"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/PostJobPage.jsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/jobs, GET/PUT/DELETE /api/jobs/draft"
    },
    {
      "type": "permission",
      "ref": "Authenticated (customer mode)."
    }
  ]
};
