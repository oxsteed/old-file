// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "financial-downloads",
  "area": "financial",
  "slug": "financial-downloads",
  "title": "Download statement exports",
  "audiences": [
    "customer",
    "restaurant",
    "helper",
    "business"
  ],
  "revision": 3,
  "availability": "supported",
  "conditions": [],
  "goal": "Export statement data as CSV or PDF for accounting, audits, or taxes.",
  "intendedRoles": [
    "Customer",
    "Restaurant owner",
    "Helper",
    "Business owner"
  ],
  "prerequisites": [
    {
      "text": "Sign in to your OxSteed account.",
      "href": "/login"
    },
    {
      "text": "Know the account, date range, and format you need.",
      "guideId": "financial-statements",
      "href": "/statements"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "open",
        "label": "Open the export panel",
        "type": "terminal"
      },
      {
        "id": "form",
        "label": "Set account, dates, currency, and type",
        "type": "step"
      },
      {
        "id": "request",
        "label": "Request complete export",
        "type": "step"
      },
      {
        "id": "wait",
        "label": "Wait for the export job",
        "type": "step"
      },
      {
        "id": "files",
        "label": "Download the export files",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Export downloaded",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "open",
        "to": "form"
      },
      {
        "from": "form",
        "to": "request"
      },
      {
        "from": "request",
        "to": "wait"
      },
      {
        "from": "wait",
        "to": "files"
      },
      {
        "from": "files",
        "to": "done"
      }
    ]
  },
  "processMapText": "Open the statement archive for an authorized account. Expand Request complete export and choose account, dates, currency and format. Submit the request; follow its job page until complete, then download the files. Failures and cancellations have separate retry or cancel actions when offered.",
  "steps": [
    {
      "id": "financial-downloads-s1",
      "title": "Open the export panel",
      "body": "From a statement archive, expand the export section and choose \"Request complete export\". You can also track a specific job at /statements/exports/:jobId. The panel heading reads \"Request complete export\".",
      "expectedResult": "The export form loads with the account and period fields.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/oxsteed-credit/statements/archive",
          "state": "Export panel with request form, light mode",
          "alt": "Export request form",
          "caption": "The export panel, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Export form",
              "locator": ".sa-export-disclosure form"
            }
          ]
        },
        {
          "viewport": "mobile",
          "screen": "/oxsteed-credit/statements/archive",
          "state": "Export panel with request form, light mode",
          "alt": "Export form on a phone screen",
          "caption": "The export panel, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-downloads-s2",
      "title": "Set the export parameters and submit",
      "body": "Choose the \"Account\", the \"From\" and \"To\" dates, the \"Currency\" (3-letter code), and the \"Type\" (format), then choose \"Request complete export\". For several accounts at once, use the bulk section: check the accounts, pick the \"Type\", and start the bulk export.",
      "expectedResult": "The export job starts and shows its pending state.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/oxsteed-credit/statements/archive",
          "state": "Export form with parameters filled, light mode",
          "alt": "Export form with the submit button",
          "caption": "Submitting an export, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Export form",
              "locator": ".sa-export-disclosure form"
            }
          ]
        },
        {
          "viewport": "mobile",
          "screen": "/oxsteed-credit/statements/archive",
          "state": "Export form with parameters filled, light mode",
          "alt": "Export form on a phone screen",
          "caption": "Submitting an export, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-downloads-s3",
      "title": "Track the job and download the files",
      "body": "The job shows its state: pending, complete, failed, or cancelled. While it runs you can use \"Cancel export\"; if it fails and \"Retry export\" is offered, use it. When complete, the \"Export files\" section lists each file (\"Download CSV · part\", with the row range). Use \"View export history\" for past jobs.",
      "expectedResult": "The export files download to your device.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/statements/exports/:jobId",
          "state": "Completed export job with files, light mode",
          "alt": "Export files list with download buttons",
          "caption": "Downloading export files, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Export files list",
              "locator": "section[aria-label] ul"
            }
          ]
        },
        {
          "viewport": "mobile",
          "screen": "/statements/exports/:jobId",
          "state": "Completed export job with files, light mode",
          "alt": "Export files on a phone screen",
          "caption": "Downloading export files, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The export files are on your device and the history lists the completed job.",
  "recovery": [
    {
      "problem": "The export fails.",
      "solution": "You see \"Your export could not be completed.\" Use \"Retry export\" if offered, or narrow the date range and request again."
    },
    {
      "problem": "The job is still running.",
      "solution": "Large date ranges take longer. You can \"Cancel export\" and re-request a smaller range, or check \"View export history\" later."
    }
  ],
  "supportContact": "For export issues, use the in-app support page at /support.",
  "relatedGuides": [
    "financial-statements",
    "financial-archives"
  ],
  "siteLinks": [
    {
      "label": "Statement center",
      "href": "/statements"
    },
    {
      "label": "OxSteed Credit archive",
      "href": "/oxsteed-credit/statements/archive"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/statements/exports/:jobId"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/StatementExportPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/StatementExportPanel.jsx"
    },
    {
      "type": "route",
      "ref": "/oxsteed-credit/statements/archive"
    }
  ]
};
