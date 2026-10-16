// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "helper-work-skills",
  "area": "helper-work",
  "slug": "manage-skills",
  "title": "Manage your skills",
  "audiences": [
    "helper"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "List every skill you offer with accurate rates so customers can find and hire you directly.",
  "intendedRoles": [
    "Helper"
  ],
  "prerequisites": [
    {
      "text": "Sign in and switch to helper mode.",
      "href": "/login"
    },
    {
      "text": "Complete your helper profile first.",
      "guideId": "helper-work-profile",
      "href": "/dashboard?tab=editprofile"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open the Skills tab",
        "type": "terminal"
      },
      {
        "id": "add",
        "label": "Choose Add Skill",
        "type": "step"
      },
      {
        "id": "fill",
        "label": "Fill in the skill details",
        "type": "step"
      },
      {
        "id": "check",
        "label": "Skill name entered?",
        "type": "decision"
      },
      {
        "id": "fix",
        "label": "Enter the required skill name",
        "type": "blocked"
      },
      {
        "id": "save",
        "label": "Choose Add Skill to save",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Skill listed for hire",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "add"
      },
      {
        "from": "add",
        "to": "fill"
      },
      {
        "from": "fill",
        "to": "check"
      },
      {
        "from": "check",
        "to": "save",
        "label": "Yes"
      },
      {
        "from": "check",
        "to": "fix",
        "label": "No"
      },
      {
        "from": "fix",
        "to": "check"
      },
      {
        "from": "save",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Open the Skills tab on your dashboard. 2. Choose Add Skill. 3. Fill in the skill name, category, rate, experience, and description. 4. Check whether the required skill name is entered; if not, enter it and check again. 5. Choose Add Skill to save. 6. The skill is listed in your skills and appears on your public profile.",
  "steps": [
    {
      "id": "helper-work-skills-s1",
      "title": "Open the Skills tab",
      "body": "Open your helper dashboard (/dashboard or /helper-dashboard) and choose the Skills tab. The tab shows the My Skills for Hire section with your current skills, or an empty state if you have none yet.",
      "expectedResult": "The My Skills for Hire section loads with your existing skills or an empty state.",
      "screenshots": [
        {
          "id": "helper-work-skills-s1-desktop",
          "viewport": "desktop",
          "screen": "/dashboard?tab=skills",
          "state": "Skills tab with one synthetic skill, light mode",
          "alt": "Skills tab showing the My Skills for Hire section with one skill",
          "caption": "The Skills tab, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-skills-s1-mobile",
          "viewport": "mobile",
          "screen": "/dashboard?tab=skills",
          "state": "Skills tab with one synthetic skill, light mode",
          "alt": "Skills tab on a phone screen",
          "caption": "The Skills tab, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-skills-s2",
      "title": "Add a new skill",
      "body": "Choose + Add Skill. The Add a Skill dialog opens with a Skill Name field that suggests matching categories as you type.",
      "expectedResult": "The Add a Skill dialog is open with empty fields.",
      "screenshots": [
        {
          "id": "helper-work-skills-s2-desktop",
          "viewport": "desktop",
          "screen": "/dashboard?tab=skills",
          "state": "Add a Skill dialog open, light mode",
          "alt": "Add a Skill dialog with the skill name, category, rate, and experience fields",
          "caption": "The Add a Skill dialog, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-skills-s2-mobile",
          "viewport": "mobile",
          "screen": "/dashboard?tab=skills",
          "state": "Add a Skill dialog open, light mode",
          "alt": "Add a Skill dialog on a phone screen",
          "caption": "The Add a Skill dialog, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-skills-s3",
      "title": "Describe the skill and set your rate",
      "body": "Enter the Skill Name, pick the suggested Category, set your optional Hourly Rate and Years of Experience, and write a short description of what the skill covers. Keep the Available for hire toggle on if you currently take this work.",
      "expectedResult": "All fields show your entries and the Available for hire toggle reflects your choice.",
      "screenshots": [
        {
          "id": "helper-work-skills-s3-desktop",
          "viewport": "desktop",
          "screen": "/dashboard?tab=skills",
          "state": "Add a Skill dialog filled with synthetic data, light mode",
          "alt": "Add a Skill dialog filled in with a sample electrical repair skill",
          "caption": "A filled-in skill form, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-skills-s3-mobile",
          "viewport": "mobile",
          "screen": "/dashboard?tab=skills",
          "state": "Add a Skill dialog filled with synthetic data, light mode",
          "alt": "Filled-in skill form on a phone screen",
          "caption": "A filled-in skill form, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-skills-s4",
      "title": "Save and keep skills accurate",
      "body": "Choose Add Skill to save. Edit a skill later from the same tab when your rate or experience changes, and remove skills you no longer offer. Turn the Available for hire toggle off instead of deleting a skill you may offer again.",
      "expectedResult": "The skill appears in your list and on your public profile; edits save immediately.",
      "screenshots": [
        {
          "id": "helper-work-skills-s4-desktop",
          "viewport": "desktop",
          "screen": "/dashboard?tab=skills",
          "state": "Skills tab with two synthetic skills, light mode",
          "alt": "Skills tab with two saved skills and edit and delete controls",
          "caption": "Saved skills, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-skills-s4-mobile",
          "viewport": "mobile",
          "screen": "/dashboard?tab=skills",
          "state": "Skills tab with two synthetic skills, light mode",
          "alt": "Saved skills on a phone screen",
          "caption": "Saved skills, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "Your skills appear in the Skills tab list and on your public helper profile.",
  "recovery": [
    {
      "problem": "The skill does not save.",
      "solution": "The Skill Name field is required. Enter a name, then choose Add Skill again."
    },
    {
      "problem": "A skill shows an outdated rate.",
      "solution": "Open the Skills tab, edit the skill, update the hourly rate, and choose Update Skill."
    }
  ],
  "supportContact": "If skills fail to load, contact OxSteed Support from the /support page.",
  "relatedGuides": [
    "helper-work-profile",
    "helper-work-find-work"
  ],
  "siteLinks": [
    {
      "label": "Skills tab",
      "href": "/dashboard?tab=skills"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/dashboard?tab=skills"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/HelperDashboard.jsx (skills tab)"
    },
    {
      "type": "handler",
      "ref": "POST /api/user-skills"
    }
  ]
};
