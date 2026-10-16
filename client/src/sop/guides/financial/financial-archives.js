// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "financial-archives",
  "area": "financial",
  "slug": "financial-archives",
  "title": "Browse archived statements",
  "audiences": [
    "customer",
    "restaurant",
    "helper",
    "business"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Find issued monthly statements in the archive and view or download the immutable originals.",
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
      "text": "Know which product the statement belongs to (OxSteed Credit, Restaurant Credit, helper earnings, business, or restaurant settlement).",
      "guideId": "financial-statements",
      "href": "/statements"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "open",
        "label": "Open a statement archive",
        "type": "terminal"
      },
      {
        "id": "product",
        "label": "Pick the product",
        "type": "step"
      },
      {
        "id": "find",
        "label": "Find the statement period",
        "type": "step"
      },
      {
        "id": "view",
        "label": "View the issued statement",
        "type": "step"
      },
      {
        "id": "download",
        "label": "Download the original again",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Archived statement retrieved",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "open",
        "to": "product"
      },
      {
        "from": "product",
        "to": "find"
      },
      {
        "from": "find",
        "to": "view"
      },
      {
        "from": "view",
        "to": "download"
      },
      {
        "from": "download",
        "to": "done"
      }
    ]
  },
  "processMapText": "Open a product archive, for example /oxsteed-credit/statements/archive (\"Statement archive\": \"Your issued monthly statements. Originals are immutable; download them again at any time.\"). Pick the product (OxSteed Credit, Restaurant Credit, helper earnings, business, or restaurant settlement). Find the statement period (\"Jan 1 – Jan 31\"), open it (\"View\"), and download the original (\"Download issued\", \"Download CSV\"). Each product has its own archive; they never merge.",
  "steps": [
    {
      "id": "financial-archives-s1",
      "title": "Open a statement archive",
      "body": "Open one of the archive routes: /oxsteed-credit/statements/archive for OxSteed Credit, /restaurant-credit/statements/archive for Restaurant Credit, /helper-earnings/statements for helper earnings, /business/statements for business statements, or /restaurant-settlement/statements for restaurant settlement. The page is titled \"Statement archive\".",
      "expectedResult": "The archive loads with the product selector and the issued statements.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/oxsteed-credit/statements/archive",
          "state": "Statement archive with statement list, light mode",
          "alt": "Statement archive with issued monthly statements",
          "caption": "The statement archive, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/oxsteed-credit/statements/archive",
          "state": "Statement archive with statement list, light mode",
          "alt": "Archive on a phone screen",
          "caption": "The statement archive, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-archives-s2",
      "title": "Pick the product and find the period",
      "body": "Use the \"Product\" selector to switch products (\"Each product, account and currency has its own statements. These are credit-account records, not bank deposit statements.\"). Find the statement by its period heading (\"Jan 1 – Jan 31\"). The totals line uses the product's own accounting vocabulary (for example \"Opening payable\", \"Posted earnings\", \"Settled payouts and status removals\", \"Closing payable\" for helper earnings).",
      "expectedResult": "The right statement document is on screen with its totals.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/oxsteed-credit/statements/archive",
          "state": "Archive with product selector open, light mode",
          "alt": "Product selector and statement periods",
          "caption": "Picking a product and period, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/oxsteed-credit/statements/archive",
          "state": "Archive with product selector open, light mode",
          "alt": "Product and periods on a phone screen",
          "caption": "Picking a product and period, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-archives-s3",
      "title": "View and download the issued statement",
      "body": "Choose \"View\" on the statement to read the issued document. Use \"Download issued\" for the immutable original or \"Download CSV\" for the data. Originals never change; if a statement was amended, the archive marks it and links the correction.",
      "expectedResult": "The statement opens or downloads with its full transaction history.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/oxsteed-credit/statements/archive",
          "state": "Issued statement with download actions, light mode",
          "alt": "Issued statement with View and Download actions",
          "caption": "Viewing an issued statement, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/oxsteed-credit/statements/archive",
          "state": "Issued statement with download actions, light mode",
          "alt": "Statement on a phone screen",
          "caption": "Viewing an issued statement, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "You have the issued statement open or downloaded, from the right product archive, with the immutable original.",
  "recovery": [
    {
      "problem": "The archive shows \"No statements yet\".",
      "solution": "\"Issued monthly statements will appear here. Closed calendar months create immutable documents.\" If you expected one, check the product selector; statements live under their own product."
    },
    {
      "problem": "You cannot find a statement for a different product.",
      "solution": "Switch the \"Product\" selector or open the product's own archive route directly (for example /restaurant-credit/statements/archive)."
    }
  ],
  "supportContact": "For archive issues, use the in-app support page at /support.",
  "relatedGuides": [
    "financial-statements",
    "financial-downloads"
  ],
  "siteLinks": [
    {
      "label": "Statement center",
      "href": "/statements"
    },
    {
      "label": "OxSteed Credit archive",
      "href": "/oxsteed-credit/statements/archive"
    },
    {
      "label": "Restaurant credit archive",
      "href": "/restaurant-credit/statements/archive"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/restaurant-credit/statements/archive"
    },
    {
      "type": "route",
      "ref": "/oxsteed-credit/statements/archive"
    },
    {
      "type": "route",
      "ref": "/restaurant-settlement/statements"
    },
    {
      "type": "route",
      "ref": "/helper-earnings/statements"
    },
    {
      "type": "route",
      "ref": "/business/statements"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/StatementArchivePage.jsx"
    }
  ]
};
