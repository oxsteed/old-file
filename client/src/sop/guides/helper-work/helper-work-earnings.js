// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "helper-work-earnings",
  "area": "helper-work",
  "slug": "view-earnings-overview",
  "title": "View your earnings overview",
  "audiences": [
    "helper"
  ],
  "revision": 2,
  "availability": "conditional",
  "conditions": [
    "The Earnings tab on the helper dashboard is visible only while the helperEarnings launch flag is enabled (it is off by default). Your payouts at /helper/payouts and your earnings statements at /helper-earnings/statements stay available while the tab is hidden."
  ],
  "goal": "See your income, expenses, and net earnings in one place, even while the dashboard earnings section is unreleased.",
  "intendedRoles": [
    "Helper"
  ],
  "prerequisites": [
    {
      "text": "Sign in and switch to helper mode.",
      "href": "/login"
    },
    {
      "text": "Know how to receive payouts.",
      "guideId": "helper-work-payouts",
      "href": "/helper/payouts"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open your helper dashboard",
        "type": "terminal"
      },
      {
        "id": "flag",
        "label": "Is the helperEarnings flag enabled?",
        "type": "decision"
      },
      {
        "id": "tab",
        "label": "Open the Earnings tab",
        "type": "step"
      },
      {
        "id": "blocked",
        "label": "Earnings tab hidden (flag off)",
        "type": "blocked"
      },
      {
        "id": "payouts",
        "label": "Use the Payouts page instead",
        "type": "step"
      },
      {
        "id": "statements",
        "label": "Open your earnings statements",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Earnings reviewed",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "flag"
      },
      {
        "from": "flag",
        "to": "tab",
        "label": "Yes"
      },
      {
        "from": "flag",
        "to": "blocked",
        "label": "No"
      },
      {
        "from": "tab",
        "to": "done"
      },
      {
        "from": "blocked",
        "to": "payouts"
      },
      {
        "from": "payouts",
        "to": "statements"
      },
      {
        "from": "statements",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Open your helper dashboard. 2. Check whether the helperEarnings flag is enabled. If it is, open the Earnings tab to review income, expenses, net, and savings rate. If it is not (the default), the Earnings tab is hidden and that is expected; use the Payouts page for balances and the earnings statements page for records. 3. In either path you finish with your earnings reviewed.",
  "steps": [
    {
      "id": "helper-work-earnings-s1",
      "title": "Check for the Earnings tab",
      "body": "Open your helper dashboard (/dashboard or /helper-dashboard). If the helperEarnings launch flag is enabled, an Earnings tab appears beside the other tabs. By default the flag is off and the tab is hidden; the rest of this guide covers both paths.",
      "expectedResult": "You know whether the Earnings tab is available to you.",
      "screenshots": [
        {
          "id": "helper-work-earnings-s1-desktop",
          "viewport": "desktop",
          "screen": "/dashboard",
          "state": "Helper dashboard tabs, Earnings tab absent (flag off), light mode",
          "alt": "Helper dashboard tab bar without an Earnings tab",
          "caption": "The dashboard with the Earnings tab hidden, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-earnings-s1-mobile",
          "viewport": "mobile",
          "screen": "/dashboard",
          "state": "Helper dashboard tabs, Earnings tab absent (flag off), light mode",
          "alt": "Dashboard tabs on a phone screen without an Earnings tab",
          "caption": "The dashboard with the Earnings tab hidden, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-earnings-s2",
      "title": "Review earnings on the Payouts page",
      "body": "Open /helper/payouts any time. It always shows your Available, Pending, and Available for instant payout balances, regardless of the flag. This is the always-on view of what you have earned and can withdraw.",
      "expectedResult": "Your current balances are visible.",
      "screenshots": [
        {
          "id": "helper-work-earnings-s2-desktop",
          "viewport": "desktop",
          "screen": "/helper/payouts",
          "state": "Payouts page with synthetic balances, light mode",
          "alt": "Payouts page showing balance breakdown",
          "caption": "Balances on the Payouts page, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-earnings-s2-mobile",
          "viewport": "mobile",
          "screen": "/helper/payouts",
          "state": "Payouts page with synthetic balances, light mode",
          "alt": "Payouts page on a phone screen",
          "caption": "Balances on the Payouts page, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-earnings-s3",
      "title": "Open your earnings statements",
      "body": "Open /helper-earnings/statements for your archived helper earnings statements. Statements give you the period-by-period record of what you earned, independent of the dashboard tab.",
      "expectedResult": "Your earnings statements list loads.",
      "screenshots": [
        {
          "id": "helper-work-earnings-s3-desktop",
          "viewport": "desktop",
          "screen": "/helper-earnings/statements",
          "state": "Earnings statements list with synthetic data, light mode",
          "alt": "Earnings statements archive with statement periods listed",
          "caption": "Earnings statements, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-earnings-s3-mobile",
          "viewport": "mobile",
          "screen": "/helper-earnings/statements",
          "state": "Earnings statements list with synthetic data, light mode",
          "alt": "Earnings statements on a phone screen",
          "caption": "Earnings statements, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-earnings-s4",
      "title": "Use the Earnings tab when it is enabled",
      "body": "When the helperEarnings flag is on, open the dashboard Earnings tab. It shows income, expenses, net, and savings rate for the month, plus recent transactions and budgets. Use the log transaction button to record income and expenses.",
      "expectedResult": "The earnings overview shows your monthly income, expenses, net, and recent transactions.",
      "screenshots": [
        {
          "id": "helper-work-earnings-s4-desktop",
          "viewport": "desktop",
          "screen": "/dashboard?tab=earnings",
          "state": "Earnings tab with synthetic data (flag enabled), light mode",
          "alt": "Earnings tab showing income, expenses, net, and savings rate cards",
          "caption": "The Earnings tab (flag enabled), desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-earnings-s4-mobile",
          "viewport": "mobile",
          "screen": "/dashboard?tab=earnings",
          "state": "Earnings tab with synthetic data (flag enabled), light mode",
          "alt": "Earnings tab on a phone screen",
          "caption": "The Earnings tab (flag enabled), mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "You can see your balances at /helper/payouts and your statements at /helper-earnings/statements; when the flag is on, the dashboard Earnings tab shows the full overview.",
  "recovery": [
    {
      "problem": "There is no Earnings tab on your dashboard.",
      "solution": "That is expected: the helperEarnings flag is off by default. Use the Payouts page and earnings statements instead."
    },
    {
      "problem": "Statements show no entries.",
      "solution": "Statements archive after payouts post. If you have earned but never been paid, the Payouts page pending balance is where the money sits."
    }
  ],
  "supportContact": "If statements fail to load, contact OxSteed Support from the /support page.",
  "relatedGuides": [
    "helper-work-payouts"
  ],
  "siteLinks": [
    {
      "label": "Payouts",
      "href": "/helper/payouts"
    },
    {
      "label": "Earnings statements",
      "href": "/helper-earnings/statements"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/dashboard?tab=earnings"
    },
    {
      "type": "route",
      "ref": "/helper-earnings/statements"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/HelperDashboard.jsx (earnings tab)"
    },
    {
      "type": "flag",
      "ref": "helperEarnings: false (LAUNCH_VISIBILITY)"
    },
    {
      "type": "handler",
      "ref": "GET /api/statement-archive/archive (helper_earnings scope)"
    }
  ]
};
