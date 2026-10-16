// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "account-privacy",
  "area": "account",
  "slug": "privacy-and-data",
  "title": "Privacy controls, data export, account deletion",
  "audiences": [
    "customer",
    "helper",
    "business",
    "restaurant",
    "logistics"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Control your privacy settings, export your data, or delete your account.",
  "intendedRoles": [
    "Customer",
    "Helper",
    "Business owner",
    "Restaurant",
    "Logistics"
  ],
  "prerequisites": [
    {
      "text": "Be signed in for export and deletion; the policy pages are public.",
      "guideId": "account-signin",
      "href": "/login"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open Settings, Privacy & Data",
        "type": "terminal"
      },
      {
        "id": "choose",
        "label": "Choose: adjust controls, export, or delete",
        "type": "decision"
      },
      {
        "id": "controls",
        "label": "Toggle privacy controls and save",
        "type": "step"
      },
      {
        "id": "export",
        "label": "Verify password and email code, download export",
        "type": "step"
      },
      {
        "id": "delete",
        "label": "Danger Zone: Delete Account with confirmation",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Privacy change applied",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "choose"
      },
      {
        "from": "choose",
        "to": "controls",
        "label": "Adjust"
      },
      {
        "from": "choose",
        "to": "export",
        "label": "Export"
      },
      {
        "from": "choose",
        "to": "delete",
        "label": "Delete"
      },
      {
        "from": "controls",
        "to": "done"
      },
      {
        "from": "export",
        "to": "done"
      },
      {
        "from": "delete",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Open Settings and choose the \"Privacy & Data\" tab. 2. Decide what you want: adjust privacy controls, export your data, or delete your account. 3. For controls, toggle the options (communication, job, live chat, booking visibility) and save. 4. For export, confirm your current password, then enter the six-digit code sent to your email; the export downloads. 5. For deletion, use the \"Danger Zone\" tab, choose \"Delete Account\", and confirm in the \"Delete Your Account\" dialog.",
  "steps": [
    {
      "id": "account-privacy-s1",
      "title": "Open the Privacy & Data tab",
      "body": "Choose Settings from your account menu and pick the \"Privacy & Data\" tab. The page shows privacy preference toggles (for example communication controls, job controls, live chat, and booking visibility). The public legal pages (/privacy, /do-not-sell, /cookie-policy, /terms) are readable without signing in.",
      "expectedResult": "The privacy toggles load with their current saved states.",
      "screenshots": [
        {
          "id": "account-privacy-s1-desktop",
          "viewport": "desktop",
          "screen": "/settings",
          "state": "Privacy & Data tab, signed in, light mode",
          "alt": "Privacy and Data tab with privacy toggles",
          "caption": "The Privacy & Data tab, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Privacy toggles",
              "locator": "input[type=\"checkbox\"]"
            }
          ]
        },
        {
          "id": "account-privacy-s1-mobile",
          "viewport": "mobile",
          "screen": "/settings",
          "state": "Privacy & Data tab, signed in, light mode",
          "alt": "Privacy toggles on a phone screen",
          "caption": "The Privacy & Data tab, mobile view.",
          "annotations": [
            {
              "n": 1,
              "label": "Privacy toggles",
              "locator": "input[type=\"checkbox\"]"
            }
          ]
        }
      ]
    },
    {
      "id": "account-privacy-s2",
      "title": "Adjust privacy controls and save",
      "body": "Toggle the controls you want to change (for example who can contact you or see your activity) and choose Save. A confirmation toast shows when the update is stored.",
      "expectedResult": "The saved states persist after you reload the page.",
      "screenshots": [
        {
          "id": "account-privacy-s2-desktop",
          "viewport": "desktop",
          "screen": "/settings",
          "state": "Privacy & Data tab with a toggle changed, signed in, light mode",
          "alt": "Privacy toggles with one changed",
          "caption": "Adjusting privacy controls.",
          "annotations": []
        },
        {
          "id": "account-privacy-s2-mobile",
          "viewport": "mobile",
          "screen": "/settings",
          "state": "Privacy & Data tab with a toggle changed, signed in, light mode",
          "alt": "Privacy toggles on a phone screen",
          "caption": "Adjusting controls, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "account-privacy-s3",
      "title": "Export your data with two-step verification",
      "body": "In the Privacy & Data tab, start the data export. First confirm your current password; a verification code is sent to your email (\"A verification code was sent to your email.\"). Enter the six-digit code, then choose the verify-and-export option to download your data export.",
      "expectedResult": "The export file downloads to your device.",
      "screenshots": [
        {
          "id": "account-privacy-s3-desktop",
          "viewport": "desktop",
          "screen": "/settings",
          "state": "Export verification code entry, signed in, light mode",
          "alt": "Data export verification with code entry",
          "caption": "The export verification step, desktop view.",
          "annotations": [
            {
              "n": 2,
              "label": "Six-digit code field",
              "locator": "input[type=\"text\"]"
            }
          ]
        },
        {
          "id": "account-privacy-s3-mobile",
          "viewport": "mobile",
          "screen": "/settings",
          "state": "Export verification code entry, signed in, light mode",
          "alt": "Export verification on a phone screen",
          "caption": "The export verification step, mobile view.",
          "annotations": [
            {
              "n": 1,
              "label": "Six-digit code field",
              "locator": "input[type=\"text\"]"
            }
          ]
        }
      ]
    },
    {
      "id": "account-privacy-s4",
      "title": "Delete your account from the Danger Zone",
      "body": "Choose the \"Danger Zone\" tab and choose \"Delete Account\". A confirmation dialog titled \"Delete Your Account\" explains what is removed (including active jobs and pending balances if any). Type the confirmation as requested and confirm the deletion. This cannot be undone.",
      "expectedResult": "Your account is deleted and you are signed out.",
      "screenshots": [
        {
          "id": "account-privacy-s4-desktop",
          "viewport": "desktop",
          "screen": "/settings",
          "state": "Danger Zone tab with Delete Account confirmation, signed in, light mode",
          "alt": "Danger Zone tab with the delete confirmation dialog",
          "caption": "The Delete Your Account confirmation.",
          "annotations": []
        },
        {
          "id": "account-privacy-s4-mobile",
          "viewport": "mobile",
          "screen": "/settings",
          "state": "Danger Zone tab with Delete Account confirmation, signed in, light mode",
          "alt": "Delete confirmation dialog on a phone screen",
          "caption": "The delete confirmation, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "Privacy toggles keep their new values after a reload; exports download; after deletion you can no longer sign in with that account.",
  "recovery": [
    {
      "problem": "The export code never arrives.",
      "solution": "Check spam, then request a new code. You must enter your current password first; without it no code is sent."
    },
    {
      "problem": "Account deletion is blocked.",
      "solution": "The dialog lists blockers such as active jobs or a remaining balance. Finish or cancel those jobs and withdraw balances first, then retry deletion."
    }
  ],
  "supportContact": "For data requests you cannot complete yourself, contact support from the Help menu or visit /support.",
  "relatedGuides": [
    "account-settings",
    "account-signin"
  ],
  "siteLinks": [
    {
      "label": "Privacy",
      "href": "/privacy"
    },
    {
      "label": "Do not sell",
      "href": "/do-not-sell"
    },
    {
      "label": "Settings",
      "href": "/settings"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/privacy"
    },
    {
      "type": "route",
      "ref": "/do-not-sell"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/SettingsPage.jsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/privacy/export/verification/request, /verify, GET /api/privacy/export, DELETE /api/privacy/delete-account"
    },
    {
      "type": "permission",
      "ref": "Guest for public policy pages; authenticated for export/deletion."
    }
  ]
};
