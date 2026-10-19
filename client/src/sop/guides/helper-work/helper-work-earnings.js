// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "helper-work-earnings",
  "area": "helper-work",
  "slug": "view-earnings-overview",
  "title": "View your earnings overview",
  "audiences": [
    "helper"
  ],
  "revision": 3,
  "availability": "conditional",
  "conditions": [
    "The Earnings tab is currently available in helper mode. If it is unavailable for your account, use Payouts and Helper earnings statements."
  ],
  "goal": "Review recorded job payouts by currency, inspect trends and job details, and open earnings statements. Budgets and personal money logs are separate from recorded payouts.",
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
        "label": "Open helper Earnings",
        "type": "terminal"
      },
      {
        "id": "currency",
        "label": "Choose a currency",
        "type": "step"
      },
      {
        "id": "review",
        "label": "Review recorded payouts and missing amounts",
        "type": "step"
      },
      {
        "id": "trend",
        "label": "Inspect weekly or monthly trends and jobs",
        "type": "step"
      },
      {
        "id": "statements",
        "label": "Open earnings statements",
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
        "to": "currency"
      },
      {
        "from": "currency",
        "to": "review"
      },
      {
        "from": "review",
        "to": "trend"
      },
      {
        "from": "trend",
        "to": "statements"
      },
      {
        "from": "statements",
        "to": "done"
      }
    ]
  },
  "processMapText": "Open helper Earnings, select one currency, review recorded payouts and any missing amounts, compare weekly or monthly trends, open individual jobs, then open earnings statements for period records.",
  "steps": [
    {
      "id": "helper-work-earnings-s1",
      "title": "Open recorded job earnings",
      "body": "Open /helper-dashboard?tab=earnings in helper mode. The Job earnings card shows recorded helper payouts separately from personal income and expense logging. Job budgets do not count as recorded payouts.",
      "expectedResult": "The currency selector and recorded payout totals are visible.",
      "screenshots": [
        {
          "id": "helper-work-earnings-s1-desktop",
          "viewport": "desktop",
          "screen": "/helper-dashboard?tab=earnings",
          "state": "Recorded job earnings and currency selector, light mode",
          "alt": "Open recorded job earnings on desktop",
          "caption": "Open recorded job earnings, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Currency selector",
              "locator": ".helper-job-earnings select[aria-label=\"Currency\"]"
            }
          ]
        },
        {
          "id": "helper-work-earnings-s1-mobile",
          "viewport": "mobile",
          "screen": "/helper-dashboard?tab=earnings",
          "state": "Recorded job earnings and currency selector, light mode",
          "alt": "Open recorded job earnings on mobile",
          "caption": "Open recorded job earnings, mobile view.",
          "annotations": [
            {
              "n": 1,
              "label": "Currency selector",
              "locator": ".helper-job-earnings select[aria-label=\"Currency\"]"
            }
          ]
        }
      ]
    },
    {
      "id": "helper-work-earnings-s2",
      "title": "Choose a currency and check missing amounts",
      "body": "Use Currency to review one currency at a time. Available, pending, and paid amounts are separate. A missing recorded payout is called out; it is not estimated from the job budget and is not a confirmed balance.",
      "expectedResult": "You can identify the currency and distinguish recorded payouts from missing amounts.",
      "screenshots": [
        {
          "id": "helper-work-earnings-s2-desktop",
          "viewport": "desktop",
          "screen": "/helper-dashboard?tab=earnings",
          "state": "JPY recorded job earnings, light mode",
          "alt": "Choose a currency and check missing amounts on desktop",
          "caption": "Choose a currency and check missing amounts, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Selected currency",
              "locator": ".helper-job-earnings select[aria-label=\"Currency\"]"
            },
            {
              "n": 2,
              "label": "Missing recorded payouts",
              "locator": ".helper-job-earnings p[role=\"status\"]"
            }
          ]
        },
        {
          "id": "helper-work-earnings-s2-mobile",
          "viewport": "mobile",
          "screen": "/helper-dashboard?tab=earnings",
          "state": "JPY recorded job earnings, light mode",
          "alt": "Choose a currency and check missing amounts on mobile",
          "caption": "Choose a currency and check missing amounts, mobile view.",
          "annotations": [
            {
              "n": 1,
              "label": "Selected currency",
              "locator": ".helper-job-earnings select[aria-label=\"Currency\"]"
            },
            {
              "n": 2,
              "label": "Missing recorded payouts",
              "locator": ".helper-job-earnings p[role=\"status\"]"
            }
          ]
        }
      ]
    },
    {
      "id": "helper-work-earnings-s3",
      "title": "Inspect trends and open a job",
      "body": "Switch Trend between Weekly and Monthly. Open a job title to inspect its details. Use Previous and Next to review older recorded jobs; the list stays within the selected currency.",
      "expectedResult": "The monthly trend and individual job links are available.",
      "screenshots": [
        {
          "id": "helper-work-earnings-s3-desktop",
          "viewport": "desktop",
          "screen": "/helper-dashboard?tab=earnings",
          "state": "Monthly recorded earnings and job links, light mode",
          "alt": "Inspect trends and open a job on desktop",
          "caption": "Inspect trends and open a job, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Weekly or monthly trend",
              "locator": ".helper-job-earnings select[aria-label=\"Trend\"]"
            },
            {
              "n": 2,
              "label": "Open a job",
              "locator": ".helper-earnings-jobs a"
            }
          ]
        },
        {
          "id": "helper-work-earnings-s3-mobile",
          "viewport": "mobile",
          "screen": "/helper-dashboard?tab=earnings",
          "state": "Monthly recorded earnings and job links, light mode",
          "alt": "Inspect trends and open a job on mobile",
          "caption": "Inspect trends and open a job, mobile view.",
          "annotations": [
            {
              "n": 1,
              "label": "Weekly or monthly trend",
              "locator": ".helper-job-earnings select[aria-label=\"Trend\"]"
            },
            {
              "n": 2,
              "label": "Open a job",
              "locator": ".helper-earnings-jobs a"
            }
          ]
        }
      ]
    },
    {
      "id": "helper-work-earnings-s4",
      "title": "Open your earnings statements",
      "body": "Open /helper-earnings/statements for authorized period records and downloads. Use /helper/payouts for payout requests and their existing eligibility checks. Reviewing analytics never submits a payout.",
      "expectedResult": "Your authorized earnings statement area loads.",
      "screenshots": [
        {
          "id": "helper-work-earnings-s4-desktop",
          "viewport": "desktop",
          "screen": "/helper-earnings/statements",
          "state": "Earnings statements list with synthetic data, light mode",
          "alt": "Open your earnings statements on desktop",
          "caption": "Open your earnings statements, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-earnings-s4-mobile",
          "viewport": "mobile",
          "screen": "/helper-earnings/statements",
          "state": "Earnings statements list with synthetic data, light mode",
          "alt": "Open your earnings statements on mobile",
          "caption": "Open your earnings statements, mobile view.",
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
      "ref": "/helper-dashboard?tab=earnings"
    },
    {
      "type": "route",
      "ref": "/helper-earnings/statements"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/HelperDashboard.jsx; client/src/components/HelperJobEarnings.jsx"
    },
    {
      "type": "handler",
      "ref": "server/analytics/helperEarnings.js; GET /api/main-app/earnings"
    },
    {
      "type": "flag",
      "ref": "helperEarnings: true (LAUNCH_VISIBILITY)"
    }
  ]
};
