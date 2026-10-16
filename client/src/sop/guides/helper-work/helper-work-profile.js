// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "helper-work-profile",
  "area": "helper-work",
  "slug": "helper-profile-setup",
  "title": "Manage your helper profile and public listing",
  "audiences": [
    "helper"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Build a complete public profile so customers can find you, trust you, and book you.",
  "intendedRoles": [
    "Helper"
  ],
  "prerequisites": [
    {
      "text": "Sign in and switch to helper mode.",
      "href": "/login"
    },
    {
      "text": "Finish helper onboarding so you can bid and take bookings.",
      "href": "/dashboard"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open the Edit Profile tab",
        "type": "terminal"
      },
      {
        "id": "basics",
        "label": "Complete Basic Info",
        "type": "step"
      },
      {
        "id": "content",
        "label": "Add services, FAQs, and photos",
        "type": "step"
      },
      {
        "id": "check",
        "label": "Every section complete?",
        "type": "decision"
      },
      {
        "id": "fix",
        "label": "Fill the incomplete sections",
        "type": "blocked"
      },
      {
        "id": "visibility",
        "label": "Set availability hours and visibility",
        "type": "step"
      },
      {
        "id": "preview",
        "label": "Preview the public profile",
        "type": "step"
      },
      {
        "id": "live",
        "label": "Public listing is live",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "basics"
      },
      {
        "from": "basics",
        "to": "content"
      },
      {
        "from": "content",
        "to": "check"
      },
      {
        "from": "check",
        "to": "visibility",
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
        "from": "visibility",
        "to": "preview"
      },
      {
        "from": "preview",
        "to": "live"
      }
    ]
  },
  "processMapText": "1. Open the Edit Profile tab on your dashboard. 2. Complete the Basic Info section. 3. Add your services, FAQs, and photos. 4. Check whether every profile section is complete; if not, fill the incomplete sections and check again. 5. Set your availability hours and section visibility. 6. Preview your public profile. 7. Your public listing is live in the helper directory.",
  "steps": [
    {
      "id": "helper-work-profile-s1",
      "title": "Open the Edit Profile tab",
      "body": "Sign in and open your helper dashboard (/dashboard or /helper-dashboard). Choose the Edit Profile tab. The tab opens the Profile Studio, with profile sections listed as Cover, Basic Info, Availability, Services, FAQs, Policies, Photos, Media, and Section Visibility.",
      "expectedResult": "The Profile Studio shows your sections with completion states, starting with Basic Info.",
      "screenshots": [
        {
          "id": "helper-work-profile-s1-desktop",
          "viewport": "desktop",
          "screen": "/dashboard?tab=editprofile",
          "state": "Edit Profile tab open, synthetic helper data, light mode",
          "alt": "Helper dashboard with the Edit Profile tab selected and the Profile Studio sections listed",
          "caption": "The Edit Profile tab, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Edit Profile tab",
              "locator": ".bh-tab.active, button"
            }
          ]
        },
        {
          "id": "helper-work-profile-s1-mobile",
          "viewport": "mobile",
          "screen": "/dashboard?tab=editprofile",
          "state": "Edit Profile tab open, synthetic helper data, light mode",
          "alt": "Edit Profile tab on a phone screen with the profile sections stacked",
          "caption": "The Edit Profile tab, mobile view.",
          "annotations": [
            {
              "n": 1,
              "label": "Edit Profile tab",
              "locator": ".bh-tab.active, button"
            }
          ]
        }
      ]
    },
    {
      "id": "helper-work-profile-s2",
      "title": "Complete the Basic Info section",
      "body": "In the Basic Info section, fill in your Tagline / Headline, your Bio, your rate range, and your service area with service radius in miles. Choose Save Basic Info. A confirmation appears when it saves.",
      "expectedResult": "\"Profile saved!\" appears and the Basic Info section is marked complete.",
      "screenshots": [
        {
          "id": "helper-work-profile-s2-desktop",
          "viewport": "desktop",
          "screen": "/dashboard?tab=editprofile",
          "state": "Basic Info section filled with synthetic helper data, light mode",
          "alt": "Basic Info section with tagline, bio, rates, and service area filled in",
          "caption": "The completed Basic Info section, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-profile-s2-mobile",
          "viewport": "mobile",
          "screen": "/dashboard?tab=editprofile",
          "state": "Basic Info section filled with synthetic helper data, light mode",
          "alt": "Basic Info section filled in on a phone screen",
          "caption": "The completed Basic Info section, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-profile-s3",
      "title": "Add services, FAQs, and photos",
      "body": "Move through the Services, FAQs, Policies, and Photos sections. Add each service you offer with a name and description, add common questions customers ask with your answers, and upload photos of your past work. Changes in these sections save when you add, edit, or remove an item.",
      "expectedResult": "Your services, FAQs, and photos appear in their sections with a saved state.",
      "screenshots": [
        {
          "id": "helper-work-profile-s3-desktop",
          "viewport": "desktop",
          "screen": "/dashboard?tab=editprofile",
          "state": "Services section with two synthetic services, light mode",
          "alt": "Services section showing added services with edit and delete controls",
          "caption": "The Services section, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-profile-s3-mobile",
          "viewport": "mobile",
          "screen": "/dashboard?tab=editprofile",
          "state": "Photos section with synthetic photos, light mode",
          "alt": "Photos section on a phone screen with uploaded work photos",
          "caption": "The Photos section, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-profile-s4",
      "title": "Set hours and visibility",
      "body": "In the Availability section, set your weekly hours and choose Save Hours. In the Section Visibility section, control which profile sections show on your public page. Customers only see what you make visible.",
      "expectedResult": "Your hours save and hidden sections no longer show on the public profile.",
      "screenshots": [
        {
          "id": "helper-work-profile-s4-desktop",
          "viewport": "desktop",
          "screen": "/dashboard?tab=editprofile",
          "state": "Availability section with weekly hours, light mode",
          "alt": "Availability section with weekly hours and the Save Hours button",
          "caption": "The Availability section, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-profile-s4-mobile",
          "viewport": "mobile",
          "screen": "/dashboard?tab=editprofile",
          "state": "Availability section with weekly hours, light mode",
          "alt": "Availability section on a phone screen",
          "caption": "The Availability section, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-profile-s5",
      "title": "Preview your public listing",
      "body": "Choose View Public Profile. Your public page opens at /helpers/:id, exactly as customers see it in the directory. Check your headline, photos, services, and availability for typos and accuracy.",
      "expectedResult": "Your public profile page loads with all visible sections correct.",
      "screenshots": [
        {
          "id": "helper-work-profile-s5-desktop",
          "viewport": "desktop",
          "screen": "/helpers/:id",
          "state": "Public helper profile with synthetic data, light mode",
          "alt": "Public helper profile page showing headline, photos, and services",
          "caption": "The public profile page, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-profile-s5-mobile",
          "viewport": "mobile",
          "screen": "/helpers/:id",
          "state": "Public helper profile with synthetic data, light mode",
          "alt": "Public helper profile on a phone screen",
          "caption": "The public profile page, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "Open your public profile at /helpers/:id (or use View Public Profile). Every visible section should show your latest edits.",
  "recovery": [
    {
      "problem": "The public profile does not show your edits.",
      "solution": "Return to the Edit Profile tab and confirm each section saved (sections show a saved state). Hidden sections in Section Visibility will not render publicly."
    },
    {
      "problem": "Your listing does not appear in the helper directory.",
      "solution": "Open the Availability tab on your dashboard and choose Go Online to appear in the directory listing."
    }
  ],
  "supportContact": "If your public profile fails to load, contact OxSteed Support from the /support page.",
  "relatedGuides": [
    "helper-work-availability",
    "helper-work-skills"
  ],
  "siteLinks": [
    {
      "label": "Edit profile",
      "href": "/dashboard?tab=editprofile"
    },
    {
      "label": "Helper directory",
      "href": "/helpers"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/dashboard?tab=editprofile"
    },
    {
      "type": "route",
      "ref": "/helpers/:id"
    },
    {
      "type": "screen",
      "ref": "client/src/components/EditProfileTab.jsx"
    },
    {
      "type": "handler",
      "ref": "PUT /api/helper-profile/core|visibility|photo"
    }
  ]
};
