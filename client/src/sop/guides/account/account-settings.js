// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "account-settings",
  "area": "account",
  "slug": "manage-settings",
  "title": "Manage account settings",
  "audiences": [
    "customer",
    "helper",
    "business",
    "restaurant",
    "logistics"
  ],
  "revision": 3,
  "availability": "supported",
  "conditions": [],
  "goal": "Change your profile, security, notifications, country, businesses, and tax documents from one settings hub.",
  "intendedRoles": [
    "Customer",
    "Helper",
    "Business owner",
    "Restaurant",
    "Logistics"
  ],
  "prerequisites": [
    {
      "text": "Be signed in to your OxSteed account.",
      "guideId": "account-signin",
      "href": "/login"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open Settings",
        "type": "terminal"
      },
      {
        "id": "tab",
        "label": "Choose the right tab",
        "type": "decision"
      },
      {
        "id": "edit",
        "label": "Edit the settings",
        "type": "step"
      },
      {
        "id": "save",
        "label": "Save changes",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Settings updated",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "tab"
      },
      {
        "from": "tab",
        "to": "edit"
      },
      {
        "from": "edit",
        "to": "save"
      },
      {
        "from": "save",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Open /settings. 2. Pick the tab you need: Profile, Security, Businesses, Notifications, Privacy & Data, Account Type, Danger Zone, or Tax documents (helpers only). 3. Edit the fields or toggle the controls on that tab. 4. Save; most changes confirm with a toast. 5. Security changes like 2FA and passkeys take effect immediately.",
  "steps": [
    {
      "id": "account-settings-s1",
      "title": "Open Settings and pick a tab",
      "body": "Choose Settings from your account menu, or open /settings directly. The page shows tabs: Profile, Security, Businesses, Notifications, Privacy & Data, Account Type, and Danger Zone. Helpers also see a Tax documents tab. You can deep-link a tab, for example /settings?tab=tax.",
      "expectedResult": "The settings page loads with the tab list and the Profile tab selected.",
      "screenshots": [
        {
          "id": "account-settings-s1-desktop",
          "viewport": "desktop",
          "screen": "/settings",
          "state": "Settings page, Profile tab active, signed in, light mode",
          "alt": "Settings page with the tab list on the side",
          "caption": "The settings tabs, desktop view.",
          "annotations": []
        },
        {
          "id": "account-settings-s1-mobile",
          "viewport": "mobile",
          "screen": "/settings",
          "state": "Settings page, tab list, signed in, light mode",
          "alt": "Settings tabs on a phone screen",
          "caption": "The settings tabs, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "account-settings-s2",
      "title": "Update your profile or account basics",
      "body": "On the Profile tab, update your name, contact details, and profile photo. On the Account Type tab you can review your \"Current Role\", see the \"Workspaces you belong to\", and use \"Switch\" to move into a granted workspace role.",
      "expectedResult": "The changed values stay in the fields after saving.",
      "screenshots": [
        {
          "id": "account-settings-s2-desktop",
          "viewport": "desktop",
          "screen": "/settings",
          "state": "Profile tab, signed in, light mode",
          "alt": "Profile tab with editable fields",
          "caption": "The Profile tab.",
          "annotations": []
        },
        {
          "id": "account-settings-s2-mobile",
          "viewport": "mobile",
          "screen": "/settings",
          "state": "Profile tab, signed in, light mode",
          "alt": "Profile fields on a phone screen",
          "caption": "The Profile tab, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "account-settings-s3",
      "title": "Manage security: 2FA, passkeys, and sessions",
      "body": "On the Security tab, set up two-factor authentication (TOTP), add or remove passkeys, and review your active sessions. Sessions can be signed out individually from the sessions list. The Notifications tab controls email and push preferences; the country selector sets your marketplace country.",
      "expectedResult": "Security changes confirm immediately; a new 2FA setup asks you to verify a test code.",
      "screenshots": [
        {
          "id": "account-settings-s3-desktop",
          "viewport": "desktop",
          "screen": "/settings?tab=security",
          "state": "Security tab, signed in, light mode",
          "alt": "Security tab with two-factor, passkeys, and sessions sections",
          "caption": "The Security tab: 2FA, passkeys, and sessions.",
          "annotations": []
        },
        {
          "id": "account-settings-s3-mobile",
          "viewport": "mobile",
          "screen": "/settings?tab=security",
          "state": "Security tab, signed in, light mode",
          "alt": "Security tab on a phone screen",
          "caption": "The Security tab, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "account-settings-s4",
      "title": "File tax documents as a helper (W-9)",
      "body": "Helpers: open the Tax documents tab and complete \"Tax documents (W-9)\". The subtitle explains: \"File your W-9 so payouts can be released. Your tax ID is stored encrypted.\" Payouts are gated until your tax identity is on file.",
      "expectedResult": "The W-9 shows as filed and the payout tax gate is satisfied.",
      "screenshots": [
        {
          "id": "account-settings-s4-desktop",
          "viewport": "desktop",
          "screen": "/settings?tab=tax",
          "state": "Tax documents tab, helper, signed in, light mode",
          "alt": "Tax documents tab with the W-9 form",
          "caption": "The Tax documents tab for helpers.",
          "annotations": []
        },
        {
          "id": "account-settings-s4-mobile",
          "viewport": "mobile",
          "screen": "/settings?tab=tax",
          "state": "Tax documents tab, helper, signed in, light mode",
          "alt": "W-9 form on a phone screen",
          "caption": "The Tax documents tab, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "Each change confirms with a toast or an updated value. Your Security tab reflects the new 2FA or passkey state immediately.",
  "recovery": [
    {
      "problem": "You cannot find a setting you expected.",
      "solution": "Check every tab; some controls are role-specific (the Tax documents tab is helper-only, businesses live under the Businesses tab)."
    },
    {
      "problem": "A save fails with an error.",
      "solution": "Check the highlighted field for the validation message, fix it, and save again. If it keeps failing, reload the page and retry."
    }
  ],
  "supportContact": "For account or security issues you cannot fix in Settings, contact support from the Help menu or visit /support.",
  "relatedGuides": [
    "account-signin",
    "account-privacy",
    "account-mode-switching"
  ],
  "siteLinks": [
    {
      "label": "Settings",
      "href": "/settings"
    },
    {
      "label": "Security",
      "href": "/settings/2fa"
    },
    {
      "label": "Notifications",
      "href": "/settings/notifications"
    },
    {
      "label": "Payment policies",
      "href": "/settings/payment-policies"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/settings"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/SettingsPage.jsx"
    },
    {
      "type": "handler",
      "ref": "GET/PATCH /api/users/me, /api/two-factor, /api/passkeys, /api/settings"
    },
    {
      "type": "flag",
      "ref": "LAUNCH_SETTINGS_TABS (profile, security, businesses, notifications, privacy, account, danger, tax)"
    }
  ]
};
